import { FileView, Platform, TFile, type WorkspaceLeaf, type Plugin } from 'obsidian'
import { applyWordEdit } from './edit'
import { mountWordEditor } from './desktopEditor'
import { loadWordBytes, vaultWordResources, writeWordChange } from './vaultAdapter'
import type { WordParagraph } from './package'
import { renderAsync } from 'docx-preview'
import './word.css'
import type { WordPackage } from './package'
import { cleanRendered, safeRenderBytes, WORD_CSP } from './renderSafety'

export const DOCX_VIEW_TYPE = 'abele-word'
export class DocxView extends FileView {
  document: WordPackage | null = null
  paragraph = 1
  private token = 0
  private editing = false
  private textMode = false
  private frame: HTMLIFrameElement | null = null
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === this.file?.path && !this.editing)
          void this.onLoadFile(file)
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
  async onLoadFile(file: TFile): Promise<void> {
    const token = ++this.token
    this.document = null
    this.editing = false
    this.contentEl.empty()
    this.contentEl.addClass('abele-word')
    const status = this.contentEl.createDiv({
      text: 'Opening Word document…',
      cls: 'abele-word-status',
    })
    try {
      const doc = await loadWordBytes(new Uint8Array(await this.app.vault.readBinary(file)))
      if (token !== this.token) return
      this.document = doc
      status.remove()
      await this.showDocument(doc, token)
    } catch (error) {
      if (token !== this.token) return
      status.setText(
        `${this.document ? 'Preview unavailable; showing text' : 'Could not open document'}: ${(error as Error).message}`
      )
      this.contentEl.appendChild(status)
      if (this.document) {
        this.frame?.remove()
        this.frame = null
        const text =
          this.contentEl.querySelector<HTMLElement>('.abele-word-text') ??
          this.contentEl.createDiv({
            cls: 'abele-word-text',
            text: this.document.read(this.paragraph, 50, 25_000),
          })
        text.hidden = false
        this.textMode = true
      }
    }
  }
  async onUnloadFile(): Promise<void> {
    ++this.token
    this.document = null
    this.frame?.remove()
    this.frame = null
    this.contentEl.empty()
  }
  private editParagraph(row: HTMLElement, doc: WordPackage, p: WordParagraph): void {
    if (this.editing || Platform.isMobile) return
    this.editing = true
    mountWordEditor(row, doc, p, {
      app: this.app,
      cancel: () => {
        this.editing = false
        if (this.file) void this.onLoadFile(this.file)
      },
      apply: async (edit) => {
        const file = this.file
        if (!file || this.document !== doc) throw new Error('Document is no longer open')
        const updated = await applyWordEdit(doc, edit, vaultWordResources(this.app))
        if (this.file !== file || this.document !== doc)
          throw new Error('Document is no longer open')
        await writeWordChange(this.app, file, doc.original, updated)
        this.editing = false
        await this.onLoadFile(file)
      },
    })
  }
  protected async showDocument(doc: WordPackage, token = this.token): Promise<void> {
    const bar = this.contentEl.createDiv({ cls: 'abele-word-toolbar' })
    bar.createSpan({ text: `${doc.paragraphs.length} paragraphs` })
    const input = bar.createEl('input', {
      type: 'number',
      attr: {
        'aria-label': 'Paragraph',
        min: '1',
        max: String(doc.paragraphs.length),
        value: String(this.paragraph),
      },
    })
    const go = bar.createEl('button', { text: 'Go to paragraph' })
    const textPage = this.contentEl.createDiv({ cls: 'abele-word-text' })
    const page = () => {
      this.paragraph = Math.min(doc.paragraphs.length, Math.max(1, Number(input.value) || 1))
      textPage.empty()
      for (const p of doc.paragraphs.slice(this.paragraph - 1, this.paragraph + 49)) {
        const row = textPage.createDiv({
          cls: 'abele-word-paragraph',
          attr: { 'data-paragraph': String(p.number) },
        })
        row.createSpan({ text: `${p.number}. `, cls: 'abele-word-paragraph-number' })
        row.createSpan({ text: p.text || '(empty paragraph)' })
        if (
          !Platform.isMobile &&
          (p.editable ||
            doc.images.some((i) => i.paragraph === p.number && i.inline && !i.protected))
        ) {
          const edit = row.createEl('button', {
            text: p.editable ? 'Edit text' : 'Edit images',
            cls: 'abele-word-edit',
          })
          edit.onclick = () => this.editParagraph(row, doc, p)
        }
      }
    }
    go.onclick = () => {
      if (!this.editing) page()
    }
    page()
    if (!doc.richPreview) {
      bar.createSpan({ text: 'Large document: paged text view keeps scrolling responsive.' })
      return
    }
    const toggle = bar.createEl('button', { text: 'Text paragraphs' })
    textPage.hidden = !this.textMode
    toggle.onclick = () => {
      if (this.editing) return
      this.textMode = !this.textMode
      textPage.hidden = !this.textMode
      if (this.frame) this.frame.hidden = this.textMode
    }
    const frame = this.contentEl.createEl('iframe', {
      cls: 'abele-word-preview',
      attr: { title: 'Word preview', sandbox: 'allow-same-origin' },
    })
    this.frame = frame
    frame.hidden = this.textMode
    const loaded = new Promise<void>((resolve) => {
      frame.onload = () => resolve()
    })
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${WORD_CSP}"></head><body></body></html>`
    await loaded
    if (token !== this.token) return
    const dom = frame.contentDocument
    if (!dom) throw new Error('Document preview is unavailable')
    const theme = getComputedStyle(this.contentEl)
    dom.body.style.color = theme.getPropertyValue('--text-normal')
    dom.body.style.background = theme.getPropertyValue('--background-primary')
    dom.body.style.fontFamily = theme.getPropertyValue('--font-text')
    // Namespace-aware creation in the isolated preview document, not the app window.
    const body = dom.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    dom.body.appendChild(body)
    await renderAsync(await safeRenderBytes(doc), body, dom.head, {
      ignoreWidth: true,
      ignoreHeight: true,
      ignoreFonts: true,
      inWrapper: false,
      renderAltChunks: false,
      renderComments: false,
      useBase64URL: true,
      breakPages: true,
    })
    cleanRendered(body)
    const style = dom.createElementNS('http://www.w3.org/1999/xhtml', 'style')
    style.textContent =
      'body{margin:0;padding:16px;overflow-wrap:anywhere}section.docx{background:transparent!important;color:inherit!important;font-family:inherit!important;width:auto!important;min-height:0!important;padding:0!important;box-shadow:none!important}table{max-width:100%}img{max-width:100%;height:auto}'
    dom.head.appendChild(style)
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
