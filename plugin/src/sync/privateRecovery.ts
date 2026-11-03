import { WriteJournal } from './writeJournal'
import { ExternalRecoveryRequired } from './external/recovery'
import { pathCoordinatorOf } from './pathCoordinator'
import { t } from '@/i18n'
import { vaultDisk, connectionInspectionApp } from './vaultPathLinks'
import { connectionPrivateArea, connectionPrivateRoot, connectionJournalOwner, connectionHost } from './connectionPaths'
import type { App } from 'obsidian'
import { backgroundActivity } from './backgroundActivity'
import { makeParents } from './vaultFolders'
import { stagingDirectory } from './stagingDirectory'
import { BoundedVaultIo } from './boundedVaultIo'
import { z } from 'zod'

/** Finish preserving bytes, never replay an interrupted rename onto its public target. */
export async function finishRetainedWrites(
  app: App,
  owner?: string,
  assertCurrent: () => void = () => {}
): Promise<void> {
  return pathCoordinatorOf(app.vault).run(
    [''],
    async () => {
      const journal = new WriteJournal(app, assertCurrent, owner)
      // Departure already fenced the writer and preserved its private bytes. A
      // retired installation is evidence, not an installation that may be replayed.
      // Complete this conversion before inspecting unfinished recovered rows: a
      // process cut may leave both the old intent and its new archive owner.
      for (const entry of await journal.currentEntries()) {
        if (entry.retiredGeneration !== 'server-deletion' || !entry.conditionalReceipt) continue
        assertCurrent()
        const root = entry.owner ? connectionPrivateRoot(entry.owner) : undefined
        const view = connectionInspectionApp(app, vaultDisk(app.vault), '', root)
        const recovery = recoveryDirectory(view)
        const name = '.abele-receipt-' + entry.conditionalReceipt + '.tmp'
        const disk = vaultDisk(view.vault)
        const refuse = (reason: string): never => {
          throw new ExternalRecoveryRequired(reason, {
            kind: 'installation',
            id: name,
            path: entry.target,
          })
        }
        if (
          entry.streaming ||
          entry.backup ||
          !entry.temp ||
          (entry.temp !== recovery + '/' + name &&
            privateRecoveryPath(view, entry.temp ?? '') !== recovery + '/' + name)
        )
          refuse('retired installation locator changed')
        if (entry.temp === recovery + '/' + name) {
          // Do not discard the only locator if a user removed the retained copy.
          if (!(await disk.exists(entry.temp))) refuse('retained installation bytes are missing')
          const io = new BoundedVaultIo(
            disk,
            assertCurrent,
            undefined,
            undefined,
            app.vault.configDir
          )
          const proof = await io.fingerprint(entry.temp)
          if (!(await journal.currentRecovered()).some((row) => row.backup === entry.temp))
            await journal.persist(() => journal.preserve({ ...entry, backup: entry.temp }))
          const saved = (await journal.currentRecovered()).find((row) => row.backup === entry.temp)
          if (
            !saved ||
            saved.target !== entry.target ||
            (saved.archive &&
              (saved.archive.path !== entry.temp ||
                saved.archive.sha !== proof.sha ||
                saved.archive.size !== proof.size))
          )
            refuse('retained installation archive changed')
          await journal.replaceRecovered(saved, {
            ...saved,
            archive: { path: entry.temp, sha: proof.sha, size: proof.size },
            archived: true,
          })
        } else if (await disk.exists(entry.temp)) {
          refuse('retired installation still has active bytes')
        }
        assertCurrent()
        await journal.persist(() => journal.drop(entry))
        console.debug('[abele-sync] finished departed installation receipt', entry.target)
      }
      for (const original of await journal.currentUnfinishedRecovered()) {
        assertCurrent()
        let entry = original
        const root = entry.owner ? connectionPrivateRoot(entry.owner) : undefined
        const view = connectionInspectionApp(
          app,
          vaultDisk(app.vault),
          '',
          root && entry.backup.startsWith(root + '/writes/') ? root : undefined
        )
        const destination = privateRecoveryPath(view, entry.backup)
        // Existing native/Follow archives retain their separate ownership and safety checks.
        if (!destination && !entry.archive) continue
        const refuse = (reason: string): never => {
          throw new ExternalRecoveryRequired(reason, {
            kind: 'retained-byte',
            id: entry.backup.split('/').pop(),
            path: entry.target,
          })
        }
        if (!destination || !/^\.abele-sync-[a-z0-9]{8}\.old$/.test(entry.backup.split('/').pop()))
          refuse('retained recovery locator is not an owned private backup')
        const io = new BoundedVaultIo(
          vaultDisk(view.vault),
          assertCurrent,
          undefined,
          undefined,
          app.vault.configDir
        )
        if (!entry.archive) {
          if (!(await vaultDisk(view.vault).exists(entry.backup)))
            refuse(
              'retained recovery bytes are missing at ' +
                entry.backup +
                '; keep the connection and restore the recovery copy'
            )
          const proof = await io.fingerprint(entry.backup)
          const planned = {
            ...entry,
            archive: { path: destination, sha: proof.sha, size: proof.size },
          }
          await journal.replaceRecovered(entry, planned)
          entry = planned
        }
        if (entry.archive.path !== destination) refuse('retained recovery destination changed')
        if (!(await privateArtifactRecovered(view, entry.backup)))
          await preservePrivateArtifacts(view, [entry.backup], assertCurrent)
        const have = await io.fingerprint(destination)
        if (have.sha !== entry.archive.sha || have.size !== entry.archive.size)
          refuse('retained recovery bytes changed; the recovery copy was kept')
        assertCurrent()
        await journal.replaceRecovered(entry, { ...entry, backup: destination, archived: true })
        await showPrivateRecoveryNotice(view)
      }
    },
    assertCurrent
  )
}

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
  const prefixes = owned
    ? [owned + '/external/', stagingDirectory(app.vault.configDir, owned) + '/']
    : [stagingDirectory(app.vault.configDir) + '/']
  const prefix = prefixes.find((candidate) => path.startsWith(candidate))
  if (!prefix || path.split('/').some((part) => part === '.' || part === '..')) return null
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
