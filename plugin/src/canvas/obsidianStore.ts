/** Thin vault/Canvas adapter. Pure transforms run at the final atomic storage boundary. */
import { TFile, type App, type TextFileView } from 'obsidian'
import {
  canvasFingerprint,
  cloneCanvas,
  parseCanvas,
  serializeCanvas,
  type CanvasGraph,
} from './core/model'
import type { GraphStore } from './core/service'

interface NativeCanvasView extends TextFileView {
  save(): Promise<void>
  setViewData(data: string, clear: boolean): void
  canvas: {
    getData(): unknown
    setData(data: unknown): void
    requestSave(history?: boolean): void
    requestPushHistory: { cancel?(): void }
    pushHistory(data: unknown): void
    history: { data: unknown[]; current: number }
  }
}
const queues = new WeakMap<App, Map<string, Promise<unknown>>>()
export function canvasPath(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !input.endsWith('.canvas') ||
    input.startsWith('/') ||
    input.includes('\\') ||
    input.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) ||
    Array.from(input).some(
      (c) =>
        c.charCodeAt(0) < 32 || ['#', '|', '[', ']', '^', '*', '"', '<', '>', '?', ':'].includes(c)
    )
  )
    throw new Error('Use an exact safe vault-relative .canvas path')
  return input
}
export class ObsidianCanvasStore implements GraphStore {
  constructor(private readonly app: App) {}
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(canvasPath(path))
    if (!(file instanceof TFile)) throw new Error(`Canvas file not found: ${path}`)
    return file
  }
  private views(path: string): NativeCanvasView[] {
    return (this.app.workspace?.getLeavesOfType('canvas') ?? [])
      .map((l) => l.view as NativeCanvasView)
      .filter((v) => v.file?.path === path)
  }
  private async serial<T>(path: string, action: () => Promise<T>): Promise<T> {
    let queue = queues.get(this.app)
    if (!queue) {
      queue = new Map()
      queues.set(this.app, queue)
    }
    const previous = queue.get(path) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    queue.set(path, current)
    try {
      return await current
    } finally {
      if (queue.get(path) === current) queue.delete(path)
    }
  }
  async read(key: string): Promise<CanvasGraph> {
    const file = this.file(key),
      views = this.views(key)
    // Reading an open diagram includes the native editor's not-yet-autosaved geometry/text.
    return views[0]
      ? parseCanvas(views[0].canvas.getData())
      : parseCanvas(await this.app.vault.read(file))
  }
  async create(key: string, graph: CanvasGraph, signal?: AbortSignal): Promise<void> {
    const path = canvasPath(key),
      text = serializeCanvas(graph)
    await this.serial(path, async () => {
      signal?.throwIfAborted()
      if (this.app.vault.getAbstractFileByPath(path))
        throw new Error(`Canvas file already exists: ${path}`)
      const parts = path.split('/')
      parts.pop()
      let folder = ''
      for (const part of parts) {
        folder = folder ? `${folder}/${part}` : part
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder)
      }
      signal?.throwIfAborted()
      await this.app.vault.create(path, text)
    })
  }
  async change(
    key: string,
    transform: (graph: CanvasGraph) => CanvasGraph,
    signal?: AbortSignal
  ): Promise<{ before: CanvasGraph; after: CanvasGraph }> {
    return this.serial(canvasPath(key), async () => {
      signal?.throwIfAborted()
      const file = this.file(key),
        views = this.views(key)
      if (views.length > 1)
        throw new Error(
          'This diagram is open in multiple native editors; close duplicate tabs before changing it'
        )
      const view = views[0]
      if (view) {
        // Flush the person's pending edit into its own undo item before the agent's batch.
        const data = view.canvas.getData()
        // Reject an invalid batch before flushing/reordering even unchanged native file bytes.
        // Transforms are pure; the final callback still recomputes against current storage data.
        parseCanvas(transform(cloneCanvas(parseCanvas(data))))
        view.canvas.requestPushHistory.cancel?.()
        const previous = view.canvas.history.data[view.canvas.history.current]
        if (
          !previous ||
          canvasFingerprint(parseCanvas(previous)) !== canvasFingerprint(parseCanvas(data))
        )
          view.canvas.pushHistory(data)
        view.canvas.requestSave(false)
        await view.save()
      }
      let before: CanvasGraph | undefined, after: CanvasGraph | undefined
      await this.app.vault.process(file, (current) => {
        signal?.throwIfAborted()
        before = parseCanvas(current)
        after = parseCanvas(transform(cloneCanvas(before)))
        // The host's modify listener calls setData and pushes one native undo item.
        // Calling setViewData ourselves would push a second identical item.
        return serializeCanvas(after)
      })
      if (!before || !after) throw new Error('Canvas storage did not run the transaction')
      if (view) {
        const expected = canvasFingerprint(after)
        const deadline = Date.now() + 3000
        while (canvasFingerprint(parseCanvas(view.canvas.getData())) !== expected) {
          if (Date.now() > deadline)
            throw new Error(
              'Native Canvas changed while applying the batch; reread before editing again'
            )
          await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
        }
      }
      return { before, after }
    })
  }
}
