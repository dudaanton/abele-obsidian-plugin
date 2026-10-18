import { t } from '@/i18n'
/**
 * What a book tab's ⋯ menu offers besides Obsidian's own: pages or scrolling, e-ink mode, zen mode, a link to the place
 * on screen, a chat about it, the search, the highlights, the bookmarks and the text and layout settings.
 */
import type { Menu } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { readerSettingsFrom } from './settings'
import { currentReaderSettings } from './currentSettings'
import { eink, setEink } from './eink'
import { setZen, zen } from './zen'

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
  /** Drawing on the pages turned on or off; a PDF only. */
  draw?: () => void
  drawing?: boolean
}

export type ZoomWay = 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page'

/**
 * A PDF's zoom, from its tab's menu or the zoom under its page: a step in and out (left out
 * where the buttons beside it already step), a fit to the width or the whole page, and back to
 * the setting.
 */
export function fillZoomMenu(menu: Menu, zoom: (way: ZoomWay) => void, steps = true): void {
  if (steps) {
    menu.addItem((item) =>
      item
        .setTitle(t('streamC.0e47f09a748fa132'))
        .setIcon('zoom-in')
        .setSection('zoom')
        .onClick(() => zoom('in'))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('streamC.bc7b631a689b45ca'))
        .setIcon('zoom-out')
        .setSection('zoom')
        .onClick(() => zoom('out'))
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.b2c88623527a0b38'))
      .setIcon('move-horizontal')
      .setSection('zoom')
      .onClick(() => zoom('fit-width'))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.cb5dd60c9caab342'))
      .setIcon('maximize')
      .setSection('zoom')
      .onClick(() => zoom('fit-page'))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.c26eb6efcf1208ea'))
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
  const settings = currentReaderSettings()
  const flow = host.pdf ? settings.pdfLayout : settings.flow
  // E-ink mode keeps pages: scrolling is not offered while it is on.
  if (!eink().on)
    menu.addItem((item) =>
      item
        .setTitle(
          flow === 'paginated' ? t('streamC.b193196ebea3c987') : t('streamC.2fcacd657e1e9318')
        )
        .setIcon(flow === 'paginated' ? 'scroll-text' : 'book-open')
        .setSection('view')
        .onClick(() => void setFlow(flow === 'paginated' ? 'scrolled' : 'paginated', host.pdf))
    )
  menu.addItem((item) =>
    item
      .setTitle(eink().on ? t('streamC.4ec0dd26f1d2c582') : t('streamC.b80959434c39717b'))
      .setIcon('tablet')
      .setSection('view')
      .onClick(() => setEink({ on: !eink().on }))
  )
  menu.addItem((item) =>
    item
      .setTitle(zen().on ? t('streamC.5a5d656221488227') : t('streamC.7224fdd49808f1f2'))
      .setIcon(zen().on ? 'shrink' : 'expand')
      .setSection('view')
      .onClick(() => setZen(!zen().on))
  )
  if (host.ready) {
    menu.addItem((item) =>
      item
        .setTitle(host.pdf ? t('streamC.1436a78da83958e6') : t('streamC.8c3732073eaf785d'))
        .setIcon('link')
        .setSection('action')
        .onClick(() => host.copyLink())
    )
    if (host.canAsk)
      menu.addItem((item) =>
        item
          .setTitle(t('commands.chat-about-current-note'))
          .setIcon('message-square-plus')
          .setSection('action')
          .onClick(() => host.ask())
      )
  }
  const draw = host.draw
  if (draw)
    menu.addItem((item) =>
      item
        .setTitle(host.drawing ? t('streamC.2f6a897afbb198e3') : t('streamC.5c70b136b98e494f'))
        .setIcon(host.drawing ? 'pen-off' : 'pen-line')
        .setSection('action')
        .onClick(() => draw())
    )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.95110cecd26a94f4'))
      .setIcon('search')
      .setSection('view')
      .onClick(() => host.openSearch())
  )
  menu.addItem((item) =>
    item
      .setTitle(t('settings.components.reader.BookNotesSettings.highlights.6e517828'))
      .setIcon('highlighter')
      .setSection('view')
      .onClick(() => host.showHighlights())
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.96316f0f6404dbe1'))
      .setIcon('bookmark')
      .setSection('view')
      .onClick(() => host.showBookmarks())
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.0388c88eef928da2'))
      .setIcon('a-large-small')
      .setSection('view')
      .onClick(() => host.openSettings())
  )
}
