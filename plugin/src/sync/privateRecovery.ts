import { Notice, type App } from 'obsidian'
import { makeParents } from './vaultFolders'
import { stagingDirectory } from './stagingDirectory'

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
export async function showPrivateRecoveryNotice(app: App): Promise<void> {
  if (
    notified.has(app.vault) ||
    !(await app.vault.adapter.exists(privateRecoveryDirectory(app.vault.configDir)))
  )
    return
  notified.add(app.vault)
  new Notice(
    `Sync kept recoverable copies in ${privateRecoveryDirectory(app.vault.configDir)}. They remain available for manual recovery.`,
    0
  )
}
export async function preservePrivateArtifacts(
  app: App,
  paths: Iterable<string>,
  assertCurrent: () => void = () => {}
): Promise<void> {
  let count = 0
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
    }
    await makeParents(app.vault.adapter, recovery)
    assertCurrent()
    await app.vault.adapter.rename(path, recovery)
    count++
    console.warn('[abele-sync] preserved recoverable copy', recovery)
  }
  if (count) await showPrivateRecoveryNotice(app)
}
