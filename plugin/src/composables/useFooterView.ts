import { inject, shallowRef } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { FooterSection } from '@/helpers/footerFolds'
import {
  footerViewFrom,
  isOpen,
  pagesOf,
  renameFooterView,
  setOpen,
  setPages,
  setTimelinePast,
  timelinePastOf,
  type FooterViewState,
} from '@/helpers/footerView'
import { FOOTER_FOLD } from './useFooterFold'

/**
 * How the lists under a note were left — pages drawn, tasks opened — kept as they change and
 * handed back when the note opens again (`helpers/footerView.ts`). Outside a note's footer, and
 * with notes not reopened where they were left, every list starts on its first page, closed.
 */

/** The app's local-storage key: per vault, on this device. */
export const FOOTER_VIEW_KEY = 'abele-footer-view'

const state = shallowRef<FooterViewState | null>(null)

const app = () => GlobalStore.getInstance().app

const current = (): FooterViewState => {
  if (!state.value) state.value = footerViewFrom(app().loadLocalStorage(FOOTER_VIEW_KEY))
  return state.value
}

const write = (next: FooterViewState): void => {
  if (next === state.value) return
  state.value = next
  app().saveLocalStorage(FOOTER_VIEW_KEY, next)
}

/** Whether a note opening again is brought back to how it was left. */
const restoring = (): boolean => AbeleConfig.getInstance().rememberNotePlaces

export interface RememberedPages {
  /** Pages to draw at first. */
  initial: number
  /** Called with the pages drawn whenever that changes. */
  record: (pages: number) => void
}

/** The pages of one list under a note; one page, remembering nothing, anywhere else. */
export function useFooterPages(section: FooterSection): RememberedPages {
  const path = inject(FOOTER_FOLD, null)
  if (!path) return { initial: 1, record: () => {} }
  return {
    initial: restoring() ? pagesOf(current(), path(), section) : 1,
    record: (pages) => write(setPages(current(), path(), section, pages)),
  }
}

/** The timeline needs its revealed history state before note-place restoration runs. */
export function useFooterTimeline() {
  const path = inject(FOOTER_FOLD, null)
  return {
    ...useFooterPages('calendar'),
    pastRevealed: !!path && restoring() && timelinePastOf(current(), path()),
    recordPast: (revealed: boolean) => {
      if (path) write(setTimelinePast(current(), path(), revealed))
    },
  }
}

export interface RememberedOpen {
  initial: boolean
  record: (open: boolean) => void
}

/** Whether a task in the list under a note shows its description; closed anywhere else. */
export function useFooterTaskOpen(task: () => string): RememberedOpen {
  const path = inject(FOOTER_FOLD, null)
  if (!path) return { initial: false, record: () => {} }
  return {
    initial: restoring() && isOpen(current(), path(), task()),
    record: (open) => write(setOpen(current(), path(), task(), open)),
  }
}

/** A renamed or moved note keeps how its lists were left. */
export function moveFooterView(oldPath: string, newPath: string): void {
  write(renameFooterView(current(), oldPath, newPath))
}

/** A deleted note's lists are forgotten, a folder's with all under it: a note made later under the same name starts afresh. */
export function forgetFooterView(path: string): void {
  // A folder deleted whole may say so once, for itself.
  const state = current()
  const gone = Object.keys(state).filter((key) => key === path || key.startsWith(path + '/'))
  if (!gone.length) return
  const next = { ...state }
  for (const key of gone) delete next[key]
  write(next)
}

/** Forgets what was read, so the next reader loads it again. For tests. */
export function resetFooterView(): void {
  state.value = null
}
