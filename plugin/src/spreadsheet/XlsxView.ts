import { FileView, Platform, TFile, type WorkspaceLeaf, type Plugin } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import WorkbookGrid from './WorkbookGrid.vue'
import { openXlsx, type Workbook } from './package'
import './workbook.css'
export const XLSX_VIEW_TYPE = 'abele-workbook'
export const loadWorkbookBytes = (bytes: Uint8Array, readOnly = false) =>
  openXlsx(bytes, readOnly, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
export class XlsxView extends FileView {
  workbook: Workbook | null = null
  private vue: VueApp | null = null
  private token = 0
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === this.file?.path) void this.onLoadFile(file)
      })
    )
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
  async onLoadFile(file: TFile): Promise<void> {
    const token = ++this.token
    this.vue?.unmount()
    this.vue = null
    this.workbook = null
    this.contentEl.empty()
    this.contentEl.addClass('abele-workbook')
    const status = this.contentEl.createDiv({ text: 'Opening workbook…', attr: { role: 'status' } })
    try {
      const book = await loadWorkbookBytes(
        new Uint8Array(await this.app.vault.readBinary(file)),
        file.extension.toLowerCase() === 'xlsm'
      )
      if (token !== this.token) return
      this.workbook = book
      status.remove()
      this.vue = createApp(WorkbookGrid, { book, mobile: Platform.isMobile })
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
