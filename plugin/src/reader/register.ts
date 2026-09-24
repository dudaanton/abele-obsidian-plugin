/**
 * The book reader's hooks into Obsidian: the tab type, and `.epub` files opening in it.
 *
 * Another plugin may already have claimed `.epub`; Obsidian then refuses a second claim, and the
 * books keep opening where they did before rather than the plugin failing to load.
 */
import type { Plugin } from 'obsidian'
import { BOOK_EXTENSIONS, BOOK_VIEW_TYPE, BookView } from './BookView'

export function registerReader(plugin: Plugin): void {
  plugin.registerView(BOOK_VIEW_TYPE, (leaf) => new BookView(leaf))
  try {
    plugin.registerExtensions(BOOK_EXTENSIONS, BOOK_VIEW_TYPE)
  } catch (e) {
    console.warn('[Abele] .epub is already handled by another plugin; the book reader stays off', e)
  }
}
