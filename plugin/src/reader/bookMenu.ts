/**
 * What a book tab's ⋯ menu offers besides Obsidian's own: pages or scrolling, a link to the place
 * on screen, a chat about it, the search, the highlights, the bookmarks and the text and layout settings.
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
  showBookmarks(): void
  openSettings(): void
}

/** A PDF's zoom, from its tab's menu. */
export function fillZoomMenu(menu: Menu, zoom: (way: 'in' | 'out' | 'reset') => void): void {
  menu.addItem((item) =>
    item
      .setTitle('Zoom in')
      .setIcon('zoom-in')
      .setSection('zoom')
      .onClick(() => zoom('in'))
  )
  menu.addItem((item) =>
    item
      .setTitle('Zoom out')
      .setIcon('zoom-out')
      .setSection('zoom')
      .onClick(() => zoom('out'))
  )
  menu.addItem((item) =>
    item
      .setTitle('Zoom as set')
      .setIcon('scan')
      .setSection('zoom')
      .onClick(() => zoom('reset'))
  )
}

async function setFlow(flow: 'paginated' | 'scrolled', pdf: boolean): Promise<void> {
  const config = AbeleConfig.getInstance()
  config.reader = readerSettingsFrom(
    pdf ? { ...config.reader, pdfLayout: flow } : { ...config.reader, flow }
  )
  await config.saveSettings()
}

export function fillBookMenu(menu: Menu, host: BookMenuHost): void {
  const settings = readerSettingsFrom(AbeleConfig.getInstance().reader)
  const flow = host.pdf ? settings.pdfLayout : settings.flow
  menu.addItem((item) =>
    item
      .setTitle(
        flow === 'paginated' ? 'Scroll instead of turning pages' : 'Turn pages instead of scrolling'
      )
      .setIcon(flow === 'paginated' ? 'scroll-text' : 'book-open')
      .setSection('view')
      .onClick(() => void setFlow(flow === 'paginated' ? 'scrolled' : 'paginated', host.pdf))
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
      .setTitle('Bookmarks')
      .setIcon('bookmark')
      .setSection('view')
      .onClick(() => host.showBookmarks())
  )
  menu.addItem((item) =>
    item
      .setTitle('Text and layout…')
      .setIcon('a-large-small')
      .setSection('view')
      .onClick(() => host.openSettings())
  )
}
