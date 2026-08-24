import { TAbstractFile, TFile, EventRef, Modal, Notice, normalizePath } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from './AbeleConfig'

export class SnippetService {
  private styleElements = new Map<string, HTMLStyleElement>()
  private eventRefs: EventRef[] = []

  private static instance: SnippetService | null = null

  static getInstance(): SnippetService {
    if (!this.instance) {
      this.instance = new SnippetService()
    }
    return this.instance
  }

  static destroy(): void {
    if (this.instance) {
      this.instance.cleanup()
      this.instance = null
    }
  }

  async init(): Promise<void> {
    const folder = AbeleConfig.getInstance().snippetsFolder
    if (!folder) return

    await this.loadAll()
    this.startWatching()
  }

  private get folder(): string {
    return AbeleConfig.getInstance().snippetsFolder
  }

  private isSnippet(file: TAbstractFile): boolean {
    return (
      file instanceof TFile && file.extension === 'css' && file.path.startsWith(this.folder + '/')
    )
  }

  private async loadAll(): Promise<void> {
    const { app } = GlobalStore.getInstance()
    const folder = app.vault.getAbstractFileByPath(this.folder)
    if (!folder) return

    const files = app.vault.getFiles().filter((f) => this.isSnippet(f))
    for (const file of files) {
      await this.injectStyle(file)
    }

    console.debug(`[SnippetService] Loaded ${files.length} snippet(s) from ${this.folder}/`)
  }

  private async injectStyle(file: TFile): Promise<void> {
    const content = await GlobalStore.getInstance().app.vault.read(file)
    let el = this.styleElements.get(file.path)

    if (el) {
      el.textContent = content
    } else {
      el = createEl('style')
      el.setAttribute('data-abele-snippet', file.path)
      el.textContent = content
      document.head.appendChild(el)
      this.styleElements.set(file.path, el)
    }
  }

  private removeStyle(path: string): void {
    const el = this.styleElements.get(path)
    if (el) {
      el.remove()
      this.styleElements.delete(path)
    }
  }

  private startWatching(): void {
    const { app } = GlobalStore.getInstance()

    this.eventRefs.push(
      app.vault.on('create', (file) => {
        if (this.isSnippet(file)) this.injectStyle(file as TFile)
      })
    )

    this.eventRefs.push(
      app.vault.on('modify', (file) => {
        if (this.isSnippet(file)) this.injectStyle(file as TFile)
      })
    )

    this.eventRefs.push(
      app.vault.on('delete', (file) => {
        if (file.path.startsWith(this.folder + '/') && file.path.endsWith('.css')) {
          this.removeStyle(file.path)
        }
      })
    )

    this.eventRefs.push(
      app.vault.on('rename', (file, oldPath) => {
        // Remove old style if it was a snippet
        if (oldPath.startsWith(this.folder + '/') && oldPath.endsWith('.css')) {
          this.removeStyle(oldPath)
        }
        // Add new style if it is now a snippet
        if (this.isSnippet(file)) this.injectStyle(file as TFile)
      })
    )
  }

  async createSnippet(): Promise<void> {
    const folder = this.folder
    if (!folder) {
      new Notice('CSS snippets folder is not configured')
      return
    }

    const { app } = GlobalStore.getInstance()
    const name = await new Promise<string | null>((resolve) => {
      const modal = new (class extends Modal {
        onOpen() {
          const { contentEl } = this
          contentEl.createEl('h3', { text: 'New CSS snippet' })
          const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'filename',
            cls: 'abele-snippet-name-input',
          })
          input.style.width = '100%'
          input.focus()
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
              resolve(input.value.trim())
              this.close()
            }
          })
          this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
              resolve(null)
              this.close()
            }
          })
        }
        onClose() {
          resolve(null)
        }
      })(app)
      modal.open()
    })

    if (!name) return

    const filename = name.endsWith('.css') ? name : `${name}.css`
    const path = normalizePath(`${folder}/${filename}`)

    // Ensure folder exists
    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder)
    }

    if (app.vault.getAbstractFileByPath(path)) {
      new Notice(`File already exists: ${path}`)
      return
    }

    const file = await app.vault.create(path, '')

    // Open in editor
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
  }

  /** Reload all snippets (e.g. when folder setting changes) */
  async reload(): Promise<void> {
    this.cleanup()
    await this.init()
  }

  private cleanup(): void {
    for (const el of this.styleElements.values()) {
      el.remove()
    }
    this.styleElements.clear()

    const { app } = GlobalStore.getInstance()
    for (const ref of this.eventRefs) {
      app.vault.offref(ref)
    }
    this.eventRefs = []
  }
}
