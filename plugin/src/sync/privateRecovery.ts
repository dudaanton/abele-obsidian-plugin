import { Notice, type App } from 'obsidian'
import { makeParents } from './vaultFolders'
import { stagingDirectory } from './stagingDirectory'
import { BoundedVaultIo } from './boundedVaultIo'
import { z } from 'zod'

const ORDINARY = 'abele-sync-ordinary-retained-v1'
const ordinarySchema = z.record(
  z.string(),
  z.object({ sha: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().nonnegative().int() })
)
function ordinaryCopies(app: App) {
  const parsed = ordinarySchema.safeParse(app.loadLocalStorage(ORDINARY) ?? {})
  return parsed.success ? parsed.data : {}
}
async function matchesCopy(
  app: App,
  path: string,
  expected: { sha: string; size: number }
): Promise<boolean> {
  try {
    const actual = await new BoundedVaultIo(
      app.vault.adapter,
      () => {},
      undefined,
      undefined,
      app.vault.configDir
    ).fingerprint(path)
    return actual.sha === expected.sha && actual.size === expected.size
  } catch {
    return false
  }
}
async function hasRecoveryCopies(app: App): Promise<boolean> {
  const root = privateRecoveryDirectory(app.vault.configDir)
  if (!(await app.vault.adapter.exists(root))) return false
  const ordinary = ordinaryCopies(app),
    seen = new Set<string>()
  const walk = async (path: string): Promise<boolean> => {
    if (seen.has(path)) throw new Error('Recovery directory loop')
    seen.add(path)
    const list = await app.vault.adapter.list(path)
    for (const file of list.files) {
      if (
        !file.startsWith(root + '/') ||
        file.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('Invalid recovery path')
      if (!ordinary[file] || !(await matchesCopy(app, file, ordinary[file]))) return true
    }
    for (const folder of list.folders) {
      if (
        !folder.startsWith(root + '/') ||
        folder.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('Invalid recovery folder')
      if (await walk(folder)) return true
    }
    return false
  }
  return walk(root)
}

export function privateRecoveryDirectory(configDir?: string): string {
  return configDir ? `${configDir}/plugins/abele/sync-recovery` : '.abele-sync-recovery'
}
export function privateRecoveryPath(app: App, path: string): string | null {
  const prefix = stagingDirectory(app.vault.configDir) + '/'
  if (!path.startsWith(prefix) || path.split('/').some((part) => part === '.' || part === '..'))
    return null
  return privateRecoveryDirectory(app.vault.configDir) + '/' + path.slice(prefix.length)
}
/** A deterministic destination survives a crash between the rename and ledger updates.
 * Never unlink: a writer holding the old inode can still save unique bytes afterwards. */
export async function privateArtifactRecovered(app: App, path: string): Promise<boolean> {
  const recovery = privateRecoveryPath(app, path)
  return (
    !!recovery &&
    !(await app.vault.adapter.exists(path)) &&
    (await app.vault.adapter.exists(recovery))
  )
}
const notified = new WeakSet<object>()
export async function showPrivateRecoveryNotice(app: App, freshCopies = false): Promise<void> {
  if ((!freshCopies && notified.has(app.vault)) || !(await hasRecoveryCopies(app))) return
  notified.add(app.vault)
  new Notice(
    `Sync kept recoverable copies in ${privateRecoveryDirectory(app.vault.configDir)}. They remain available for manual recovery.`,
    0
  )
}
export async function preservePrivateArtifacts(
  app: App,
  paths: Iterable<string>,
  assertCurrent: () => void = () => {},
  ordinary: readonly { path: string; sha: string; size: number }[] = []
): Promise<void> {
  let count = 0
  const known = ordinaryCopies(app)
  let needsNotice = false
  try {
    for (const path of new Set(paths)) {
      assertCurrent()
      const recovery = privateRecoveryPath(app, path)
      if (!recovery) throw new Error('Recovery copy is outside private staging')
      if (!(await app.vault.adapter.exists(path))) continue
      if (await app.vault.adapter.exists(recovery)) {
        // Reused stage names must not overwrite earlier recovery or block new work.
        const previous = recovery + '.previous-' + crypto.randomUUID()
        if (await app.vault.adapter.exists(previous))
          throw new Error('Recovery destination already exists; both copies have been kept')
        assertCurrent()
        await app.vault.adapter.rename(recovery, previous)
        if (known[recovery]) known[previous] = known[recovery]
      }
      await makeParents(app.vault.adapter, recovery)
      assertCurrent()
      await app.vault.adapter.rename(path, recovery)
      count++
      delete known[recovery]
      try {
        const expected = ordinary.find((file) => file.path === path)
        if (expected && (await matchesCopy(app, recovery, expected)))
          known[recovery] = { sha: expected.sha, size: expected.size }
        else needsNotice = true
        assertCurrent()
        // Merge after the last await: another connection may have retained a different copy.
        const merged = { ...ordinaryCopies(app), ...known }
        if (!known[recovery]) delete merged[recovery]
        app.saveLocalStorage(ORDINARY, merged)
        if (JSON.stringify(ordinaryCopies(app)) !== JSON.stringify(merged)) needsNotice = true
      } catch (error) {
        needsNotice = true
        throw error
      }
      console.warn('[abele-sync] preserved recoverable copy', recovery)
    }
  } finally {
    if (count && needsNotice) await showPrivateRecoveryNotice(app, true)
  }
}
