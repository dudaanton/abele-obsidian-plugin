/**
 * What the book tab's Vue side (`BookReader.vue`) can ask of the tab, as the props its events
 * arrive through.
 */
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import type { Highlight, HighlightColor } from './highlights'
import type { BookModel, PanelTab, SearchHit } from './model'
import type { BookReading } from './BookReading'

export interface BookActions {
  model: BookModel
  reader(): FoliateView | null
  reading(): BookReading | null
  setStage(el: HTMLElement): void
  setPanel(open: boolean): void
  closeFootnote(): void
  footnoteHref(): string
  commentOnSelection(): Promise<void>
}

type Place = { cfi: string; label: string }

export function bookCallbacks(a: BookActions): Record<string, unknown> {
  const { model } = a
  return {
    onStage: (el: HTMLElement): void => a.setStage(el),
    onGo: (href: string, fromPanel: boolean): void => {
      if (fromPanel) model.panel = false
      void a.reader()?.goTo(href)
    },
    onSeek: (fraction: number): void => void a.reader()?.goToFraction(fraction),
    onBack: (): void => a.reader()?.history.back(),
    onPanel: (open: boolean): void => a.setPanel(open),
    onSettings: (open: boolean): void => {
      model.settingsOpen = open
    },
    onFootnoteClose: (): void => a.closeFootnote(),
    onFigureClose: (): void => {
      model.figure = null
    },
    onFootnoteGo: (): void => {
      const href = a.footnoteHref()
      a.closeFootnote()
      if (href) void a.reader()?.goTo(href)
    },
    onHighlight: (color: HighlightColor): void => void a.reading()?.highlight(color),
    onComment: (): void => void a.commentOnSelection(),
    onCopyLink: (target?: Place): void => void a.reading()?.copyLink(target),
    onQuote: (target: Place & { text: string }): void => void a.reading()?.quoteIntoNote(target),
    onClearSelection: (): void => a.reading()?.clearSelection(),
    onAsk: (target?: Place & { text: string }): void => void a.reading()?.ask(target),
    onReadAloud: (): void => a.reading()?.readFromSelection(),
    onSpeech: (action: 'toggle' | 'stop' | 'next' | 'prev' | 'settings'): void => {
      const speech = a.reading()?.speech
      if (action === 'settings') model.settingsOpen = true
      else if (action === 'toggle') speech?.toggle()
      else if (action === 'stop') speech?.stop()
      else void speech?.narrator?.skip(action === 'next' ? 1 : -1)
    },
    onRecolor: (h: Highlight, color: HighlightColor): void =>
      void a.reading()?.save({ ...h, color }),
    onEditComment: (h: Highlight): void => {
      model.commenting = { ...h }
    },
    onSaveComment: (h: Highlight, comment: string): void => {
      model.commenting = null
      void a.reading()?.save({ ...h, comment })
    },
    onCancelComment: (): void => {
      model.commenting = null
    },
    onDeleteHighlight: (h: Highlight): void => void a.reading()?.remove(h),
    onOpenNote: (h?: Highlight): void => void a.reading()?.openNote(h),
    onCloseActive: (): void => {
      model.active = null
    },
    onGoHighlight: (h: Highlight, fromPanel: boolean): void => {
      if (fromPanel) model.panel = false
      void a.reading()?.goToPlace({ cfi: h.cfi })
    },
    onPanelTab: (tab: PanelTab): void => {
      model.panelTab = tab
    },
    onSearch: (query: string): void => void a.reading()?.search(query),
    onSearchHit: (hit: SearchHit, fromPanel: boolean): void => {
      if (fromPanel) model.panel = false
      void a.reading()?.goToHit(hit)
    },
  }
}
