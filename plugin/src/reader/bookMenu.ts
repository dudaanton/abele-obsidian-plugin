/**
 * What a book tab's ⋯ menu offers besides Obsidian's own: pages or scrolling, a link to the place
 * on screen, a chat about it, the search, the highlights and the text and layout settings.
 */
import type { Menu } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { readerSettingsFrom } from './settings'

export interface BookMenuHost {
  /** A book is showing, so there is a place to link to. */
  ready: boolean
  pdf: boolean
  canAsk: boolean
  copyLink(): void
  ask(): void
  openSearch(): void
  showHighlights(): void
  openSettings(): void
}

async function setFlow(flow: 'paginated' | 'scrolled'): Promise<void> {
  const config = AbeleConfig.getInstance()
  config.reader = readerSettingsFrom({ ...config.reader, flow })
  await config.saveSettings()
}

export function fillBookMenu(menu: Menu, host: BookMenuHost): void {
  const flow = readerSettingsFrom(AbeleConfig.getInstance().reader).flow
  if (!host.pdf)
    menu.addItem((item) =>
      item
        .setTitle(
          flow === 'paginated'
            ? 'Scroll instead of turning pages'
            : 'Turn pages instead of scrolling'
        )
        .setIcon(flow === 'paginated' ? 'scroll-text' : 'book-open')
        .setSection('view')
        .onClick(() => void setFlow(flow === 'paginated' ? 'scrolled' : 'paginated'))
    )
  if (host.ready) {
    menu.addItem((item) =>
      item
        .setTitle(host.pdf ? 'Copy link to this page' : 'Copy link to this place')
        .setIcon('link')
        .setSection('action')
        .onClick(() => host.copyLink())
    )
    if (host.canAsk)
      menu.addItem((item) =>
        item
          .setTitle('Chat about this')
          .setIcon('message-square-plus')
          .setSection('action')
          .onClick(() => host.ask())
      )
  }
  menu.addItem((item) =>
    item
      .setTitle('Search in the book')
      .setIcon('search')
      .setSection('view')
      .onClick(() => host.openSearch())
  )
  menu.addItem((item) =>
    item
      .setTitle('Highlights')
      .setIcon('highlighter')
      .setSection('view')
      .onClick(() => host.showHighlights())
  )
  menu.addItem((item) =>
    item
      .setTitle('Text and layout…')
      .setIcon('a-large-small')
      .setSection('view')
      .onClick(() => host.openSettings())
  )
}
