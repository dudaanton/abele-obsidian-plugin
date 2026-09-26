import { computed, inject, provide, shallowRef, type ComputedRef, type InjectionKey } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  foldStateFrom,
  isFolded,
  renameFolds,
  setFolded,
  type FooterSection,
  type FoldState,
} from '@/helpers/footerFolds'

/**
 * Folding a list under a note. The footer provides the note's path; a list rendered anywhere
 * else — the task or finance sidebar, where it is the only list — finds none and does not fold.
 */
export const FOOTER_FOLD: InjectionKey<() => string> = Symbol('abele-footer-fold')

/** The app's local-storage key: per vault, on this device. */
export const FOOTER_FOLDS_KEY = 'abele-footer-folds'

/** Shared by every footer, so two tabs on one note fold together. Read lazily, once. */
const state = shallowRef<FoldState | null>(null)

const app = () => GlobalStore.getInstance().app

const current = (): FoldState => {
  if (!state.value) state.value = foldStateFrom(app().loadLocalStorage(FOOTER_FOLDS_KEY))
  return state.value
}

const write = (next: FoldState): void => {
  if (next === state.value) return
  state.value = next
  app().saveLocalStorage(FOOTER_FOLDS_KEY, next)
}

/** Called by the footer: the lists inside it fold, and remember it under this note. */
export function provideFooterFold(path: () => string): void {
  provide(FOOTER_FOLD, path)
}

export interface Fold {
  /** False outside a note's footer: the list shows a plain heading and never folds. */
  enabled: boolean
  collapsed: ComputedRef<boolean>
  toggle: () => void
}

export function useFooterFold(section: FooterSection): Fold {
  const path = inject(FOOTER_FOLD, null)
  if (!path) return { enabled: false, collapsed: computed(() => false), toggle: () => {} }
  const collapsed = computed(() => isFolded(current(), path(), section))
  const toggle = () => write(setFolded(current(), path(), section, !collapsed.value))
  return { enabled: true, collapsed, toggle }
}

/** A renamed or moved note keeps its folds. */
export function moveFooterFolds(oldPath: string, newPath: string): void {
  write(renameFolds(current(), oldPath, newPath))
}

/** Forgets what was read, so the next reader loads it again. For tests. */
export function resetFooterFolds(): void {
  state.value = null
}
