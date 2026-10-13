import { FileView, Platform, TFile, type WorkspaceLeaf, type Plugin } from 'obsidian'
import { createApp, h, shallowReactive, type App as VueApp } from 'vue'
import { applyWordEdit, type WordEdit } from './edit'
import { readOfficeBytes } from '@/ooxml/vaultAdapter'
import { loadWordBytes, vaultWordResources, writeWordChange } from './vaultAdapter'
import type { WordPackage } from './package'
import { wordPageModel } from './pageAdapter'
import type { WordPageModel, WordSaveState } from './pageModel'
import WordPage from './WordPage.vue'
import WordControls from './WordControls.vue'
import './word.css'

export const DOCX_VIEW_TYPE = 'abele-word'
export class DocxView extends FileView {
  document: WordPackage | null = null
  paragraph = 1
  private token = 0
  private editing = false
  private saving = false
  private externalChange = false
  private vue: VueApp | null = null
  private controls: VueApp | null = null
  private pending: Promise<void> = Promise.resolve()
  private abort = new AbortController()
  private state = shallowReactive<{ model: WordPageModel; save: WordSaveState }>({
    model: { blocks: [], styles: [] },
    save: { state: 'idle' },
  })
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || file.path !== this.file?.path || this.saving) return
        if (this.editing) this.externalChange = true
        else void this.onLoadFile(file)
      })
    )
  }
  getViewType() {
    return DOCX_VIEW_TYPE
  }
  getDisplayText() {
    return this.file?.name ?? 'Word document'
  }
  getIcon() {
    return 'file-text'
  }
  private unmountPage(): void {
    this.vue?.unmount()
    this.vue = null
  }
  async onLoadFile(file: TFile): Promise<void> {
    const token = ++this.token
    this.abort?.abort()
    this.abort = new AbortController()
    this.saving = false
    this.controls?.unmount()
    this.controls = null
    this.unmountPage()
    this.document = null
    this.editing = false
    this.externalChange = false
    this.pending = Promise.resolve()
    this.contentEl.empty()
    this.contentEl.addClass('abele-word')
    const status = this.contentEl.createDiv({
      text: 'Opening Word document…',
      cls: 'abele-word-status',
      attr: { role: 'status' },
    })
    try {
      const doc = await loadWordBytes(await readOfficeBytes(this.app, file))
      if (token !== this.token) return
      this.document = doc
      await this.showDocument(doc, token)
      if (token === this.token) status.remove()
    } catch (error) {
      if (token !== this.token) return
      this.unmountPage()
      this.contentEl.empty()
      status.setText(
        `${this.document ? 'Page unavailable; showing text' : 'Could not open document'}: ${(error as Error).message}`
      )
      this.contentEl.appendChild(status)
      if (this.document) {
        const text = this.contentEl.createDiv({ cls: 'abele-word-text' })
        for (const p of this.document.paragraphs)
          text.createDiv({ text: p.text, cls: 'abele-word-paragraph' })
      }
    }
  }
  async onUnloadFile(): Promise<void> {
    ++this.token
    this.abort.abort()
    this.controls?.unmount()
    this.controls = null
    this.unmountPage()
    this.document = null
    this.contentEl.empty()
  }
  /** Serialize emitted operations: a flush followed by formatting uses the saved package. */
  private enqueue(edit: WordEdit): Promise<void> {
    if (this.state.save.state === 'failed') this.state.save = { state: 'idle' }
    const token = this.token
    const signal = this.abort.signal
    const file = this.file
    const run = this.pending.then(async () => {
      if (token !== this.token || !file || this.file !== file || !this.document)
        throw new Error('Document is no longer open')
      if (Platform.isMobile) throw new Error('Hand editing is desktop-only for Word documents')
      if (this.state.save.state === 'failed') throw new Error(this.state.save.reason)
      const doc = this.document
      this.state.save = { state: 'saving' }
      this.saving = true
      try {
        const updated = await applyWordEdit(doc, edit, vaultWordResources(this.app))
        const next = await loadWordBytes(updated)
        const model = await wordPageModel(next)
        if (token !== this.token || this.file !== file)
          throw new Error('Document is no longer open')
        await writeWordChange(this.app, file, doc.original, updated, signal)
        if (token !== this.token) return
        this.document = next
        this.state.model = Platform.isMobile
          ? { ...model, readOnly: 'Use the agent to edit this document on mobile' }
          : model
        this.state.save = { state: 'saved' }
      } finally {
        if (token === this.token) this.saving = false
      }
    })
    this.pending = run.catch((error) => {
      if (token === this.token)
        this.state.save = { state: 'failed', reason: (error as Error).message }
    })
    return run
  }
  private async advanced(paragraph: number, range?: { from: number; to: number }): Promise<void> {
    const token = this.token
    await this.pending
    if (token !== this.token) return
    const doc = this.document
    const p = doc?.paragraphs.find((p) => p.number === paragraph)
    if (!doc || !p) return
    this.controls?.unmount()
    const close = () => {
      this.controls?.unmount()
      host.remove()
      this.editing = false
      this.controls = null
      if (this.externalChange && this.file) void this.onLoadFile(this.file)
    }
    this.editing = true
    const host = this.contentEl.createDiv()
    this.controls = createApp(WordControls, {
      doc,
      paragraph: p,
      editor: {
        app: this.app,
        readOnly: Platform.isMobile,
        range,
        cancel: close,
        apply: async (edit: WordEdit) => {
          await this.enqueue(edit)
          close()
        },
      },
      onClose: close,
    })
    this.controls.mount(host)
  }
  protected async showDocument(doc: WordPackage, token = this.token): Promise<void> {
    const model = await wordPageModel(doc)
    if (token !== this.token) return
    this.state.model = Platform.isMobile
      ? { ...model, readOnly: 'Use the agent to edit this document on mobile' }
      : model
    this.state.save = { state: 'idle' }
    const host = this.contentEl.createDiv({ cls: 'abele-word-page-host' })
    this.vue = createApp({
      render: () =>
        h(WordPage, {
          model: this.state.model,
          save: this.state.save,
          onEdit: (edit: WordEdit) => {
            void this.enqueue(edit).catch(() => {})
          },
          onAdvanced: (paragraph: number) => {
            void this.advanced(paragraph)
          },
          onPickImage: (paragraph: number) => {
            void this.advanced(paragraph)
          },
          onPickLink: (edit: WordEdit) => {
            void this.advanced(edit.paragraph, { from: edit.from ?? 0, to: edit.to ?? 0 })
          },
          onContext: (paragraph: number) => {
            this.paragraph = paragraph
          },
          onEditorState: (open: boolean) => {
            this.editing = open
            if (!open && this.externalChange && this.file && !this.saving)
              void this.onLoadFile(this.file)
          },
        }),
    })
    this.vue.mount(host)
  }
}
export function registerWord(plugin: Plugin): void {
  plugin.registerView(DOCX_VIEW_TYPE, (leaf) => new DocxView(leaf))
  try {
    plugin.registerExtensions(['docx'], DOCX_VIEW_TYPE)
  } catch {
    console.warn('[Abele] .docx is already handled; use Open in Abele document viewer')
  }
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'docx') return
      menu.addItem((item) =>
        item
          .setTitle('Open in Abele document viewer')
          .setIcon('file-text')
          .onClick(() => {
            void plugin.app.workspace
              .getLeaf('tab')
              .setViewState({ type: DOCX_VIEW_TYPE, state: { file: file.path }, active: true })
          })
      )
    })
  )
}
