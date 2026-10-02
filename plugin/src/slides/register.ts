import { MarkdownView, Platform, TFile, type Plugin, type WorkspaceLeaf } from 'obsidian'
import { DeckView } from './DeckView'
import { parseDeck } from './core/markdown'
import { slideDividers } from './dividers'
import { DECK_VIEW_TYPE, presentationFileOpening, sourceLeaves } from './opening'
import './core/layouts.css'

export function registerSlides(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(DECK_VIEW_TYPE, (leaf) => new DeckView(leaf))
  const isPresentation = async (file: TFile) => {
    if (!file || file.extension !== 'md') return false
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (frontmatter) return frontmatter.type === 'presentation'
    return parseDeck(await app.vault.cachedRead(file)).settings.properties.type === 'presentation'
  }
  plugin.register(presentationFileOpening(isPresentation))
  plugin.registerMarkdownPostProcessor(slideDividers)

  const open = async (file: TFile, target: WorkspaceLeaf) => {
    await target.setViewState({ type: DECK_VIEW_TYPE, state: { file: file.path }, active: true })
    return target.view instanceof DeckView ? target.view : null
  }
  const current = () => app.workspace.getActiveFile()
  const available = () => {
    const file = current()
    return file && app.metadataCache.getFileCache(file)?.frontmatter?.type === 'presentation'
      ? file
      : null
  }
  plugin.addCommand({
    id: 'open-presentation',
    name: 'Open presentation',
    icon: 'presentation',
    checkCallback: (checking) => {
      const file = available()
      if (!file) return false
      if (!checking) void open(file, app.workspace.getLeaf(false))
      return true
    },
  })
  plugin.addCommand({
    id: 'preview-presentation',
    name: 'Preview presentation beside editor',
    icon: 'columns-2',
    checkCallback: (checking) => {
      const file = available()
      if (!file) return false
      if (!checking) {
        const leaf = app.workspace.getMostRecentLeaf()
        if (leaf) {
          sourceLeaves.add(leaf)
          void open(file, app.workspace.createLeafBySplit(leaf, 'vertical'))
        }
      }
      return true
    },
  })
  plugin.addCommand({
    id: 'play-presentation',
    name: 'Play presentation',
    icon: 'play',
    checkCallback: (checking) => {
      const file = available()
      if (!file) return false
      if (!checking)
        void (async () => {
          const view = await open(file, app.workspace.getLeaf(false))
          await view?.viewer?.ready
          await view?.viewer?.present(!Platform.isMobile)
        })()
      return true
    },
  })
  plugin.addCommand({
    id: 'present-presentation',
    name: 'Present with speaker view',
    icon: 'presentation',
    checkCallback: (checking) => {
      const file = available()
      if (!file) return false
      if (!checking)
        void (async () => {
          const view = await open(file, app.workspace.getLeaf(false))
          await view?.viewer?.ready
          await view?.startPresenter()
        })()
      return true
    },
  })
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file, _source, leaf) => {
      if (
        !(file instanceof TFile) ||
        app.metadataCache.getFileCache(file)?.frontmatter?.type !== 'presentation'
      )
        return
      menu.addItem((item) =>
        item
          .setTitle('Open presentation')
          .setIcon('presentation')
          .onClick(() => void open(file, leaf ?? app.workspace.getLeaf('tab')))
      )
      menu.addItem((item) =>
        item
          .setTitle('Edit presentation source')
          .setIcon('file-pen')
          .onClick(() => {
            const target = leaf ?? app.workspace.getLeaf('tab')
            sourceLeaves.add(target)
            void target.setViewState({
              type: 'markdown',
              state: { file: file.path, mode: 'source' },
              active: true,
            })
          })
      )
    })
  )

  const actions = new Map<MarkdownView, HTMLElement>()
  let pending = 0
  const sync = () => {
    const kept = new Set<MarkdownView>()
    app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view
      if (
        !(view instanceof MarkdownView) ||
        !view.file ||
        app.metadataCache.getFileCache(view.file)?.frontmatter?.type !== 'presentation'
      )
        return
      kept.add(view)
      if (!actions.has(view))
        actions.set(
          view,
          view.addAction('presentation', 'Open presentation', () => {
            if (view.file) void open(view.file, leaf)
          })
        )
      if (!sourceLeaves.has(leaf)) void open(view.file, leaf)
    })
    for (const [view, action] of actions)
      if (!kept.has(view)) {
        action.remove()
        actions.delete(view)
      }
  }
  const schedule = () => {
    window.clearTimeout(pending)
    pending = window.setTimeout(sync, 30)
  }
  app.workspace.onLayoutReady(schedule)
  plugin.registerEvent(app.workspace.on('file-open', schedule))
  plugin.registerEvent(app.workspace.on('layout-change', schedule))
  plugin.registerEvent(app.metadataCache.on('changed', schedule))
  plugin.register(() => {
    window.clearTimeout(pending)
    actions.forEach((action) => action.remove())
    actions.clear()
  })
}
