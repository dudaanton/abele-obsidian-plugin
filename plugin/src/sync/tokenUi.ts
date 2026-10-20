import { settingsSyncText } from '@/i18n/settingsSync'
import { ServerDeleteWait } from '@/components/sync/serverDelete'
import { t } from '@/i18n'
import { englishSyncText, type SyncText } from './presentation'
import { MobileWholeReadLimitError } from './mobileWholeRead'
import { FolderScopeError } from './scopedFileSystem'
import { nativeSyncFailure } from './mobileTransport'
import { LocalPlacementError } from './localFolderPlacement'
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
import { reviewSourceOf, sourceIdentity, type ReviewSource } from './reviewState'
import { transferText } from './transferProgress'

/** Its owner deleted what this connection opens; the device stops and keeps every file. */
export const SCOPE_DELETED = 'Deleted on the server. Every file stays on this device.'
export function connectionError(
  error: unknown,
  startup = false,
  text: SyncText = englishSyncText
): string {
  if (error instanceof MobileWholeReadLimitError) return error.message
  if (error instanceof LocalPlacementError || error instanceof FolderScopeError)
    return error.message
  const native = nativeSyncFailure(error)
  if (native) return native.message
  if (error instanceof ConnectStageError) return error.message
  if (error instanceof Error && /External files:|Sync recovery required/.test(error.message))
    return startup
      ? error.message
      : text('Sync recovery required. Files and connection have been kept.')
  const code = (error as { code?: string } | null)?.code
  if (
    code === 'offline' &&
    error instanceof Error &&
    /was cut off before its body arrived/.test(error.message)
  )
    return text('The server response was cut off before it finished. Try syncing again.')
  if (error instanceof FolderScopeError) return error.message
  if (code === 'startup-stage' && error instanceof Error) return error.message
  return text(
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
        protocol: 'The server response could not be trusted; sync stopped. Local files were kept.',
        scope_unavailable: 'This folder or group is no longer available.',
        scope_deleted: SCOPE_DELETED,
      } as Record<string, string>
    )[code ?? ''] ??
      (startup && error instanceof Error && error.message
        ? error.message
        : 'The action could not finish. Your files have been kept. Try again.')
  )
}
class ConnectStageError extends Error {}
export function failureDetails(error: unknown): { reason: string; code?: string } {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const cause = Reflect.get(error, 'cause')
    if (!cause || seen.has(cause)) break
    error = cause
  }
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
  const message = error && typeof error === 'object' ? Reflect.get(error, 'message') : error
  return {
    reason: typeof message === 'string' ? message : 'Unknown sync failure',
    ...(typeof code === 'string' ? { code } : {}),
  }
}
/** Bound an individual stage and revoke its permission to perform later effects. */
export async function connectStage<T>(
  name: string,
  message: string,
  work: (assertCurrent: () => void, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  clock: Pick<Window, 'setTimeout' | 'clearTimeout'> = window
): Promise<T> {
  const controller = new AbortController()
  const failure = new ConnectStageError(message)
  const assertCurrent = () => {
    if (Date.now() - started >= 10000) controller.abort()
    if (controller.signal.aborted) throw failure
  }
  const started = Date.now()
  let timer: ReturnType<typeof clock.setTimeout> | undefined
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
        timer = clock.setTimeout(cancel, 10000)
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
    failure.cause = error
    throw failure
  } finally {
    clock.clearTimeout(timer)
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
/** The server's stand-in path for a grant whose folder or group has left the caller's scope. */
const UNAVAILABLE_SCOPE_PATH = '(unavailable)'
export const scopeName = (scope: V2Scope | null, text: SyncText = englishSyncText) =>
  !scope
    ? text('Not connected')
    : scope.path === UNAVAILABLE_SCOPE_PATH
      ? text(
          scope.kind === 'group'
            ? 'Group outside this connection'
            : 'Folder outside this connection'
        )
      : scope.kind === 'group'
        ? text('Group: {name}', { name: scope.path.split('/').pop().replace(/\.md$/i, '') })
        : scope.path === '/'
          ? text('Whole vault')
          : text('Folder: {path}', { path: scope.path })
/** A connection's name without its server: the group, the folder's own name, or the vault. */
export const scopeShortName = (scope: V2Scope | null, text: SyncText = englishSyncText) =>
  !scope || scope.path === UNAVAILABLE_SCOPE_PATH
    ? scopeName(scope, text)
    : scope.kind === 'group'
      ? scope.path.split('/').pop().replace(/\.md$/i, '')
      : scope.path === '/'
        ? text('Whole vault')
        : scope.path.split('/').pop()
export const connectionName = (
  record: Pick<TokenConnectionRecord, 'scope' | 'address'>,
  text: SyncText = englishSyncText
) => scopeName(record.scope, text) + ' · ' + new URL(record.address).host
export const statusName = (status: string, text: SyncText = englishSyncText) =>
  text(
    (
      {
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
      } as Record<string, string>
    )[status] ?? 'Needs attention'
  )
export interface ConnectionActivity {
  /** Diagnostics only: the code and original message behind `error`'s friendly text. */
  failure?: { code?: string; message: string; reason?: string; stage?: string }
  transfer?: import('./transferProgress').TransferSnapshot
  reconciliation?: import('@abele/sync-sdk/core').ReconciliationState | null
  pull?: { stage: string; completed: number; total: number }
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
  /** The last few things that happened to the connection, oldest first, in the person's words. */
  events?: { at: number; text: string }[]
}
export function connectionStatusText(
  row: Pick<TokenConnectionRecord, 'status' | 'paused' | 'rootIssue'>,
  activity?: ConnectionActivity,
  text: SyncText = englishSyncText
): string {
  if (activity?.error === SCOPE_DELETED) return text('Deleted on the server')
  if (activity?.reconciliation && activity.reconciliation.phase !== 'complete')
    return activity.reconciliation.reason.startsWith('server generation changed')
      ? text('The server was restored from a backup — checking files')
      : text('Checking restored files')
  if (row.rootIssue?.kind === 'server-renamed')
    return text('Shared folder renamed on the server: {from} → {to}; sync stopped', {
      from: row.rootIssue.from,
      to: row.rootIssue.to,
    })
  if (row.rootIssue)
    return row.rootIssue.kind === 'moved'
      ? text('Folder moved to {path}; sync stopped', { path: row.rootIssue.path })
      : text('Folder is gone; sync stopped')
  if (row.status === 'scope_unavailable')
    return text('Server folder or group unavailable; local files kept')
  if (row.status === 'needs-token' && activity?.error)
    return text('Access closed; local files kept')
  if (activity?.startup) {
    const one = activity.startup
    return text('{stage}… {completed}/{total}{attention}', {
      stage: text(one.stage),
      completed: one.completed,
      total: one.total,
      attention: one.outcome === 'failed' ? text(' · Needs attention') : '',
    })
  }
  if (activity?.inspection)
    return text('Checking the vault… {completed}/{total}', activity.inspection)
  if (!row.paused && row.status === 'syncing' && activity?.transfer)
    return transferText(activity.transfer, text)
  if (activity?.comparison) return text('Comparing files {completed}/{total}', activity.comparison)
  if (
    row.status === 'offline' &&
    activity?.error === 'The server response was cut off before it finished. Try syncing again.'
  )
    return text('Server response interrupted')
  return statusName(row.paused ? 'paused' : row.status, text)
}
export interface TokenUiRuntime extends ExecutableApplyPort, ConsentResolvePort {
  localPath?(path: string): string
  scanSnapshot?(): ReturnType<import('./exchangeTrace').ExchangeTrace['snapshot']>
  assertCurrent?(): void
  sync(): Promise<void>
  reconcile?(): Promise<void>
  restoreRoot?(): Promise<void>
  followRoot?(): Promise<void>
  followServerRoot?(): Promise<void>
  pause(paused: boolean): Promise<void>
  disconnect(): Promise<void>
  /** Stable local identities already recorded by the engine, never derived from a path. */
  opened(path: string): Promise<{ source: ReviewSource; noteId: string }[]>
  publishAttachment?(fileId: string): Promise<void>
  updateSelective?(selective: import('@abele/sync-sdk/core').SelectiveSettings): Promise<void>
  historyClient?: import('@abele/sync-sdk/core').V2EngineClient
  /** Whether this connection syncs the vault file: in its scope and not kept out by its rules. */
  acceptsLocal?(path: string, size: number): boolean
  entryFor?(path: string): Promise<import('@abele/sync-sdk/core').StateEntry | null>
  heldDeletes?(): Promise<import('@abele/sync-sdk/core').HeldDelete[]>
  decideDeletes?(
    kind: 'confirm' | 'restore',
    ids: readonly string[]
  ): Promise<{ decided: number; applied: boolean; completed?: number } | null>
  deferred?(): Promise<import('@abele/sync-sdk/protocol').ChangeItem[]>
  applyDeferred?(
    ids: readonly string[]
  ): Promise<import('./stagedSettings').DeferredSettingsBatch | null>
  keepLocal?(
    paths: string[] | undefined,
    ids: readonly string[]
  ): Promise<import('@abele/sync-sdk/core').DeferredKept | null>
}
export type DeviceReviews = Awaited<ReturnType<typeof openDeviceReviews>>
const noConnectionHost = async () => {}
export class TokenUi {
  connectFailure?: { reason: string; code?: string }
  connectionChangeGuard: (
    id?: string,
    assertCurrent?: () => void,
    scope?: V2Scope
  ) => Promise<void> = async () => {}
  connectionsChanged: (assertCurrent?: () => void) => Promise<void> = noConnectionHost
  disconnectRuntime: (id: string) => Promise<void> = async (id) => {
    await this.runtimes.get(id)?.disconnect()
  }
  /** Stop a connection's sync for good: abort its requests and wait for its effects to drain. */
  stopRuntime: (id: string) => Promise<void> = async (id) => {
    await this.runtimes.get(id)?.disconnect()
  }
  private readonly deletionStops = new Map<string, Promise<void>>()
  private readonly deletionGuards = new Map<string, Promise<void>>()
  private readonly deletionDisconnects = new Map<string, Promise<void>>()
  /** How long a deletion waits before returning a retryable failure. */
  runtimeStopLimitMs = 15000
  connectionForgotten: (id: string) => Promise<void> = async () => {}
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
  readonly approvalStatus = shallowRef<Record<string, string>>({})
  private readonly installing = new Map<string, Promise<void>>()
  private readonly deletionFacts = new Map<
    string,
    import('@/components/sync/serverDelete').ServerDeleteFacts
  >()
  private readonly deletions = new Map<string, Promise<void>>()
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
      if (row.state['abele-sync-token-state:scope-deleted']) {
        activity[row.id] = { error: SCOPE_DELETED }
        continue
      }
      if (row.state['abele-sync-token-state:server-delete']) {
        activity[row.id] = {
          error: 'Server deletion is awaiting confirmation. Retry Delete from the server.',
        }
        continue
      }
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
  setTrusted(id: string, trusted: boolean): void {
    this.registry.setTrusted(id, trusted)
    this.refresh()
  }
  private trusted(source: ReviewSource): boolean {
    const row = this.registry.records().find((one) => one.id === source.id)
    return (
      !!row?.trusted &&
      !!row.scope &&
      sourceIdentity(reviewSourceOf(row)) === sourceIdentity(source)
    )
  }
  private reviewRefresh: Promise<void> = Promise.resolve()
  async refreshReviews(): Promise<void> {
    const next = this.reviewRefresh.then(() => this.refreshReviewsNow())
    this.reviewRefresh = next.catch(() => {})
    return next
  }
  private async refreshReviewsNow(): Promise<void> {
    if (!this.reviews) return
    const reviews = this.reviews
    const local = (id: string, path: string) => this.runtimes.get(id)?.localPath?.(path) ?? path
    // Reviews keep their canonical server paths; only what the panel shows is local.
    const publish = async () => {
      const candidates = await reviews.executables.pending()
      const questions = await reviews.attachments.pending()
      this.candidates.value = candidates.map((one) => ({
        ...one,
        path: local(one.source.id, one.path),
        previousPath: one.previousPath ? local(one.source.id, one.previousPath) : one.previousPath,
      }))
      this.questions.value = questions.map((one) => ({
        ...one,
        path: local(one.source.id, one.path),
      }))
      return { candidates, questions }
    }
    // Also retire reviews left by older builds. Snapshot only orphan IDs: a new
    // connection may stage its own deliveries while these durable writes wait.
    const stored = await reviews.executables.state()
    const connected = new Set(this.registry.records().map((one) => one.id))
    for (const id of new Set(stored.map((one) => one.source.id)))
      if (!connected.has(id) && !this.runtimes.has(id)) await reviews.executables.forgetSource(id)
    const { candidates, questions } = await publish()
    for (const candidate of candidates) {
      const runtime = this.runtimes.get(candidate.source.id)
      if (candidate.status === 'queued') {
        void this.installApproval(candidate)
        continue
      }
      if (!runtime || !this.trusted(candidate.source) || this.installing.has(candidate.id)) continue
      const revoked = new Error('Connection trust changed')
      const assertAllowed = () => {
        if (!this.trusted(candidate.source)) throw revoked
      }
      const installation = reviews.executables.approve([candidate.id], {
        apply: async (one) => {
          assertAllowed()
          await runtime.apply(one, assertAllowed)
        },
      })
      this.installing.set(candidate.id, installation)
      try {
        await installation
        this.recordEvent(
          candidate.source.id,
          `Installed code from ${scopeName(candidate.source.scope)}: ${local(candidate.source.id, candidate.path)}`
        )
        if (this.approvalStatus.value[candidate.id])
          this.setApprovalStatus(candidate.id, 'Approved and installed.')
      } catch (error) {
        if (this.approvalStatus.value[candidate.id])
          this.setApprovalStatus(
            candidate.id,
            'Approved — installation could not finish. ' + connectionError(error)
          )
        if (error !== revoked)
          this.reviewFailure(candidate.source.id, local(candidate.source.id, candidate.path), error)
      } finally {
        this.installing.delete(candidate.id)
      }
    }
    for (const question of questions) {
      const runtime = this.runtimes.get(question.source.id)
      if (!runtime || !this.trusted(question.source)) continue
      try {
        if (
          await reviews.attachments.decide(question.id, true, runtime, () =>
            this.trusted(question.source)
          )
        ) {
          await runtime.publishAttachment?.(question.fileId)
          this.recordEvent(question.source.id, `Shared ${local(question.source.id, question.path)}`)
        }
      } catch (error) {
        this.reviewFailure(question.source.id, local(question.source.id, question.path), error)
      }
    }
    await publish()
  }
  private reviewFailure(id: string, path: string, error: unknown): void {
    const reason =
      error instanceof Error &&
      error.message === 'The local file changed; this version remains pending'
        ? error.message
        : connectionError(error)
    this.activity.value = {
      ...this.activity.value,
      [id]: { ...this.activity.value[id], error: `${path}: ${reason}` },
    }
    console.debug('[Abele Sync] Automatic approval failed', path, error)
  }
  recordEvent(id: string, text: string): void {
    this.activity.value = {
      ...this.activity.value,
      [id]: {
        ...this.activity.value[id],
        events: [...(this.activity.value[id]?.events ?? []), { at: Date.now(), text }].slice(-100),
      },
    }
  }
  bind(id: string, runtime: TokenUiRuntime): () => void {
    this.runtimes.set(id, runtime)
    this.available.value = true
    this.refresh()
    void this.refreshReviews().catch((error) => this.reviewFailure(id, '', error))
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
      if (!this.registry.records().some((one) => one.id === id)) return
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
      [id]: {
        ...this.activity.value[id],
        inspection: { completed, total },
        error: undefined,
        failure: undefined,
      },
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
    this.connectFailure = undefined
    try {
      await this.connectToken(text, signal)
    } catch (error) {
      this.connectFailure = failureDetails(error)
      throw error
    }
  }
  private async connectToken(text: string, signal?: AbortSignal): Promise<void> {
    // Validate with the server before adding a row. Failed paste leaves all existing rows intact.
    const token = decodeAccessToken(text),
      client = new V2Client(token, this.transport)
    if (typeof token.address !== 'string') throw new V2ClientError('bad-token')
    const guard = () =>
      connectStage(
        'checking vault',
        'Checking the vault could not finish. Try again.',
        async (assertCurrent) => {
          await this.connectionChangeGuard(undefined, assertCurrent, token.scope)
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
      selective?: import('@abele/sync-sdk/core').SelectiveSettings
    }
  ): Promise<void> {
    if (patch.address !== undefined) {
      await this.connectionChangeGuard(
        undefined,
        undefined,
        this.registry.records().find((one) => one.id === id)?.scope ?? undefined
      )
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
  async serverDeleteFacts(
    id: string
  ): Promise<import('@/components/sync/serverDelete').ServerDeleteFacts> {
    const pending = this.registry
      .storage(id)
      .loadLocalStorage('abele-sync-token-state:server-delete') as {
      facts?: import('@/components/sync/serverDelete').ServerDeleteFacts
    } | null
    if (pending?.facts) return pending.facts
    const client = this.client(id)
    const authority = await client.connection()
    const tokens = await client.tokens()
    let files = 0,
      bytes = 0,
      next: string | null = null
    const members = new Set<string>([authority.scope.id])
    do {
      const page = await client.manifest(next)
      for (const item of page.items) {
        members.add(item.file_id)
        if (item.kind !== 'directory') {
          files++
          bytes += item.size
        }
      }
      next = page.next
    } while (next !== null)
    const facts = {
      files,
      bytes,
      canWrite: authority.read_only === false,
      unavailableReason:
        authority.read_only === undefined
          ? 'This server is too old. Update the server to delete a connection.'
          : undefined,
      access: tokens.items
        .filter(
          (one) =>
            !one.revoked_at &&
            (authority.scope.path === '/' ||
              members.has(one.scope.id) ||
              (authority.scope.kind === 'folder' &&
                one.scope.path.startsWith(authority.scope.path + '/')))
        )
        .map((one) => ({ label: one.label, scope: scopeName(one.scope, settingsSyncText) })),
    }
    if (authority.token_id && !tokens.items.some((one) => one.id === authority.token_id))
      facts.access.unshift({
        label: t('streamC.8cc283e26ae77aa1'),
        scope: scopeName(authority.scope, settingsSyncText),
      })
    this.deletionFacts.set(id, facts)
    return facts
  }
  deleteFromServer(id: string): Promise<void> {
    const running = this.deletions.get(id)
    if (running !== undefined) return running
    // An earlier attempt may already have committed, even if this retry fails before sending.
    let requested =
      this.deletionDisconnects.has(id) ||
      !!this.registry.records().find((one) => one.id === id)?.state[
        'abele-sync-token-state:server-delete'
      ]
    const work = this.performServerDeletion(id, () => {
      requested = true
    })
      .catch((error: unknown) => {
        throw Object.assign(error instanceof Error ? error : new Error('Server deletion failed'), {
          deletionOutcome: requested ? 'unknown' : 'not-deleted',
        })
      })
      .finally(() => this.deletions.delete(id))
    this.deletions.set(id, work)
    return work
  }
  private async performServerDeletion(id: string, requesting: () => void): Promise<void> {
    const disconnecting = this.deletionDisconnects.get(id)
    if (disconnecting !== undefined) return this.waitForDeletion(disconnecting, 'disconnect')
    const identity = () => {
      const row = this.registry.records().find((one) => one.id === id)
      return (
        row &&
        JSON.stringify({
          address: row.address,
          spaceId: row.spaceId,
          tokenId: row.tokenId,
          scope: row.scope,
          secretReference: row.secretReference,
        })
      )
    }
    const confirmed = identity()
    const assertCurrent = () => {
      if (!confirmed || identity() !== confirmed)
        throw new Error('Connection changed; open its deletion confirmation again.')
    }
    const storage = this.registry.storage(id)
    const slot = 'abele-sync-token-state:server-delete'
    const previous = storage.loadLocalStorage(slot) as {
      key: string
      identity?: string
      result?: unknown
      facts?: import('@/components/sync/serverDelete').ServerDeleteFacts
    } | null
    if (previous?.identity && previous.identity !== confirmed)
      throw new Error('Connection changed; the earlier server deletion remains unresolved.')
    const attempt = previous ?? {
      key: crypto.randomUUID(),
      identity: confirmed,
      facts: this.deletionFacts.get(id),
    }
    assertCurrent()
    const client = this.client(id)
    storage.saveLocalStorage(slot, attempt)
    this.registry.setStatus(id, 'error')
    this.publish(id, {
      error: 'Server deletion is awaiting confirmation. Retry Delete from the server.',
    })
    await this.stopForDeletion(id)
    assertCurrent()
    let checking = this.deletionGuards.get(id)
    if (checking === undefined) {
      checking = Promise.resolve()
        .then(() => this.connectionChangeGuard(id, assertCurrent))
        .finally(() => this.deletionGuards.delete(id))
      this.deletionGuards.set(id, checking)
    }
    await this.waitForDeletion(checking, 'safety')
    assertCurrent()
    if (!attempt.result) {
      requesting()
      attempt.result = await client.deleteScope(attempt.key)
      assertCurrent()
      storage.saveLocalStorage(slot, attempt)
    }
    this.publish(id, {
      events: [
        ...(this.activity.value[id]?.events ?? []),
        { at: Date.now(), text: t('streamC.eb5f15550a0803de') },
      ],
    })
    assertCurrent()
    const finishing = Promise.resolve()
      .then(() => this.disconnect(id))
      .finally(() => this.deletionDisconnects.delete(id))
    this.deletionDisconnects.set(id, finishing)
    await this.waitForDeletion(finishing, 'disconnect')
  }
  /**
   * A paused engine still finishes its running pass, so its transfers and commits would race
   * the deletion and could keep it from ever being sent. Stop the connection instead; the saved
   * deletion attempt keeps it from starting again until the deletion settles or it is
   * disconnected. A timeout releases the UI attempt, but retains the actual drain and its
   * ownership barrier. Retry joins that same drain; deletion never races an overdue writer.
   */
  private async stopForDeletion(id: string): Promise<void> {
    let stopping = this.deletionStops.get(id)
    if (stopping === undefined) {
      stopping = Promise.resolve()
        .then(() => this.stopRuntime(id))
        .catch((error: unknown) => {
          this.deletionStops.delete(id)
          console.debug('[Abele Sync] Connection stop before server deletion failed', id, error)
          throw error
        })
      this.deletionStops.set(id, stopping)
    }
    await this.waitForDeletion(stopping, 'stop')
  }
  private async waitForDeletion(
    work: Promise<void>,
    stage: 'stop' | 'safety' | 'disconnect'
  ): Promise<void> {
    let timer: number | undefined
    try {
      await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            console.debug('[Abele Sync] Server deletion is waiting', stage)
            reject(new ServerDeleteWait(stage))
          }, this.runtimeStopLimitMs)
        }),
      ])
    } catch (error) {
      throw Object.assign(
        error instanceof Error ? error : new Error('Local deletion step failed'),
        {
          deletionStage: stage,
        }
      )
    } finally {
      window.clearTimeout(timer)
    }
  }
  async sync(id: string): Promise<void> {
    const record = this.registry.records().find((one) => one.id === id)
    if (record?.state['abele-sync-token-state:scope-deleted']) throw new Error(SCOPE_DELETED)
    if (record?.state['abele-sync-token-state:server-delete'])
      throw new Error('Server deletion is awaiting confirmation')
    if (!record || record.paused) throw new Error('Sync is paused')
    let runtime = this.runtimes.get(id)
    if (!runtime) {
      await this.retryConnection(id, () => {
        if (!this.registry.records().some((one) => one.id === id))
          throw new ConnectStageError('Connection cancelled.')
      })
      runtime = this.runtimes.get(id)
      if (!runtime)
        throw new ConnectStageError('Could not finish starting sync. Try Sync now again.')
    }
    await runtime.sync()
    this.refresh()
  }
  async pause(id: string, paused: boolean): Promise<void> {
    const state = this.registry.records().find((one) => one.id === id)?.state
    if (
      state?.['abele-sync-token-state:scope-deleted'] ||
      state?.['abele-sync-token-state:server-delete']
    )
      throw new Error('This connection is stopped. Disconnect or finish the server deletion.')
    this.registry.setPaused(id, paused)
    this.refresh()
    await this.runtimes.get(id)?.pause(paused)
  }
  async disconnect(id: string): Promise<void> {
    const record = this.registry.records().find((one) => one.id === id)
    if (!record) return
    // Snapshot authority and policy before waiting; successful exchanges persist
    // progress independently of materialization. Credentials must be captured too.
    const identity = (one: TokenConnectionRecord | undefined) =>
      one && {
        id: one.id,
        kind: one.kind,
        address: one.address,
        spaceId: one.spaceId,
        tokenId: one.tokenId,
        scope: one.scope,
        ledgerId: one.ledgerId,
        secretReference: one.secretReference,
        credential: this.secrets.get(one.secretReference),
        pending: one.pending,
        pendingCredential: one.pending && this.secrets.get(one.pending.secretReference),
        paused: one.paused,
        selective: one.selective,
      }
    const before = JSON.stringify(identity(record))
    this.runtimes.get(id)?.assertCurrent?.()
    await this.connectionChangeGuard(id)
    this.runtimes.get(id)?.assertCurrent?.()
    const current = this.registry.records().find((one) => one.id === id)
    if (JSON.stringify(identity(current)) !== before)
      throw new Error('Connection changed while disconnecting')
    this.registry.beginForget(id)
    this.refresh()
    await this.disconnectRuntime(id)
    await this.reviews?.executables.forgetSource(id)
    // Local disconnect is not revocation: other tokens and all local files remain untouched.
    this.registry.finishForgotten(this.secrets, id)
    this.deletionStops.delete(id)
    this.runtimes.delete(id)
    const activity = { ...this.activity.value }
    delete activity[id]
    this.activity.value = activity
    await this.connectionForgotten(id)
    this.available.value = this.runtimes.size > 0
    this.refresh()
    await this.refreshReviews()
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
  /** Background callers acknowledge durable consent without waiting for installation. */
  async approve(
    candidate: ExecutableCandidate,
    options: { background?: boolean } = {}
  ): Promise<void> {
    if (!this.reviews) throw new Error('File exchange is not available in this build')
    const record = this.registry.records().find((one) => one.id === candidate.source.id)
    if (!record || sourceIdentity(reviewSourceOf(record)) !== sourceIdentity(candidate.source))
      throw new Error('This connection is no longer available')
    await this.reviews.executables.recordApproval(candidate.id)
    this.setApprovalStatus(
      candidate.id,
      'Approved — will be installed as soon as the connection is available.'
    )
    const currentState = this.registry.records().find((one) => one.id === record.id)?.state
    if (
      currentState?.['abele-sync-token-state:server-delete'] ||
      currentState?.['abele-sync-token-state:scope-deleted']
    )
      return
    const installation = this.installApproval(candidate)
    if (!this.runtimes.has(candidate.source.id) && !record.paused)
      void this.retryConnection(record.id, () => {
        if (!this.registry.records().some((one) => one.id === record.id))
          throw new Error('Connection cancelled')
      })
        .then(() => {
          void this.installApproval(candidate)
        })
        .catch((error) => {
          this.setApprovalStatus(
            candidate.id,
            'Approved — waiting for the connection. ' + connectionError(error)
          )
        })
    if (installation !== undefined && !options.background) {
      await installation
      await this.refreshReviews()
    }
  }
  private setApprovalStatus(id: string, text: string): void {
    this.approvalStatus.value = { ...this.approvalStatus.value, [id]: text }
  }
  private installApproval(candidate: ExecutableCandidate): Promise<void> | undefined {
    const state = this.registry.records().find((one) => one.id === candidate.source.id)?.state
    if (
      state?.['abele-sync-token-state:server-delete'] ||
      state?.['abele-sync-token-state:scope-deleted']
    )
      return
    const existing = this.installing.get(candidate.id)
    if (existing !== undefined) return existing
    const runtime = this.runtimes.get(candidate.source.id)
    if (!runtime || !this.reviews) return
    const installation = this.reviews.executables.approve([candidate.id], runtime)
    this.installing.set(candidate.id, installation)
    void installation
      .then(() => {
        this.setApprovalStatus(candidate.id, 'Approved and installed.')
        void this.refreshReviews().catch((error) =>
          this.reviewFailure(candidate.source.id, candidate.path, error)
        )
      })
      .catch((error) => {
        this.setApprovalStatus(
          candidate.id,
          'Approved — installation could not finish. ' + connectionError(error)
        )
        this.reviewFailure(candidate.source.id, candidate.path, error)
      })
      .finally(() => {
        this.installing.delete(candidate.id)
      })
    return installation
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
