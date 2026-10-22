import { t } from '@/i18n'
import { vaultDisk } from './vaultPathLinks'
import { connectionPrivateArea, connectionJournalOwner, connectionHost } from './connectionPaths'
import type { App } from 'obsidian'
import { backgroundActivity } from './backgroundActivity'
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
      vaultDisk(app.vault),
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
  const root = recoveryDirectory(app)
  if (!(await vaultDisk(app.vault).exists(root))) return false
  const ordinary = ordinaryCopies(app),
    seen = new Set<string>()
  const walk = async (path: string): Promise<boolean> => {
    if (seen.has(path)) throw new Error('Recovery directory loop')
    seen.add(path)
    const list = await vaultDisk(app.vault).list(path)
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
const recoveryDirectory = (app: App) => {
  const owned = connectionPrivateArea(app)
  return owned ? owned + '/recovery' : privateRecoveryDirectory(app.vault.configDir)
}
export function privateRecoveryPath(app: App, path: string): string | null {
  const owned = connectionPrivateArea(app)
  const prefix = (owned ? owned + '/external' : stagingDirectory(app.vault.configDir)) + '/'
  if (!path.startsWith(prefix) || path.split('/').some((part) => part === '.' || part === '..'))
    return null
  return recoveryDirectory(app) + '/' + path.slice(prefix.length)
}
/** A deterministic destination survives a crash between the rename and ledger updates.
 * Never unlink: a writer holding the old inode can still save unique bytes afterwards. */
export async function privateArtifactRecovered(app: App, path: string): Promise<boolean> {
  const recovery = privateRecoveryPath(app, path)
  return (
    !!recovery &&
    !(await vaultDisk(app.vault).exists(path)) &&
    (await vaultDisk(app.vault).exists(recovery))
  )
}
const notified = new WeakMap<object, Set<string>>()
export async function showPrivateRecoveryNotice(app: App, freshCopies = false): Promise<void> {
  const host = connectionHost(app.vault)
  let owners = notified.get(host)
  if (!owners) notified.set(host, (owners = new Set()))
  const owner = connectionJournalOwner(app) ?? ''
  if ((!freshCopies && owners.has(owner)) || !(await hasRecoveryCopies(app))) return
  owners.add(owner)
  backgroundActivity(app, t('streamC.4c119f3f4f54bc61', { v1: String(recoveryDirectory(app)) }))
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
      if (!(await vaultDisk(app.vault).exists(path))) continue
      if (await vaultDisk(app.vault).exists(recovery)) {
        if (!known[recovery] || !(await matchesCopy(app, recovery, known[recovery])))
          needsNotice = true
        // Reused stage names must not overwrite earlier recovery or block new work.
        const previous = recovery + '.previous-' + crypto.randomUUID()
        if (await vaultDisk(app.vault).exists(previous))
          throw new Error('Recovery destination already exists; both copies have been kept')
        assertCurrent()
        await vaultDisk(app.vault).rename(recovery, previous)
        if (known[recovery]) known[previous] = known[recovery]
      }
      await makeParents(vaultDisk(app.vault), recovery)
      assertCurrent()
      await vaultDisk(app.vault).rename(path, recovery)
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
