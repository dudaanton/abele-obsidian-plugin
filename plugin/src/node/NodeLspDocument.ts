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

/** One visible document. Transport-independent; no persistent settings or automatic installs. */
export class NodeLspDocument {
  diagnostics: LspDiagnostic[] = []
  status: Awaited<ReturnType<Client['lsp']['status']>> = []
  supported = false
  loading = false
  error = ''
  private opens = 0
  private text = ''
  private stopped = false
  private unsubscribe?: () => unknown
  private pushes = 0
  private abort = new AbortController()
  private admission?: Promise<void>
  private pending: Promise<void> = Promise.resolve()
  private hoverRequests = new Map<string, Promise<string>>()
  readonly listeners = new Set<() => void>()
  constructor(
    readonly client: Client,
    readonly root: LspRoot,
    readonly path: string
  ) {}
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
      this.changed()
    })
    await this.client.subscribe('catalog')
  }
  open(text: string): Promise<void> {
    this.text = text
    // Serialize updates so a slow open can never replace a newer version of the draft.
    this.pending = this.pending.then(async () => {
      if (this.stopped) return
      this.loading = true
      this.error = ''
      this.changed()
      try {
        await (this.admission ??= this.admit())
        if (!this.supported || this.stopped) return
        if (!this.opens) this.status = await this.client.lsp.status(this.root)
        if (this.stopped) return
        if (this.unavailable) {
          this.diagnostics = []
          console.debug('[node] Language analysis waiting for available trusted servers', this.path)
          return
        }
        const pushes = this.pushes
        this.diagnostics = []
        this.changed()
        ++this.opens
        // Versions belong to the shared node buffer, including refreshes from other clients.
        await this.client.lsp.open(this.root, this.path, text, undefined, this.abort.signal)
        const diagnostics = await this.client.lsp.diagnostics(
          this.root,
          this.path,
          this.abort.signal
        )
        if (!this.stopped && pushes === this.pushes) this.diagnostics = diagnostics
      } catch (error) {
        if (!this.stopped) {
          if (!this.opens) {
            this.admission = undefined
            this.unsubscribe?.()
            this.unsubscribe = undefined
          }
          console.debug('[node] Language analysis unavailable', error)
          this.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
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
  private synchronize(): Promise<void> {
    const work = this.pending.then(async () => {
      if (this.stopped) return
      ++this.opens
      await this.client.lsp.open(this.root, this.path, this.text, undefined, this.abort.signal)
    })
    // Query failure must not poison the queue used by subsequent edits or close.
    this.pending = work.catch(() => {})
    return work
  }
  async query(kind: 'definition' | 'references', position: LspPosition): Promise<LspLocation[]> {
    await this.pending
    if (!this.supported || this.stopped || this.unavailable) return []
    try {
      await this.synchronize()
      if (this.stopped) return []
      const result = await this.client.lsp[kind](this.root, this.path, position, this.abort.signal)
      return this.stopped ? [] : result
    } catch (error) {
      console.debug('[node] Language navigation unavailable', error)
      return []
    }
  }
  hover(position: LspPosition): Promise<string> {
    // CodeMirror restarts asynchronous hover sources on every view update, including
    // diagnostic pushes caused by synchronizing this very query. Keep those restarts
    // on the same request instead of repeatedly reopening the language-server buffer.
    const key = JSON.stringify([this.text, position.line, position.character])
    const existing = this.hoverRequests.get(key)
    if (existing) return existing
    const request = this.requestHover(position).finally(() => this.hoverRequests.delete(key))
    this.hoverRequests.set(key, request)
    return request
  }
  private async requestHover(position: LspPosition): Promise<string> {
    await this.pending
    if (!this.supported || this.stopped || this.unavailable) return ''
    try {
      await this.synchronize()
      if (this.stopped) return ''
      const result = await this.client.lsp.hover(this.root, this.path, position, this.abort.signal)
      return this.stopped ? '' : result.text
    } catch (error) {
      console.debug('[node] Language hover unavailable', error)
      return ''
    }
  }
  async close(): Promise<void> {
    this.stopped = true
    this.abort.abort()
    this.unsubscribe?.()
    this.listeners.clear()
    // Await outstanding opens before closing: a late open must not leave a document behind.
    await this.pending
    if (this.supported && this.opens)
      await this.client.lsp
        .close(this.root, this.path)
        .catch((error) => console.debug('[node] Language document close unavailable', error))
  }
}
