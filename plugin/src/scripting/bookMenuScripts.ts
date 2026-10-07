/** Compatible book adapters over the source-independent selection-menu resolver. */
import type { ParsedScript } from './types'
import {
  selectionMenu,
  selectionMenuPlace,
  type SelectionMenuScript,
  type SelectionMenuItem,
} from './selectionMenuScripts'

export type BookMenuScript = SelectionMenuScript
export type BookMenuItem = SelectionMenuItem

/** Up to this many scripts have a button each; more fold into one menu. */
export const BOOK_BAR_BUTTONS = 3

export {
  SELECTION_SCRIPT_ICON as BOOK_SCRIPT_ICON,
  selectionMenuScriptsFrom as bookMenuScriptsFrom,
  withSelectionScript as withBookScript,
  withoutSelectionScript as withoutBookScript,
  movedSelectionScript as movedBookScript,
} from './selectionMenuScripts'

export function bookMenu(all: ParsedScript[], chosen: BookMenuScript[]): BookMenuItem[] {
  return selectionMenu(all, chosen, 'book')
}

export function bookMenuPlace(
  script: ParsedScript,
  chosen: BookMenuScript[]
): 'setting' | 'header' | null {
  return selectionMenuPlace(script, chosen, 'book')
}
