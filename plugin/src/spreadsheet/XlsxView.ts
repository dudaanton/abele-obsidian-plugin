import { FileView, Platform, TFile, type WorkspaceLeaf, type Plugin } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import { readOfficeBytes } from '@/ooxml/vaultAdapter'
import { sameBytes } from '@/ooxml/write'
import WorkbookGrid from './WorkbookGrid.vue'
import type { Workbook } from './package'
import type { WorkbookEdit } from './edit'
import { applyCalculatedEdit } from './calculation'
import { loadWorkbookBytes, writeWorkbookChange, yieldWorkbookTask } from './vaultAdapter'
import './workbook.css'
export const XLSX_VIEW_TYPE = 'abele-workbook'
export class XlsxView extends FileView {
  workbook: Workbook | null = null
  sheetName = ''
  cell = 'A1'
  zoom = 1
  private editing = false
  private externalChange = false
  private loadedPath = ''
  private vue: VueApp | null = null
  private token = 0
  private saving = false
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) void this.onWorkbookModified(file)
      })
    )
  }
  async onWorkbookModified(file: TFile): Promise<void> {
    if (file.path !== this.file?.path || this.saving) return
    if (this.editing) {
      this.externalChange = true
      return
    }
    const token = this.token
    try {
      const bytes = await readOfficeBytes(this.app, file)
      if (token !== this.token || this.file !== file || this.saving) return
      if (this.editing) {
        this.externalChange = true
        return
      }
      const book = this.workbook
      if (
        book &&
        this.loadedPath === file.path &&
        !(file.extension.toLowerCase() === 'xlsm' && !book.readOnly) &&
        sameBytes(book.original, bytes)
      )
        return
      await this.onLoadFile(file)
    } catch {
      if (token === this.token && this.file === file && !this.editing) await this.onLoadFile(file)
    }
  }
  getViewType() {
    return XLSX_VIEW_TYPE
  }
  getDisplayText() {
    return this.file?.name ?? 'Excel workbook'
  }
  getIcon() {
    return 'table'
  }
  async onLoadFile(file: TFile, calculationNote?: string): Promise<void> {
    const token = ++this.token
    if (this.loadedPath && this.loadedPath !== file.path) {
      this.sheetName = ''
      this.cell = 'A1'
      this.zoom = 1
    }
    this.loadedPath = file.path
    this.editing = false
    this.externalChange = false
    this.vue?.unmount()
    this.vue = null
    this.workbook = null
    this.contentEl.empty()
    this.contentEl.addClass('abele-workbook')
    const status = this.contentEl.createDiv({ text: 'Opening workbook…', attr: { role: 'status' } })
    try {
      const book = await loadWorkbookBytes(
        await readOfficeBytes(this.app, file),
        file.extension.toLowerCase() === 'xlsm'
      )
      if (token !== this.token) return
      this.workbook = book
      book.calculationNote = calculationNote
      status.remove()
      this.vue = createApp(WorkbookGrid, {
        book,
        mobile: Platform.isMobile,
        initialSheet: this.sheetName,
        initialAddress: this.cell,
        initialZoom: this.zoom,
        context: (sheet: string, address: string, zoom: number) => {
          this.sheetName = sheet
          this.cell = address
          this.zoom = zoom
        },
        editorState: (open: boolean) => {
          this.editing = open
          if (!open && this.externalChange && this.file === file) void this.onLoadFile(file)
        },
        save: async (edit: WorkbookEdit) => {
          if (Platform.isMobile || book.readOnly)
            throw new Error('Hand editing is desktop-only for .xlsx files')
          if (this.file !== file || this.workbook !== book)
            throw new Error('Workbook is no longer open')
          const calculated = await applyCalculatedEdit(book, edit, undefined, yieldWorkbookTask)
          const updated = calculated.bytes
          if (this.file !== file || this.workbook !== book)
            throw new Error('Workbook is no longer open')
          this.saving = true
          try {
            await writeWorkbookChange(this.app, file, book.original, updated)
          } finally {
            this.saving = false
          }
          await this.onLoadFile(file, calculated.note)
        },
      })
      this.vue.mount(this.contentEl)
    } catch (e) {
      if (token === this.token) status.setText(`Could not open workbook: ${(e as Error).message}`)
    }
  }
  async onUnloadFile(): Promise<void> {
    ++this.token
    this.vue?.unmount()
    this.vue = null
    this.workbook = null
    this.contentEl.empty()
  }
}
export function registerWorkbooks(plugin: Plugin): void {
  plugin.registerView(XLSX_VIEW_TYPE, (leaf) => new XlsxView(leaf))
  try {
    plugin.registerExtensions(['xlsx', 'xlsm'], XLSX_VIEW_TYPE)
  } catch {
    console.warn('[Abele] Workbook extension already handled; use Open in Abele workbook viewer')
  }
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !['xlsx', 'xlsm'].includes(file.extension.toLowerCase()))
        return
      menu.addItem((item) =>
        item
          .setTitle('Open in Abele workbook viewer')
          .setIcon('table')
          .onClick(() => {
            void plugin.app.workspace
              .getLeaf('tab')
              .setViewState({ type: XLSX_VIEW_TYPE, state: { file: file.path }, active: true })
          })
      )
    })
  )
}
