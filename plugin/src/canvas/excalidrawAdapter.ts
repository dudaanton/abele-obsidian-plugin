/**
 * The vault as the Excalidraw migrator sees it, and the ways a person starts it: a command and a
 * file menu item for one drawing, a command for all of them. The migration itself is
 * `excalidraw/migrate.ts`, which knows nothing of Obsidian.
 */
import { Notice, TFile, normalizePath, type App, type Plugin } from 'obsidian'
import { openDialog } from '@/components/obsidian/dialogs'
import ExcalidrawMigrationModal from '@/components/ExcalidrawMigrationModal.vue'
import { isExcalidrawName } from './excalidraw/source'
import { migratedFrom } from './excalidraw/convert'
import { migrateAll, migrateOne, type ExcalidrawVault, type FileReport } from './excalidraw/migrate'
import { openCanvas } from './opening'

/** Whether a vault file is a drawing of the Excalidraw plugin. */
export function isExcalidrawFile(app: App, file: TFile): boolean {
  if (file.extension === 'excalidraw') return true
  if (file.extension !== 'md') return false
  if (isExcalidrawName(file.path)) return true
  return app.metadataCache.getFileCache(file)?.frontmatter?.['excalidraw-plugin'] !== undefined
}

export class ObsidianExcalidrawVault implements ExcalidrawVault {
  /** `writeApp` makes the files: a chat's own window, when the agent asked. */
  constructor(
    private readonly app: App,
    private readonly writeApp: App = app
  ) {}

  drawings(): Promise<string[]> {
    return Promise.resolve(
      this.app.vault
        .getFiles()
        .filter((f) => isExcalidrawFile(this.app, f))
        .map((f) => f.path)
        .sort((a, b) => a.localeCompare(b))
    )
  }

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
    return file
  }

  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path))
  }

  exists(path: string): boolean {
    return !!this.app.vault.getAbstractFileByPath(normalizePath(path))
  }

  async createText(path: string, text: string): Promise<void> {
    await this.writeApp.vault.create(normalizePath(path), text)
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.writeApp.vault.createBinary(normalizePath(path), data)
  }

  resolve(link: string, from: string): string | null {
    return this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null
  }

  async migrated(): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const file of this.app.vault.getFiles()) {
      if (file.extension !== 'canvas') continue
      try {
        const text = await this.app.vault.cachedRead(file)
        if (!text.includes('"excalidraw"')) continue
        const from = migratedFrom(JSON.parse(text) as { abele?: Record<string, unknown> })
        if (from) out.set(from, file.path)
      } catch {
        // A canvas that does not read is not one this migrator made.
      }
    }
    return out
  }
}

/** One line for a person about one drawing's migration. */
export function reportLine(report: FileReport): string {
  if (report.status === 'failed') return `The drawing could not be migrated: ${report.reason}`
  if (report.status === 'skipped') return `This drawing already has a canvas: ${report.target}`
  const lost = report.losses.map((l) => l.what.toLowerCase()).join(', ')
  return `Made ${report.target}.` + (lost ? ` Not carried over: ${lost}.` : '')
}

/** Migrates one drawing and opens its canvas — the new one, or the one made before. */
export async function migrateDrawing(app: App, file: TFile): Promise<FileReport> {
  const report = await migrateOne(new ObsidianExcalidrawVault(app), file.path)
  new Notice(reportLine(report), report.losses.length ? 10000 : 5000)
  const target = report.target ? app.vault.getAbstractFileByPath(report.target) : null
  if (target instanceof TFile) await openCanvas(app, target)
  return report
}

/** Asks with the number of drawings, migrates them all, and shows the report. */
export async function migrateVaultDrawings(app: App): Promise<void> {
  const vault = new ObsidianExcalidrawVault(app)
  const drawings = await vault.drawings()
  await openDialog(ExcalidrawMigrationModal, {
    drawings,
    run: (onProgress: (done: number, total: number) => void) =>
      migrateAll(vault, { onProgress }).then((report) => {
        console.debug('[Abele] Excalidraw migration', report)
        return report
      }),
  })
}

export function registerExcalidrawMigration(plugin: Plugin): void {
  const { app } = plugin
  plugin.addCommand({
    id: 'migrate-excalidraw-drawing',
    name: 'Migrate this Excalidraw drawing to a canvas',
    icon: 'workflow',
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile()
      if (!file || !isExcalidrawFile(app, file)) return false
      if (!checking) void migrateDrawing(app, file)
      return true
    },
  })
  plugin.addCommand({
    id: 'migrate-excalidraw-vault',
    name: 'Migrate all Excalidraw drawings to canvases',
    icon: 'workflow',
    callback: () => void migrateVaultDrawings(app),
  })
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !isExcalidrawFile(app, file)) return
      menu.addItem((item) =>
        item
          .setTitle('Migrate to Abele canvas')
          .setIcon('workflow')
          .onClick(() => void migrateDrawing(app, file))
      )
    })
  )
}
