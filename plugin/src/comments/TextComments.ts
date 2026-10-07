import { createApp } from 'vue'
import { MarkdownView, Notice, SuggestModal, TFile, type App } from 'obsidian'
import { ChatStorage } from '@/ai/ChatStorage'
import { newCommentId, parseMarkers, resolveQuote } from '@/editor/commentMarkers'
import {
  dispatchCommentsChanged,
  type CommentInfo,
  type CommentInfoSource,
} from '@/editor/CommentPlugin'
import TextCommentDialog from '@/components/TextCommentDialog.vue'
import type { CommentSelection } from './service'
import { TextCommentService, type ThreadSnapshot } from './service'
import { VaultCommentRepository, vaultCommentDocuments } from './vaultRepository'

/** Vault/reactivity adapter; the core service remains usable without Obsidian or AI. */
export class TextComments implements CommentInfoSource {
  readonly repository: VaultCommentRepository
  readonly service: TextCommentService
  private readonly cache = new Map<string, ThreadSnapshot | null>()
  private readonly human = new Set<string>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly notes = new Set<string>()
  private readonly generations = new Map<string, number>()
  private readonly errors = new Set<string>()
  private readonly dialogs = new Set<() => void>()
  private dead = false

  constructor(readonly app: App) {
    this.repository = new VaultCommentRepository(app, () => ChatStorage.commentsFolder())
    this.service = new TextCommentService(
      this.repository,
      vaultCommentDocuments(app),
      () => new Date().toISOString(),
      newCommentId
    )
  }
  get(id: string): CommentInfo | undefined {
    if (!this.human.has(id)) return undefined
    const saved = this.cache.get(id)
    return {
      kind: 'human',
      quote: saved?.thread.anchor.quote,
      appearance: saved?.thread.appearance,
      state: this.errors.has(id) ? 'error' : 'idle',
      open: false,
      messages: saved?.thread.entries.length ?? 0,
    }
  }
  touch(note: string, ids: string[]): void {
    this.notes.add(note)
    for (const id of ids) {
      if (this.cache.has(id) || this.loading.has(id)) continue
      const generation = this.generations.get(id) ?? 0
      if (this.app.vault.getAbstractFileByPath(this.repository.path(id)) instanceof TFile)
        this.human.add(id)
      const task = this.repository
        .read(id)
        .then((saved) => {
          if (this.dead || generation !== (this.generations.get(id) ?? 0)) return
          this.cache.set(id, saved)
          if (saved) this.human.add(id)
          if (this.human.has(id)) dispatchCommentsChanged(note)
        })
        .catch((error) => {
          if (this.dead || generation !== (this.generations.get(id) ?? 0)) return
          this.cache.set(id, null)
          this.errors.add(id)
          console.error('[Abele] Could not read text comment', error)
          dispatchCommentsChanged(note)
        })
        .finally(() => {
          if (this.loading.get(id) === task) this.loading.delete(id)
        })
      this.loading.set(id, task)
    }
  }
  invalidate(id?: string): void {
    if (id) {
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
      this.cache.delete(id)
      this.loading.delete(id)
      this.errors.delete(id)
    } else {
      for (const key of new Set([...this.cache.keys(), ...this.loading.keys()]))
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
      this.cache.clear()
      this.loading.clear()
      this.errors.clear()
    }
    for (const note of this.notes) dispatchCommentsChanged(note)
  }
  followRename(oldPath: string, newPath: string): void {
    for (const note of [...this.notes]) {
      if (note !== oldPath && !note.startsWith(oldPath + '/')) continue
      this.notes.delete(note)
      this.notes.add(newPath + note.slice(oldPath.length))
    }
    this.invalidate()
  }
  async flushNote(note: string): Promise<void> {
    const saves: Promise<void>[] = []
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note)
        saves.push(leaf.view.save())
    })
    await Promise.all(saves)
  }
  async open(ids: string[]): Promise<void> {
    try {
      const threads = (await Promise.all(ids.map((id) => this.repository.read(id)))).filter(
        (saved): saved is ThreadSnapshot => !!saved
      )
      if (!threads.length) {
        new Notice('The text comment file is missing or unavailable')
        return
      }
      if (threads.length > 1) {
        const show = (saved: ThreadSnapshot) => this.show({ initial: saved })
        new (class extends SuggestModal<ThreadSnapshot> {
          getSuggestions() {
            return threads
          }
          renderSuggestion(saved: ThreadSnapshot, el: HTMLElement) {
            el.textContent = saved.thread.anchor.quote
          }
          onChooseSuggestion(saved: ThreadSnapshot) {
            void show(saved)
          }
        })(this.app).open()
        return
      }
      await this.show({ initial: threads[0] })
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }
  async add(selection: CommentSelection, beforeWrite: () => Promise<void>): Promise<void> {
    // Another entry on the same passage belongs to its existing thread, not another token.
    for (const marker of parseMarkers(selection.source)) {
      if (marker.from < selection.from || marker.from > selection.to) continue
      for (const id of marker.ids) {
        const saved = await this.repository.read(id)
        if (
          saved &&
          saved.thread.anchor.note === selection.note &&
          resolveQuote(selection.source, marker, saved.thread.anchor.quote)?.from === selection.from
        ) {
          await this.show({ initial: saved, beforeWrite })
          return
        }
      }
    }
    await this.show({ selection, beforeWrite })
  }
  async show(options: {
    initial?: ThreadSnapshot
    selection?: CommentSelection
    beforeWrite?: () => Promise<void>
  }): Promise<void> {
    if (this.dead) return
    const initial = options.initial
    let unresolved = false
    if (initial) {
      const file = this.app.vault.getAbstractFileByPath(initial.thread.anchor.note)
      const text = file instanceof TFile ? await this.app.vault.read(file) : ''
      const marker = parseMarkers(text).find((marker) => marker.ids.includes(initial.thread.id))
      unresolved = !marker || !resolveQuote(text, marker, initial.thread.anchor.quote)
    }
    const host = document.body.createDiv()
    const close = () => {
      if (!this.dialogs.delete(close)) return
      vue.unmount()
      host.remove()
    }
    const note = initial?.thread.anchor.note ?? options.selection?.note ?? ''
    const vue = createApp(TextCommentDialog, {
      service: this.service,
      ...options,
      unresolved,
      beforeWrite: options.beforeWrite ?? (() => this.flushNote(note)),
      changed: (saved: ThreadSnapshot | null) => {
        const id = saved?.thread.id ?? initial?.thread.id
        if (id) this.invalidate(id)
        dispatchCommentsChanged(note)
      },
      onClose: close,
    })
    this.dialogs.add(close)
    vue.mount(host)
  }
  destroy(): void {
    this.dead = true
    for (const close of [...this.dialogs]) close()
    this.cache.clear()
    this.notes.clear()
    this.loading.clear()
  }
}
