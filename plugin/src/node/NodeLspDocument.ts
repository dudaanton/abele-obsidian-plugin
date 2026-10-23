import type { NodeClient } from '@abele/node-client'
import { LspDiagnosticsSchema, type LspDiagnostic } from '@abele/node-protocol'
import { z } from 'zod'
import { lspLanguage } from './lspLanguage'

export type LspRoot =
  | { workspace_id: string; worktree_id?: never }
  | { worktree_id: string; workspace_id?: never }
export type LspPosition = { line: number; character: number }
export type LspLocation = { path: string; range: { start: LspPosition; end: LspPosition } }
type Client = Pick<NodeClient, 'lsp' | 'describe' | 'onEvent' | 'subscribe'>

/** One shared document buffer. Transport-independent; no automatic installs. */
export class NodeLspDocument {
  diagnostics: LspDiagnostic[] = []
  status: Awaited<ReturnType<Client['lsp']['status']>> = []
  supported = false
  loading = false
  error = ''
  private opens = 0
  private text = ''
  private openedText?: string
  private stopped = false
  private unsubscribe?: () => unknown
  private pushes = 0
  private abort = new AbortController()
  private admission?: Promise<void>
  private admitted = false
  private pending: Promise<void> = Promise.resolve()
  private opening: Promise<unknown> = Promise.resolve()
  private hoverRequests = new Map<string, Promise<string>>()
  readonly listeners = new Set<() => void>()
  constructor(
    readonly client: Client,
    readonly root: LspRoot,
    readonly path: string,
    private readonly ready: Promise<void> = Promise.resolve()
  ) {
    this.pending = ready
  }
  private changed() {
    for (const listener of this.listeners) listener()
  }
  private get unavailable(): boolean {
    const language = lspLanguage(this.path)
    const relevant = this.status.filter(
      (server) =>
        server.language === language || (language === 'typescript' && server.language === 'eslint')
    )
    return (
      relevant.some((server) => server.reason === 'untrusted_folder') ||
      (relevant.length > 0 && relevant.every((server) => !server.found))
    )
  }
  private async admit() {
    const description = await this.client.describe()
    const parsed = z
      .object({
        capabilities: z.object({
          capabilities: z.object({ lsp_v1: z.object({ status: z.literal('supported') }) }),
        }),
      })
      .safeParse(description)
    if (this.stopped || !parsed.success) return
    this.supported = true
    // Availability notices affect the code's position. Publish them before cached
    // diagnostics can make the editor interactive at a soon-to-change location.
    this.status = await this.client.lsp.status(this.root)
    if (this.stopped) return
    this.changed()
    this.unsubscribe = this.client.onEvent((event) => {
      if (this.stopped) return
      if (event.type === 'lsp.status') {
        const parsed = z
          .object({
            workspace_id: z.string().optional(),
            worktree_id: z.string().optional(),
            message: z.string().max(4096),
          })
          .safeParse(event.data)
        if (
          parsed.success &&
          (parsed.data.worktree_id ?? parsed.data.workspace_id) ===
            (this.root.worktree_id ?? this.root.workspace_id)
        ) {
          this.error = parsed.data.message
          this.changed()
        }
        return
      }
      if (event.type !== 'lsp.diagnostics') return
      const parsed = LspDiagnosticsSchema.safeParse(event.data)
      if (!parsed.success) return
      const data = parsed.data
      if (
        data.path !== this.path ||
        data.workspace_id !== this.root.workspace_id ||
        data.worktree_id !== this.root.worktree_id
      )
        return
      ++this.pushes
      this.diagnostics = data.diagnostics
      this.loading = false
      this.changed()
    })
    await this.client.subscribe('catalog')
    if (!this.stopped) this.admitted = true
  }
  private ensureAdmission(): Promise<void> {
    return (this.admission ??= this.admit().catch((error) => {
      // A failed admission must be retryable regardless of any prior buffer opens.
      this.admission = undefined
      this.admitted = false
      this.unsubscribe?.()
      this.unsubscribe = undefined
      throw error
    }))
  }
  open(text: string): Promise<void> {
    this.text = text
    // Serialize updates so a slow open can never replace a newer version of the draft.
    this.pending = this.pending.then(async () => {
      if (this.stopped) return
      if (this.openedText === text && !this.error && !this.unavailable) return
      const analysisPushes = this.pushes
      const loadingTimer = window.setTimeout(() => {
        if (!this.stopped && this.pushes === analysisPushes) {
          this.loading = true
          this.changed()
        }
      }, 300)
      this.error = ''
      this.changed()
      try {
        if (this.admitted && !this.opens) this.status = await this.client.lsp.status(this.root)
        await this.ensureAdmission()
        if (!this.admitted || this.stopped) return
        if (this.unavailable) {
          this.diagnostics = []
          console.debug('[node] Language analysis waiting for available trusted servers', this.path)
          return
        }
        const pushes = this.pushes
        ++this.opens
        // Versions belong to the shared node buffer, including refreshes from other clients.
        await (this.opening = this.client.lsp.open(
          this.root,
          this.path,
          text,
          undefined,
          this.abort.signal
        ))
        this.openedText = text
        const diagnostics = await this.client.lsp.diagnostics(
          this.root,
          this.path,
          this.abort.signal
        )
        if (!this.stopped && pushes === this.pushes) this.diagnostics = diagnostics
      } catch (error) {
        if (!this.stopped) {
          console.debug('[node] Language analysis unavailable', error)
          this.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        window.clearTimeout(loadingTimer)
        this.loading = false
        if (!this.stopped) this.changed()
      }
    })
    return this.pending
  }
  async refreshStatus(): Promise<void> {
    if (!this.supported || this.stopped) return
    this.status = await this.client.lsp.status(this.root)
    this.changed()
  }
  private withBuffer<T>(
    text: string,
    fallback: T,
    kind: 'navigation' | 'hover',
    run: () => Promise<T>
  ): Promise<T> {
    const work = this.pending.then(async () => {
      if (!this.admitted || this.stopped || this.unavailable) return fallback
      try {
        ++this.opens
        await (this.opening = this.client.lsp.open(
          this.root,
          this.path,
          text,
          undefined,
          this.abort.signal
        ))
        this.openedText = text
        if (this.stopped) return fallback
        const result = await run()
        return this.stopped ? fallback : result
      } catch (error) {
        if (kind === 'hover') console.debug('[node] Language hover unavailable', error)
        else console.debug('[node] Language navigation unavailable', error)
        return fallback
      }
    })
    // Buffer selection and the query are one operation: another view cannot replace
    // the node's text between them. Query failures must not poison later edits.
    this.pending = work.then(
      () => {},
      () => {}
    )
    return work
  }
  query(
    kind: 'definition' | 'references',
    position: LspPosition,
    text = this.text
  ): Promise<LspLocation[]> {
    return this.withBuffer(text, [], 'navigation', () =>
      this.client.lsp[kind](this.root, this.path, position, this.abort.signal)
    )
  }
  hover(position: LspPosition, text = this.text): Promise<string> {
    // CodeMirror restarts asynchronous hover sources on every view update, including
    // diagnostic pushes caused by synchronizing this very query. Keep those restarts
    // on the same request instead of repeatedly reopening the language-server buffer.
    const key = JSON.stringify([text, position.line, position.character])
    const existing = this.hoverRequests.get(key)
    if (existing !== undefined) return existing
    const request = this.withBuffer(
      text,
      '',
      'hover',
      async () =>
        (await this.client.lsp.hover(this.root, this.path, position, this.abort.signal)).text
    ).finally(() => this.hoverRequests.delete(key))
    this.hoverRequests.set(key, request)
    return request
  }
  async close(): Promise<void> {
    this.stopped = true
    this.abort.abort()
    this.unsubscribe?.()
    this.listeners.clear()
    // Await outstanding opens before closing: a late open must not leave a document behind.
    await this.ready
    await this.opening.catch(() => {})
    if (this.supported && this.opens)
      await this.client.lsp
        .close(this.root, this.path)
        .catch((error) => console.debug('[node] Language document close unavailable', error))
  }
}

type SharedDocument = {
  document: NodeLspDocument
  views: Set<() => string | undefined>
  closing?: Promise<void>
}
const documents = new WeakMap<Client, Map<string, SharedDocument>>()

/** Each view owns a lease; only the final release closes the node's connection-owned buffer. */
export function acquireLspDocument(
  client: Client,
  root: LspRoot,
  path: string,
  text: () => string | undefined = () => undefined
) {
  let pool = documents.get(client)
  if (!pool) documents.set(client, (pool = new Map()))
  const key = JSON.stringify([root.workspace_id, root.worktree_id, path])
  let entry = pool.get(key)
  if (!entry || entry.views.size === 0) {
    entry = { document: new NodeLspDocument(client, root, path, entry?.closing), views: new Set() }
    pool.set(key, entry)
  }
  const shared = entry
  const viewText = () => text()
  shared.views.add(viewText)
  let released = false
  return {
    document: shared.document,
    release(this: void): Promise<void> {
      if (released) return shared.closing ?? Promise.resolve()
      released = true
      shared.views.delete(viewText)
      if (shared.views.size) {
        const remaining = [...shared.views].at(-1)?.()
        return remaining === undefined ? Promise.resolve() : shared.document.open(remaining)
      }
      shared.closing = shared.document.close().finally(() => {
        if (pool.get(key) === shared) pool.delete(key)
      })
      return shared.closing
    },
  }
}
