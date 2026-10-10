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
  const code = (error as { code?: string } | null)?.code
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
  pending?: number
  lastSync?: number
  completed?: number
  total?: number
  refused?: { path: string; reason: string }[]
  conflicts?: string[]
  error?: string
}
export interface TokenUiRuntime extends ExecutableApplyPort, ConsentResolvePort {
  sync(): Promise<void>
  pause(paused: boolean): Promise<void>
  disconnect(): Promise<void>
  /** Stable local identities already recorded by the engine, never derived from a path. */
  opened(path: string): Promise<{ source: ReviewSource; noteId: string }[]>
}
export type DeviceReviews = Awaited<ReturnType<typeof openDeviceReviews>>
export class TokenUi {
  connectionsChanged: () => Promise<void> = async () => {}
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
  async connect(text: string): Promise<void> {
    // Validate with the server before adding a row. Failed paste leaves all existing rows intact.
    const token = decodeAccessToken(text),
      client = new V2Client(token, this.transport)
    if (typeof token.address !== 'string') throw new V2ClientError('bad-token')
    const authority = await client.connection()
    if (token.scope.kind !== authority.scope.kind || token.scope.id !== authority.scope.id)
      throw new V2ClientError('bad-token')
    const pending = this.registry
      .records()
      .find(
        (one) =>
          one.pending?.address === token.address &&
          one.pending.spaceId === authority.space_id &&
          one.pending.tokenId === authority.token_id &&
          one.pending.scope.kind === authority.scope.kind &&
          one.pending.scope.id === authority.scope.id
      )
    const id = pending?.id ?? this.registry.add()
    try {
      this.registry.attach(id, { ...token, address: token.address }, authority, this.secrets)
    } finally {
      this.refresh()
    }
    await this.connectionsChanged()
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
    if (!runtime) throw new Error('File exchange is not available in this build')
    await runtime.sync()
    this.refresh()
  }
  async pause(id: string, paused: boolean): Promise<void> {
    await this.runtimes.get(id)?.pause(paused)
    this.registry.setPaused(id, paused)
    this.refresh()
  }
  async disconnect(id: string): Promise<void> {
    const record = this.registry.records().find((one) => one.id === id)
    if (!record) return
    await this.runtimes.get(id)?.disconnect()
    // Local disconnect is not revocation: other tokens and all local files remain untouched.
    for (const reference of [record.secretReference, record.pending?.secretReference]) {
      if (reference) {
        this.secrets.remove(reference)
        if (this.secrets.get(reference)) throw new Error('Credential cleanup failed')
      }
    }
    this.registry.forget(id)
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
