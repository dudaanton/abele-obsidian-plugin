import { nativeSyncFailure } from './mobileTransport'
import { markRaw, shallowRef } from 'vue'
import {
  TokenConnectionRegistry,
  type DeviceTokenSecrets,
  type TokenConnectionRecord,
} from './tokenConnectionRegistry'
import { V2Client, decodeAccessToken, V2ClientError } from './v2/client'
import type { V2Scope, V2TokenInfo } from './v2/contract'
import type { ExecutableCandidate, ExecutableApplyPort } from './executableReview'
import type { ConsentResolvePort, AttachmentQuestion } from './attachmentConsent'
import type { openDeviceReviews } from './openDeviceReviews'
import type { ReviewSource } from './reviewState'

export function connectionError(error: unknown): string {
  const native = nativeSyncFailure(error)
  if (native) return native.message
  if (error instanceof ConnectStageError) return error.message
  if (error instanceof Error && /External files:|Sync recovery required/.test(error.message))
    return 'Sync recovery required. Files and connection have been kept.'
  const code = (error as { code?: string } | null)?.code
  if (
    code === 'offline' &&
    error instanceof Error &&
    /was cut off before its body arrived/.test(error.message)
  )
    return 'The server response was cut off before it finished. Try syncing again.'
  if (code === 'startup-stage' && error instanceof Error) return error.message
  return (
    (
      {
        'bad-token': 'This token is damaged or incomplete. Paste the whole token again.',
        unreachable: 'The server is not reachable. Check your connection and try again.',
        revoked: 'Access is closed. Ask for a new token.',
        unauthorized: 'Access is closed. Ask for a new token.',
        offline: 'The server is not reachable. Check your connection and try again.',
        scope_updating: 'The group is still being prepared. File exchange has not started.',
        quota_exceeded: 'The server is full. Your unsent files stay on this device.',
        too_large: 'This file is too large for the server. It stays on this device.',
        quota_waiting:
          'The server is full. The file stays here and can be sent after space is available.',
        forbidden: 'This connection does not allow that action.',
        scope_unavailable: 'This folder or group is no longer available.',
      } as Record<string, string>
    )[code ?? ''] ?? 'The action could not finish. Your files have been kept. Try again.'
  )
}
class ConnectStageError extends Error {}
/** Bound an individual stage and revoke its permission to perform later effects. */
export async function connectStage<T>(
  name: string,
  message: string,
  work: (assertCurrent: () => void, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController()
  const failure = new ConnectStageError(message)
  const assertCurrent = () => {
    if (Date.now() - started >= 10000) controller.abort()
    if (controller.signal.aborted) throw failure
  }
  const started = Date.now()
  let timer: number | undefined
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        assertCurrent()
        return work(assertCurrent, controller.signal)
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(failure), { once: true })
        if (controller.signal.aborted) reject(failure)
        timer = window.setTimeout(cancel, 10000)
      }),
    ])
  } catch (error) {
    controller.abort()
    if (
      error instanceof V2ClientError ||
      error instanceof ConnectStageError ||
      /Sync recovery required|External files:/.test(String(error))
    )
      throw error
    throw failure
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    console.debug(
      '[Abele Connect]',
      name,
      Date.now() - started,
      'ms',
      controller.signal.aborted ? 'failed' : 'complete'
    )
  }
}
export const scopeName = (scope: V2Scope | null) =>
  !scope
    ? 'Not connected'
    : scope.kind === 'group'
      ? 'Group: ' + scope.path.split('/').pop().replace(/\.md$/i, '')
      : scope.path === '/'
        ? 'Whole vault'
        : 'Folder: ' + scope.path
export const connectionName = (record: Pick<TokenConnectionRecord, 'scope' | 'address'>) =>
  scopeName(record.scope) + ' · ' + new URL(record.address).host
export const statusName = (status: string) =>
  (
    ({
      idle: 'Ready',
      syncing: 'Syncing',
      paused: 'Paused',
      offline: 'Server unavailable',
      error: 'Needs attention',
      disconnected: 'Not connected',
      'needs-token': 'Needs a token',
      joining: 'Connecting',
      scope_unavailable: 'Access unavailable',
      scope_updating: 'Updating access',
    }) as Record<string, string>
  )[status] ?? 'Needs attention'
