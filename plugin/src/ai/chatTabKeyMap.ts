import { t } from '@/i18n'
/**
 * Which key does what in the chat's tabs, and how a key is written — no service, no scope, so
 * the tab strip can name its keys without loading the chat. `chatTabKeys.ts` puts them to work.
 */
import { Platform, type Modifier } from 'obsidian'

export interface ChatTabKey {
  modifiers: Modifier[]
  key: string
}

export type ChatTabAction = 'close' | 'create' | 'reopen' | 'previous' | 'next'

/**
 * Each action and its keys, the first being the one named in tooltips. Several for switching,
 * because each family of programs has its own: Cmd+Alt+arrows and Cmd+Shift+brackets in a
 * Mac browser, Ctrl+Tab everywhere, Ctrl+PageUp/PageDown in Chrome and editors elsewhere.
 * Only Mod+Alt is taken with the arrows: Alt+arrows alone still move by word in the composer.
 */
export const CHAT_TAB_KEYS: Record<ChatTabAction, ChatTabKey[]> = {
  close: [{ modifiers: ['Mod'], key: 'w' }],
  create: [{ modifiers: ['Mod'], key: 't' }],
  reopen: [{ modifiers: ['Mod', 'Shift'], key: 't' }],
  previous: [
    { modifiers: ['Mod', 'Alt'], key: 'ArrowLeft' },
    { modifiers: ['Ctrl', 'Shift'], key: 'Tab' },
    { modifiers: ['Mod', 'Shift'], key: '[' },
    { modifiers: ['Ctrl'], key: 'PageUp' },
  ],
  next: [
    { modifiers: ['Mod', 'Alt'], key: 'ArrowRight' },
    { modifiers: ['Ctrl'], key: 'Tab' },
    { modifiers: ['Mod', 'Shift'], key: ']' },
    { modifiers: ['Ctrl'], key: 'PageDown' },
  ],
}

/** The tab `step` places along from the active one, round the ends as a browser goes. */
export function tabAlong(
  order: readonly string[],
  active: string | null,
  step: number
): string | null {
  if (order.length === 0) return null
  const at = active ? order.indexOf(active) : -1
  if (at < 0) return order[0]
  return order[(((at + step) % order.length) + order.length) % order.length]
}

/** The tab Mod+`n` goes to: the `n`th from the left, and 9 is always the last. */
export function tabAt(order: readonly string[], n: number): string | null {
  if (n === 9) return order.at(-1) ?? null
  return order[n - 1] ?? null
}

const keyNames = (): Record<string, [mac: string, other: string]> => ({
  ArrowLeft: ['←', t('streamBRest.keyLeft')],
  ArrowRight: ['→', t('streamBRest.keyRight')],
  PageUp: ['⇞', t('streamBRest.keyPageUp')],
  PageDown: ['⇟', t('streamBRest.keyPageDown')],
})

/** A key as the platform writes it: ⌥⌘← on a Mac (and an iPad), Ctrl+Alt+Left elsewhere. */
export function keyLabel({ modifiers, key }: ChatTabKey, mac = Platform.isMacOS): string {
  const name = keyNames()[key]?.[mac ? 0 : 1] ?? (key.length === 1 ? key.toUpperCase() : key)
  if (mac) {
    // In the order a Mac menu writes them.
    const glyphs: [Modifier, string][] = [
      ['Ctrl', '⌃'],
      ['Alt', '⌥'],
      ['Shift', '⇧'],
      ['Mod', '⌘'],
      ['Meta', '⌘'],
    ]
    return (
      glyphs
        .filter(([m]) => modifiers.includes(m))
        .map(([, g]) => g)
        .join('') + name
    )
  }
  const words: [Modifier, string][] = [
    ['Mod', 'Ctrl'],
    ['Ctrl', 'Ctrl'],
    ['Meta', 'Win'],
    ['Alt', 'Alt'],
    ['Shift', 'Shift'],
  ]
  const named = [...new Set(words.filter(([m]) => modifiers.includes(m)).map(([, w]) => w))]
  return [...named, name].join('+')
}

/** «Close tab (⌘W)»: a control's name with the first of its keys. */
export function withShortcut(name: string, action: ChatTabAction): string {
  return `${name} (${keyLabel(CHAT_TAB_KEYS[action][0])})`
}

/** The stop control's name with its key: «Stop (⌃C)» on a Mac, «Stop (Ctrl+C)» elsewhere. */
export function stopTooltip(mac = Platform.isMacOS): string {
  return `${t('streamB.stop.cae7d5')} (${keyLabel({ modifiers: ['Ctrl'], key: 'c' }, mac)})`
}
