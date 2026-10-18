import { t } from '@/i18n'
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
import {
  migrateAll,
  migrateOne,
  type ExcalidrawVault,
  type FileReport,
  type ReferenceReport,
} from './excalidraw/migrate'
import { rewriteDrawingReferences } from './excalidraw/references'
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

  async createBinary(path: string, data: ArrayBuffer): Promise<() => Promise<void>> {
    const file = await this.writeApp.vault.createBinary(normalizePath(path), data)
    return async () => {
      // Retain the created object: a replacement at the same path is not ours to delete.
      if (this.app.vault.getAbstractFileByPath(file.path) === file)
        await this.writeApp.fileManager.trashFile(file)
    }
  }

  resolve(link: string, from: string): string | null {
    return this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null
  }

  async rewriteReferences(source: string, target: string): Promise<ReferenceReport> {
    const paths = new Set(
      Object.entries(this.app.metadataCache.resolvedLinks ?? {})
        .filter(([, links]) => (links[source] ?? 0) > 0)
        .map(([path]) => path)
    )
    // Canvas file nodes are not consistently included in Obsidian's Markdown backlinks index.
    for (const file of this.app.vault.getFiles())
      if (file.extension === 'canvas') paths.add(file.path)
    const report: ReferenceReport = { rewritten: 0, files: [] }
    for (const path of paths) {
      if (path === source) continue
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile) || !['md', 'canvas'].includes(file.extension)) continue
      let count = 0
      try {
        await this.writeApp.vault.process(file, (current) => {
          const result = rewriteDrawingReferences(current, {
            source,
            target,
            kind: file.extension as 'md' | 'canvas',
            resolve: (link) => this.resolve(link, path),
          })
          count = result.count
          return result.text
        })
        if (count) report.files.push({ path, count })
        report.rewritten += count
      } catch (error) {
        report.files.push({
          path,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    console.debug('[Abele] Excalidraw reference updates', source, report)
    return report
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
  if (report.status === 'failed')
    return t('streamC.41ddd18106e858ef', { v1: String(report.reason) })
  if (report.status === 'skipped')
    return t('streamC.97bfa2c591c97ac0', { v1: String(report.target) })
  const lost = report.losses.map((l) => l.what.toLowerCase()).join(', ')
  const errors = report.references?.files.filter((file) => file.error) ?? []
  return (
    t('streamC.1744cb89cb205385', {
      v1: String(report.target),
      v2: String(report.references?.rewritten ?? 0),
    }) +
    (lost ? t('streamC.809074bb701635a5', { v1: String(lost) }) : '') +
    errors
      .map((file) =>
        t('streamC.efc54a5a5e5cbef7', { v1: String(file.path), v2: String(file.error) })
      )
      .join('')
  )
}

/** An explicit migration makes a fresh canvas; bulk migration still skips existing results. */
export async function migrateDrawing(app: App, file: TFile): Promise<FileReport> {
  const report = await migrateOne(new ObsidianExcalidrawVault(app), file.path, { force: true })
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
    name: t('commands.migrate-excalidraw-drawing'),
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
    name: t('commands.migrate-excalidraw-vault'),
    icon: 'workflow',
    callback: () => void migrateVaultDrawings(app),
  })
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !isExcalidrawFile(app, file)) return
      menu.addItem((item) =>
        item
          .setTitle(t('streamC.9100203381f02cfe'))
          .setIcon('workflow')
          .onClick(() => void migrateDrawing(app, file))
      )
    })
  )
}
