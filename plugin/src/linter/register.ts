/**
 * The linter's hooks into Obsidian: its tab, the commands, and "Lint" in the menus of a note, a
 * folder and several selected files.
 */
import { FuzzySuggestModal, MarkdownView, TFile, TFolder, type App, type Plugin } from 'obsidian'
import { LINTER_VIEW_TYPE, LinterView, lintInView, openLinter } from './LinterView'
import { LinterService } from './LinterService'

/** Asks for a folder, the vault's root among them; null when the question is dismissed. */
class FolderModal extends FuzzySuggestModal<TFolder> {
  private resolve: (folder: TFolder | null) => void = () => {}
  private picked = false

  constructor(app: App) {
    super(app)
    this.setPlaceholder('Lint which folder?')
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder)
  }

  getItemText(folder: TFolder): string {
    return folder.isRoot() ? '/' : folder.path
  }

  onChooseItem(folder: TFolder): void {
    this.picked = true
    this.resolve(folder)
  }

  onClose(): void {
    window.setTimeout(() => {
      if (!this.picked) this.resolve(null)
    }, 0)
  }

  pick(): Promise<TFolder | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
}

const folderTarget = (folder: TFolder) =>
  folder.isRoot() ? ({ kind: 'vault' } as const) : ({ kind: 'folder', path: folder.path } as const)

export function registerLinter(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(LINTER_VIEW_TYPE, (leaf) => new LinterView(leaf))
  plugin.register(() => LinterService.destroy())

  plugin.addCommand({
    id: 'linter-open',
    name: 'Open linter',
    icon: LinterView.getIcon(),
    callback: () => void openLinter(app),
  })

  plugin.addCommand({
    id: 'linter-lint-note',
    name: 'Lint current note',
    icon: LinterView.getIcon(),
    checkCallback: (checking) => {
      const file =
        app.workspace.getActiveViewOfType(MarkdownView)?.file ?? app.workspace.getActiveFile()
      if (!(file instanceof TFile) || file.extension !== 'md') return false
      if (!checking) void lintInView(app, { kind: 'notes', paths: [file.path] })
      return true
    },
  })

  plugin.addCommand({
    id: 'linter-lint-folder',
    name: 'Lint folder…',
    icon: LinterView.getIcon(),
    callback: async () => {
      const folder = await new FolderModal(app).pick()
      if (folder) await lintInView(app, folderTarget(folder))
    },
  })

  plugin.addCommand({
    id: 'linter-lint-vault',
    name: 'Lint vault',
    icon: LinterView.getIcon(),
    callback: () => void lintInView(app, { kind: 'vault' }),
  })

  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) =>
          item
            .setTitle('Lint this folder')
            .setIcon(LinterView.getIcon())
            .setSection('action')
            .onClick(() => void lintInView(app, folderTarget(file)))
        )
      } else if (file instanceof TFile && file.extension === 'md') {
        menu.addItem((item) =>
          item
            .setTitle('Lint this note')
            .setIcon(LinterView.getIcon())
            .setSection('action')
            .onClick(() => void lintInView(app, { kind: 'notes', paths: [file.path] }))
        )
      }
    })
  )

  // Several files selected in the file explorer: the notes among them, and every note of a folder.
  plugin.registerEvent(
    app.workspace.on('files-menu', (menu, files) => {
      const paths = new Set<string>()
      for (const f of files) {
        if (f instanceof TFile && f.extension === 'md') paths.add(f.path)
        if (f instanceof TFolder) {
          for (const note of app.vault.getMarkdownFiles()) {
            if (f.isRoot() || note.path.startsWith(f.path + '/')) paths.add(note.path)
          }
        }
      }
      if (!paths.size) return
      menu.addItem((item) =>
        item
          .setTitle(`Lint ${paths.size} ${paths.size === 1 ? 'note' : 'notes'}`)
          .setIcon(LinterView.getIcon())
          .setSection('action')
          .onClick(() => void lintInView(app, { kind: 'notes', paths: [...paths] }))
      )
    })
  )
}