export interface ConnectionActivity {
  comparison?: { completed: number; total: number }
  startup?: {
    stage: string
    completed: number
    total: number
    startedAt: number
    progressAt: number
    outcome?: 'failed'
  }
  startupTimings?: {
    stage: string
    startedAt: number
    durationMs: number
    outcome: 'complete' | 'failed' | 'cancelled'
  }[]
  inspection?: { completed: number; total: number }
  heldDeletes?: number
  deferred?: number
  pending?: number
  lastSync?: number
  completed?: number
  total?: number
  refused?: { path: string; reason: string }[]
  conflicts?: string[]
  error?: string
}
export function connectionStatusText(
  row: Pick<TokenConnectionRecord, 'status' | 'paused'>,
  activity?: ConnectionActivity
): string {
  if (activity?.startup) {
    const one = activity.startup
    return `${one.stage}… ${one.completed}/${one.total}${one.outcome === 'failed' ? ' · Needs attention' : ''}`
  }
  if (activity?.inspection)
    return `Checking the vault… ${activity.inspection.completed}/${activity.inspection.total}`
  if (activity?.comparison)
    return `Comparing files ${activity.comparison.completed}/${activity.comparison.total}`
  if (
    row.status === 'offline' &&
    activity?.error === 'The server response was cut off before it finished. Try syncing again.'
  )
    return 'Server response interrupted'
  return statusName(row.paused ? 'paused' : row.status)
}
export interface TokenUiRuntime extends ExecutableApplyPort, ConsentResolvePort {
  scanSnapshot?(): ReturnType<import('./exchangeTrace').ExchangeTrace['snapshot']>
  assertCurrent?(): void
  sync(): Promise<void>
  pause(paused: boolean): Promise<void>
  disconnect(): Promise<void>
  /** Stable local identities already recorded by the engine, never derived from a path. */
  opened(path: string): Promise<{ source: ReviewSource; noteId: string }[]>
  publishAttachment?(fileId: string): Promise<void>
  updateSelective?(selective: import('@abele/sync-core').SelectiveSettings): Promise<void>
  historyClient?: import('@abele/sync-core').V2EngineClient
  entryFor?(path: string): Promise<import('@abele/sync-core').StateEntry | null>
  heldDeletes?(): Promise<import('@abele/sync-core').HeldDelete[]>
  decideDeletes?(
    kind: 'confirm' | 'restore',
    ids: readonly string[]
  ): Promise<{ decided: number; applied: boolean; completed?: number } | null>
  deferred?(): Promise<import('@abele/sync-protocol').ChangeItem[]>
  applyDeferred?(
    ids: readonly string[]
  ): Promise<import('./stagedSettings').DeferredSettingsBatch | null>
  keepLocal?(
    paths: string[] | undefined,
    ids: readonly string[]
  ): Promise<import('@abele/sync-core').DeferredKept | null>
}
export type DeviceReviews = Awaited<ReturnType<typeof openDeviceReviews>>
const noConnectionHost = async () => {}
export class TokenUi {
  connectionChangeGuard: (id?: string, assertCurrent?: () => void) => Promise<void> = async () => {}
  connectionsChanged: (assertCurrent?: () => void) => Promise<void> = noConnectionHost
  retryConnection: (id: string, assertCurrent: () => void) => Promise<void> = async (
    _,
    assertCurrent
  ) => this.connectionsChanged(assertCurrent)
  openFile: (path: string) => Promise<void> = async () => {}
  readonly rows = shallowRef<TokenConnectionRecord[]>([])
  readonly activity = shallowRef<Record<string, ConnectionActivity>>({})
  readonly candidates = shallowRef<ExecutableCandidate[]>([])
  readonly questions = shallowRef<AttachmentQuestion[]>([])
  readonly available = shallowRef(false)
  readonly runtimes = new Map<string, TokenUiRuntime>()
  constructor(
    readonly registry: TokenConnectionRegistry,
    private readonly secrets: DeviceTokenSecrets & { remove(reference: string): void },
    private readonly transport: typeof fetch,
    readonly reviews?: DeviceReviews
  ) {
    // Vue must observe the exposed refs, never proxy IndexedDB/state/runtime host objects.
    markRaw(this)
    this.registry.finishForgotten(this.secrets)
    this.refresh()
    const activity: Record<string, ConnectionActivity> = {}
    for (const row of this.rows.value) {
      const lastSync = this.registry
        .storage(row.id)
        .loadLocalStorage('abele-sync-token-state:last-sync')
      if (typeof lastSync === 'number' && Number.isSafeInteger(lastSync) && lastSync >= 0)
        activity[row.id] = { lastSync }
    }
    this.activity.value = activity
  }
  refresh(): void {
    this.rows.value = this.registry.records()
  }
  async refreshReviews(): Promise<void> {
    if (!this.reviews) return
    this.candidates.value = await this.reviews.executables.pending()
    this.questions.value = await this.reviews.attachments.pending()
  }
  bind(id: string, runtime: TokenUiRuntime): () => void {
    this.runtimes.set(id, runtime)
    this.available.value = true
    this.refresh()
    return () => {
      if (this.runtimes.get(id) === runtime) this.runtimes.delete(id)
      this.available.value = this.runtimes.size > 0
      this.refresh()
    }
  }
  publish(id: string, activity: ConnectionActivity): void {
    if (!this.registry.records().some((one) => one.id === id)) return
    if (activity.lastSync !== undefined) {
      if (!Number.isSafeInteger(activity.lastSync) || activity.lastSync < 0)
        throw new Error('Invalid sync time')
      this.registry
        .storage(id)
        .saveLocalStorage('abele-sync-token-state:last-sync', activity.lastSync)
    }
    this.activity.value = {
      ...this.activity.value,
      [id]: { ...this.activity.value[id], ...structuredClone(activity) },
    }
    this.refresh()
    void this.refreshReviews().catch(() => {
      this.activity.value = {
        ...this.activity.value,
        [id]: {
          ...this.activity.value[id],
          error: 'Incoming changes could not be opened. Restart Obsidian and try again.',
        },
      }
    })
  }
  inspectionProgress(id: string, completed: number, total: number): void {
    this.startupProgress(id, completed, total)
    this.activity.value = {
      ...this.activity.value,
      [id]: { ...this.activity.value[id], inspection: { completed, total }, error: undefined },
    }
  }
  startupStage(id: string, stage: string): void {
    if (this.activity.value[id]?.startup?.stage === stage) return
    this.finishStartup(id, 'complete')
    const now = Date.now()
    this.activity.value = {
      ...this.activity.value,
      [id]: {
        ...this.activity.value[id],
        startup: { stage, completed: 0, total: 1, startedAt: now, progressAt: now },
      },
    }
    console.debug('[Abele Sync startup]', id, stage, 'started')
  }
  startupProgress(id: string, completed: number, total: number): void {
    const old = this.activity.value[id]?.startup
    if (!old) return
    this.activity.value = {
      ...this.activity.value,
      [id]: {
        ...this.activity.value[id],
        startup: {
          ...old,
          completed,
          total,
          progressAt: completed > old.completed || total > old.total ? Date.now() : old.progressAt,
        },
      },
    }
  }
  finishStartup(id: string, outcome: 'complete' | 'failed' | 'cancelled'): void {
    const activity = this.activity.value[id]
    if (!activity?.startup || activity.startup.outcome) return
    const { stage, startedAt } = activity.startup
    const timing = { stage, startedAt, durationMs: Date.now() - startedAt, outcome }
    this.activity.value = {
      ...this.activity.value,
      [id]: {
        ...activity,
        startup: outcome === 'failed' ? { ...activity.startup, outcome } : undefined,
        startupTimings: [...(activity.startupTimings ?? []), timing].slice(-64),
      },
    }
    console.debug('[Abele Sync startup]', id, stage, timing.durationMs, 'ms', outcome)
  }
  startupSnapshot() {
    return this.rows.value.map((row) => ({
      id: row.id,
      statusText: connectionStatusText(row, this.activity.value[row.id]),
      startup: this.activity.value[row.id]?.startup ?? null,
      inspection: this.activity.value[row.id]?.inspection ?? null,
      startupTimings: this.activity.value[row.id]?.startupTimings ?? [],
    }))
  }
  async connect(text: string, signal?: AbortSignal): Promise<void> {
    // Validate with the server before adding a row. Failed paste leaves all existing rows intact.
    const token = decodeAccessToken(text),
      client = new V2Client(token, this.transport)
    if (typeof token.address !== 'string') throw new V2ClientError('bad-token')
    const guard = () =>
      connectStage(
        'checking vault',
        'Checking the vault could not finish. Try again.',
        async (assertCurrent) => {
          await this.connectionChangeGuard(undefined, assertCurrent)
          assertCurrent()
        },
        signal
      )
    await guard()
    const authority = await connectStage(
      'checking server',
      'The server is not reachable. Check your connection and try again.',
      (_, stageSignal) => client.connection(stageSignal),
      signal
    )
    await guard()
    if (signal?.aborted) throw new ConnectStageError('Connection cancelled.')
    if (token.scope.kind !== authority.scope.kind || token.scope.id !== authority.scope.id)
      throw new V2ClientError('bad-token')
    const pending = this.registry
      .records()
      .find(
        (one) =>
          (one.pending ?? one).address === token.address &&
          (one.pending ?? one).spaceId === authority.space_id &&
          (one.pending ?? one).tokenId === authority.token_id &&
          (one.pending ?? one).scope?.kind === authority.scope.kind &&
          (one.pending ?? one).scope?.id === authority.scope.id
      )
    const id = await connectStage(
      'saving connection',
      'Saving the connection failed. Try again.',
      async (assertCurrent, stageSignal) => {
        let savedId = pending?.id
        try {
          assertCurrent()
          savedId ??= this.registry.add()
          assertCurrent()
          this.registry.attach(
            savedId,
            { ...token, address: token.address },
            authority,
            this.secrets
          )
          return savedId
        } catch (error) {
          if (stageSignal.aborted && savedId && !pending) {
            this.registry.beginForget(savedId)
            this.registry.finishForgotten(this.secrets, savedId)
          }
          throw new ConnectStageError(
            `Saving the connection failed. Try again. ${error instanceof Error ? error.message : ''}`
          )
        } finally {
          this.refresh()
        }
      },
      signal
    )
    if (this.connectionsChanged === noConnectionHost) return
    if (!this.runtimes.has(id)) this.registry.setStatus(id, 'joining')
    this.refresh()
    void connectStage(
      'starting sync',
      'Could not finish starting sync. Try Sync now again.',
      (assertCurrent) => this.connectionsChanged(assertCurrent)
    )
      .then(() => {
        if (
          !this.runtimes.has(id) &&
          !this.activity.value[id]?.inspection &&
          this.registry.records().find((one) => one.id === id)?.status === 'joining'
        ) {
          this.registry.setStatus(id, 'error')
          this.publish(id, { error: 'Could not finish starting sync. Try Sync now again.' })
        }
      })
      .catch((error) => {
        if (!this.registry.records().some((one) => one.id === id)) return
        this.registry.setStatus(id, 'error')
        this.publish(id, { error: connectionError(error) })
      })
  }
  async updateConnection(
    id: string,
    patch: {
      address?: string
      paused?: boolean
      selective?: import('@abele/sync-core').SelectiveSettings
    }
  ): Promise<void> {
    if (patch.address !== undefined) {
      await this.connectionChangeGuard()
      this.registry.setAddress(id, patch.address)
    }
    if (patch.paused !== undefined) await this.pause(id, patch.paused)
    if (patch.selective !== undefined) {
      this.registry.setSelective(id, patch.selective)
    }
    this.refresh()
    try {
      if (patch.selective !== undefined)
        await this.runtimes.get(id)?.updateSelective?.(patch.selective)
      await this.connectionsChanged()
    } catch (error) {
      this.registry.setStatus(id, 'error')
      this.publish(id, { error: connectionError(error) })
    }
  }
  client(id: string): V2Client {
    const record = this.registry.records().find((one) => one.id === id)
    const key = record && this.secrets.get(record.secretReference)
    if (!record?.scope || !key) throw new V2ClientError('bad-token')
    return new V2Client({ v: 1, address: record.address, key, scope: record.scope }, this.transport)
  }
  async sync(id: string): Promise<void> {
    const record = this.registry.records().find((one) => one.id === id)
    if (!record || record.paused) throw new Error('Sync is paused')
    const runtime = this.runtimes.get(id)
    if (!runtime) {
      await this.retryConnection(id, () => {
        if (!this.registry.records().some((one) => one.id === id))
          throw new ConnectStageError('Connection cancelled.')
      })
      if (!this.runtimes.has(id) && !this.activity.value[id]?.inspection)
        throw new ConnectStageError('Could not finish starting sync. Try Sync now again.')
      return
    }
    await runtime.sync()
    this.refresh()
  }
  async pause(id: string, paused: boolean): Promise<void> {
    this.registry.setPaused(id, paused)
    this.refresh()
    await this.runtimes.get(id)?.pause(paused)
  }
  async disconnect(id: string): Promise<void> {
    const record = this.registry.records().find((one) => one.id === id)
    if (!record) return
    this.runtimes.get(id)?.assertCurrent?.()
    await this.connectionChangeGuard(id)
    this.runtimes.get(id)?.assertCurrent?.()
    const current = this.registry.records().find((one) => one.id === id)
    // Exchange status can change while materializing; authority and policy must not.
    const identity = (one: typeof record | undefined) =>
      one && { ...one, status: 'exchange-status' }
    if (JSON.stringify(identity(current)) !== JSON.stringify(identity(record)))
      throw new Error('Connection changed while disconnecting')
    this.registry.beginForget(id)
    this.refresh()
    await this.runtimes.get(id)?.disconnect()
    // Local disconnect is not revocation: other tokens and all local files remain untouched.
    this.registry.finishForgotten(this.secrets, id)
    this.runtimes.delete(id)
    this.available.value = this.runtimes.size > 0
    this.refresh()
  }
  async choices(id: string): Promise<V2Scope[]> {
    const record = this.registry.records().find((one) => one.id === id)
    const scopes: V2Scope[] = record.scope ? [record.scope] : []
    let next: string | null = null
    do {
      const page = await this.client(id).manifest(next)
      for (const item of page.items) {
        if (item.kind === 'directory' || item.kind === 'note')
          scopes.push({
            kind: item.kind === 'directory' ? 'folder' : 'group',
            id: item.file_id,
            path: item.path,
          })
      }
      next = page.next
    } while (next !== null)
    return scopes.filter(
      (one, index) =>
        scopes.findIndex((other) => other.kind === one.kind && other.id === one.id) === index
    )
  }
  async issued(id: string): Promise<V2TokenInfo[]> {
    // The server lists exactly the tokens this caller may revoke, including root-owner access.
    return (await this.client(id).tokens()).items
  }
  async approve(candidate: ExecutableCandidate): Promise<void> {
    const runtime = this.runtimes.get(candidate.source.id)
    if (!runtime || !this.reviews) throw new Error('File exchange is not available in this build')
    await this.reviews.executables.approve([candidate.id], runtime)
    await this.refreshReviews()
  }
  async reject(candidate: ExecutableCandidate): Promise<void> {
    await this.reviews?.executables.reject([candidate.id])
    await this.refreshReviews()
  }
  async decide(question: AttachmentQuestion, allow: boolean): Promise<void> {
    const runtime = this.runtimes.get(question.source.id)
    if (!runtime || !this.reviews) throw new Error('File exchange is not available in this build')
    if (!(await this.reviews.attachments.decide(question.id, allow, runtime)))
      throw new Error('File changed; reopen the note')
    if (allow) await runtime.publishAttachment?.(question.fileId)
    await this.refreshReviews()
  }
  async opened(path: string): Promise<void> {
    await Promise.allSettled(
      [...this.runtimes.values()].map(async (runtime) => {
        for (const note of await runtime.opened(path)) {
          await this.reviews?.attachments.noteOpened(note.source, note.noteId, runtime)
        }
      })
    )
    await this.refreshReviews()
  }
}

// Installed by the plugin, shared by settings and the workspace's review dialogs.
export const tokenUi = shallowRef<TokenUi | null>(null)
