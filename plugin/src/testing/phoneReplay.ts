import type { App } from 'obsidian'
import { SyncService } from '@/sync/SyncService'
const KEY = 'task14-phone-replay-evidence'
const cancellations = new WeakMap<App, () => void>()
interface Evidence {
  path: string
  content: string
  fileId: string
  versionId: string
  beforeCount: number
  key: string
}
/** Bounded exact evidence from the actual successful response BEFORE losing it. */
export async function startPhoneReplay(
  app: App
): Promise<{ beforeCount: number; captured: boolean }> {
  const svc = SyncService.getInstance(),
    backup = app.loadLocalStorage('task14-isolated-fixture') as { root: string } | null
  if (!backup || !svc.client() || svc.status.value.state !== 'idle')
    throw new Error('Phone replay fixture is not ready')
  if (app.loadLocalStorage(KEY)) throw new Error('Previous phone replay evidence must be cleared')
  const path = backup.root + '/phone-replay-' + crypto.randomUUID() + '.md',
    content = 'Native phone replay exact bytes'
  const client = svc.client(),
    original = client.commitRaw,
    commit = original.bind(client),
    wasPaused = svc.connection.value.paused
  let active = true
  const cancel = () => {
    active = false
    if (client.commitRaw === intercept) client.commitRaw = original
    cancellations.delete(app)
    if (wasPaused) svc.pause()
    else svc.resume()
  }
  let captured!: (e: Evidence) => void
  const completed = new Promise<Evidence>((resolve) => {
    captured = resolve
  })
  svc.pause()
  const intercept: typeof client.commitRaw = async (ops, key) => {
    const outcome = await commit(ops, key)
    if (!active) return outcome
    // CommitOutcome owns body.results, not results at its top level.
    const applied = outcome.body.results.find(
      (r: { status: string; path?: string; file_id?: string; version_id?: string }) =>
        r.status === 'applied' && r.path === path
    )
    if (!applied || applied.status !== 'applied' || !applied.file_id || !applied.version_id)
      return outcome
    const versions = await client.versions(applied.file_id)
    if (versions.length !== 1 || versions[0].version_id !== applied.version_id)
      throw new Error('Unexpected pre-reload history')
    if (!active) return outcome
    const evidence: Evidence = {
      path,
      content,
      fileId: applied.file_id,
      versionId: applied.version_id,
      beforeCount: versions.length,
      key,
    }
    app.saveLocalStorage(KEY, evidence)
    if (JSON.stringify(app.loadLocalStorage(KEY)) !== JSON.stringify(evidence))
      throw new Error('Phone replay evidence was not persisted')
    captured(evidence)
    throw new Error('Synthetic successful response lost')
  }
  client.commitRaw = intercept
  cancellations.set(app, cancel)
  let timer: number | undefined
  try {
    await app.vault.create(path, content)
    svc.resume()
    const e = await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error('Successful phone commit was not observed')),
          30000
        )
      }),
    ])
    return { beforeCount: e.beforeCount, captured: true }
  } catch (error) {
    cancel()
    app.saveLocalStorage(KEY, null)
    throw error
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}
export async function verifyPhoneReplay(app: App): Promise<{
  beforeCount: number
  afterCount: number
  versionUnchanged: boolean
  localExact: boolean
  replayed: boolean
}> {
  const e = app.loadLocalStorage(KEY) as Evidence | null,
    svc = SyncService.getInstance()
  if (!e || svc.status.value.state !== 'idle' || svc.status.value.pending !== 0)
    throw new Error('Phone replay has not settled')
  const versions = await svc.client().versions(e.fileId)
  const result = {
    beforeCount: e.beforeCount,
    afterCount: versions.length,
    versionUnchanged: versions[0]?.version_id === e.versionId,
    localExact: (await app.vault.adapter.read(e.path)) === e.content,
    replayed: svc.log.value.some((line) => line.includes('push: replaying')),
  }
  if (
    result.beforeCount !== 1 ||
    result.afterCount !== 1 ||
    !result.versionUnchanged ||
    !result.localExact ||
    !result.replayed
  )
    throw new Error('Phone replay evidence failed')
  app.saveLocalStorage(KEY, null)
  return result
}
export function clearPhoneReplayEvidence(app: App): void {
  cancellations.get(app)?.()
  app.saveLocalStorage(KEY, null)
}
