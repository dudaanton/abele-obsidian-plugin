/**
 * The plugin's own drawing of some properties in Obsidian's Properties panel.
 *
 * Obsidian has no public API for this. What it has inside is one table of property types,
 * `app.metadataTypeManager.registeredTypeWidgets`, each type an object whose `render(el, value,
 * ctx)` draws one value; the panel looks `render` up every time it draws a row, and redraws a row
 * whenever the note changes. So the least there is to do is swap `render` on the few types this
 * touches, keep the originals, and put them back — when the setting is switched off and when the
 * plugin unloads. Nothing about the note changes: values stay plain frontmatter, and a device
 * without the plugin draws them the stock way.
 *
 * - `number`: the field takes arithmetic, `120+35*2`, and keeps the answer (`helpers/calculator`).
 * - `text`: a link to a wallet gets the wallet's balance beside it; the `cover` property is a card.
 * - `file` (Obsidian's own, hidden from the type menu until now): a card for the file.
 * - `files` (added here): a list of those cards. Registered for as long as the plugin runs, so a
 *   property of that type never turns "unknown" here; with the setting off it draws as a list.
 *
 * Every patch is guarded. When the table is not there or not the shape it was in 1.13, nothing
 * is patched; when a patched render throws, the stock one draws the row instead.
 */
import { createApp, h, reactive, watch, type App as VueApp } from 'vue'
import type { App } from 'obsidian'
import PropertyFiles from '@/components/properties/PropertyFiles.vue'
import { evaluateAmount } from '@/helpers/calculator'
import { GlobalStore } from '@/stores/GlobalStore'
import { fileEntries, isCoverKey } from './values'
import { walletBalance, type WalletSource } from './wallet'

export interface WidgetContext {
  app: App
  key: string
  sourcePath: string
  onChange(value: unknown): void
  blur(): void
}

type Render = (el: HTMLElement, value: unknown, ctx: WidgetContext) => unknown

export interface TypeWidget {
  type: string
  name: () => string
  icon: string
  validate(value: unknown): boolean
  render: Render
  reservedKeys?: string[]
}

type Registry = Record<string, TypeWidget | undefined>

export const FILES_TYPE = 'files'

/** The table of property types, or null when this Obsidian keeps it somewhere else. */
export function typeRegistry(app: App): Registry | null {
  const manager = (app as unknown as { metadataTypeManager?: { registeredTypeWidgets?: unknown } })
    .metadataTypeManager
  const table = manager?.registeredTypeWidgets
  return table && typeof table === 'object' ? (table as Registry) : null
}

const log = (...args: unknown[]) => console.debug('[Abele] property widgets:', ...args)

/**
 * Vue apps drawn into property rows, by the row's value cell. A cell drawn again unmounts what
 * it held; a row taken off the page is swept a little later. Not at once: the panel draws a new
 * row before putting it on the page, so a row not yet on the page is not a row that has gone.
 */
const mounted = new Map<HTMLElement, VueApp>()
let sweepTimer: number | null = null

function sweep(all = false): void {
  sweepBadges(all)
  for (const [cell, vue] of mounted) {
    if (all || !cell.isConnected) {
      vue.unmount()
      mounted.delete(cell)
    }
  }
}

function sweepSoon(): void {
  if (sweepTimer !== null) window.clearTimeout(sweepTimer)
  sweepTimer = window.setTimeout(() => {
    sweepTimer = null
    sweep()
  }, 5000)
}

function stopSweeping(): void {
  if (sweepTimer !== null) window.clearTimeout(sweepTimer)
  sweepTimer = null
  sweep(true)
}

/** A row drawn with the file cards; returns the widget object the panel keeps for it. */
function renderFiles(
  el: HTMLElement,
  value: unknown,
  ctx: WidgetContext,
  opts: { multiple: boolean; imagesOnly?: boolean; type: string }
) {
  mounted.get(el)?.unmount()
  mounted.delete(el)
  el.empty()
  const host = el.createDiv({ cls: 'abele-property-widget' })
  const state = reactive({ entries: fileEntries(value) })
  const vue = createApp({
    render: () =>
      h(PropertyFiles, {
        entries: state.entries,
        sourcePath: ctx.sourcePath,
        multiple: opts.multiple,
        imagesOnly: opts.imagesOnly,
        onChange: (entries: string[]) => {
          state.entries = entries
          ctx.onChange(opts.multiple ? entries : (entries[0] ?? null))
        },
      }),
  })
  vue.mount(host)
  mounted.set(el, vue)
  sweepSoon()
  return {
    containerEl: el,
    type: opts.type,
    focus: () => host.querySelector<HTMLElement>('.abele-card, button')?.focus(),
    onFocus: () => host.querySelector<HTMLElement>('.abele-card, button')?.focus(),
    setValue: (next: unknown) => {
      state.entries = fileEntries(next)
    },
  }
}

/**
 * The number field as a calculator. The stock field is `type=number`, which does not even let
 * the page read `120+35` back; as text it does, and the sum is worked out before the stock
 * handlers read the field on Enter or on leaving it — so they store the answer, as if it had
 * been typed.
 */
function renderNumber(original: Render, el: HTMLElement, value: unknown, ctx: WidgetContext) {
  const widget = original(el, value, ctx)
  const input = el.querySelector<HTMLInputElement>('input.metadata-input-number')
  if (!input) return widget
  input.type = 'text'
  // A phone's decimal pad has no + or ×: the ordinary keyboard does.
  input.removeAttribute('inputmode')
  input.addClass('abele-number-calculator')
  const settle = () => {
    const text = input.value.trim()
    if (!text || Number.isFinite(Number(text))) return
    const result = evaluateAmount(text)
    if (result !== null) input.value = String(result)
  }
  // Capturing on the row runs before the listeners Obsidian put on the field itself.
  el.addEventListener(
    'keydown',
    (e) => {
      if (e.target === input && e.key === 'Enter' && !e.isComposing) settle()
    },
    true
  )
  el.addEventListener('blur', (e) => e.target === input && settle(), true)
  return widget
}

/**
 * The wallets' balances on screen, one per text row, by the row's value cell.
 *
 * Obsidian's text field draws its cell again by itself — clicked into to edit, left, given a
 * new value — emptying it each time, without asking the type to draw the row again. So a badge
 * put in the cell once is gone after the first edit. Each row keeps an eye on its cell instead
 * and puts the badge back after the field has drawn itself, for the value the field holds now.
 * Rows drawn before the finance index was there get theirs when it arrives.
 */
interface Badge {
  cell: HTMLElement
  widget: unknown
  value: unknown
  /** The panel keeps it for the row and changes its note in place when another note opens. */
  ctx: WidgetContext
  el: HTMLElement | null
  observer: MutationObserver | null
}
const badges = new Map<HTMLElement, Badge>()
let stopBadges: (() => void) | null = null

function walletSource(): WalletSource | null {
  const store = GlobalStore.getInstance()
  const accounts = store.accountsList.value
  const index = store.balanceIndex.value
  if (!accounts || !index) return null
  return {
    resolve: (linkpath, from) =>
      store.app.metadataCache.getFirstLinkpathDest(linkpath, from)?.path ?? null,
    account: (path) => accounts.accounts.get(path) ?? null,
    balance: (path, date) => index.getBalanceAtDate(path, date),
  }
}

/** What the field holds now: Obsidian's keeps it on the object it returned from `render`. */
function badgeValue(badge: Badge): unknown {
  const widget = badge.widget as { value?: unknown } | null
  return widget && typeof widget === 'object' && 'value' in widget ? widget.value : badge.value
}

/**
 * The note the row belongs to now. A tab that opens another note keeps a row whose value is the
 * same as it was, and leaves the row's context naming the note it was drawn for; the tab itself
 * knows. Outside a tab — a hover preview — the context is all there is.
 */
function rowSourcePath(badge: Badge): string {
  let path: string | null = null
  try {
    GlobalStore.getInstance().app.workspace?.iterateAllLeaves((leaf) => {
      const view = leaf.view as { containerEl?: HTMLElement; file?: { path: string } | null }
      if (!path && view?.file && view.containerEl?.contains(badge.cell)) path = view.file.path
    })
  } catch (err) {
    log('could not tell which note a row belongs to', err)
  }
  return path ?? badge.ctx.sourcePath
}

function drawBadge(badge: Badge): void {
  const value = badgeValue(badge)
  const source = walletSource()
  const balance = source ? walletBalance(value, rowSourcePath(badge), source) : null
  // While the field is being typed into there is no link to stand beside.
  const editing = !!badge.cell.querySelector('.metadata-input-longtext')
  if (!balance && !badge.el) return
  if (!badge.el) badge.el = badge.cell.createSpan({ cls: 'abele-badge abele-property-balance' })
  if (badge.el.parentElement !== badge.cell) badge.cell.appendChild(badge.el)
  badge.el.toggleClass('abele-badge_color-red', !!balance?.negative)
  badge.el.setText(balance?.text ?? '')
  badge.el.toggle(!!balance && !editing)
}

function forgetBadge(cell: HTMLElement): void {
  const badge = badges.get(cell)
  if (!badge) return
  badge.observer?.disconnect()
  badges.delete(cell)
}

function sweepBadges(all = false): void {
  for (const cell of [...badges.keys()]) if (all || !cell.isConnected) forgetBadge(cell)
}

function drawBadges(): void {
  for (const badge of badges.values()) drawBadge(badge)
}

function watchBadges(): void {
  if (stopBadges) return
  const store = GlobalStore.getInstance()
  const stopIndex = watch(
    () => [store.balanceIndex.value?.version, store.accountsList.value?.accounts.size],
    drawBadges
  )
  // Another note opened in a tab: a row holding the same link now stands for another note, and
  // a wallet of that name beside it is another wallet. Drawn once the tab has shown the note.
  const workspace = store.app.workspace
  const opened = workspace?.on('file-open', () => window.setTimeout(drawBadges, 0))
  stopBadges = () => {
    stopIndex()
    if (opened) workspace.offref(opened)
  }
}

function addBadge(el: HTMLElement, widget: unknown, value: unknown, ctx: WidgetContext): void {
  forgetBadge(el)
  const badge: Badge = {
    cell: el,
    widget,
    value,
    ctx,
    el: null,
    observer: null,
  }
  badges.set(el, badge)
  if (!walletSource()) log('finance is not loaded yet; the balance waits for it', ctx.key)
  drawBadge(badge)
  if (typeof MutationObserver !== 'undefined') {
    badge.observer = new MutationObserver(() => {
      if (badges.get(el) === badge) drawBadge(badge)
    })
    badge.observer.observe(el, { childList: true })
  }
  watchBadges()
  sweepSoon()
}

function renderText(original: Render, el: HTMLElement, value: unknown, ctx: WidgetContext) {
  if (isCoverKey(ctx.key) && (value == null || typeof value === 'string'))
    return renderFiles(el, value, ctx, { multiple: false, imagesOnly: true, type: 'text' })
  forgetBadge(el)
  const widget = original(el, value, ctx)
  // Any text row: one holding no link now may be given one by hand.
  if (value == null || typeof value === 'string') addBadge(el, widget, value, ctx)
  return widget
}

/**
 * Keeps the originals and puts them back. `apply(true)` patches, `apply(false)` restores, and
 * `destroy` restores and takes the `files` type out again.
 */
export class PropertyWidgets {
  private readonly restores: (() => void)[] = []
  private filesWidget: TypeWidget | null = null
  private on = false

  constructor(private readonly app: App) {}

  /** Registers the `files` type. False when this Obsidian has no table to register it in. */
  load(): boolean {
    const table = typeRegistry(this.app)
    if (!table?.multitext || typeof table.multitext.render !== 'function') {
      log('no property type table in this version of Obsidian; stock rendering stays')
      return false
    }
    if (table[FILES_TYPE]) return true
    const list = table.multitext
    const widget: TypeWidget = {
      type: FILES_TYPE,
      name: () => 'Files',
      icon: 'lucide-files',
      validate: (value) =>
        typeof value === 'string' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string')),
      render: (el, value, ctx) => {
        if (this.on) {
          try {
            return renderFiles(el, value, ctx, { multiple: true, type: FILES_TYPE })
          } catch (err) {
            log('files row fell back to the list', err)
            el.empty()
          }
        }
        return list.render(el, value, ctx)
      },
    }
    table[FILES_TYPE] = widget
    this.filesWidget = widget
    return true
  }

  apply(on: boolean): void {
    if (on === this.on) return
    if (!on) {
      this.restore()
      return
    }
    const table = typeRegistry(this.app)
    if (!table) return
    this.on = true
    this.patch(table, 'number', renderNumber)
    this.patch(table, 'text', renderText)
    this.patch(table, 'file', (_original, el, value, ctx) =>
      renderFiles(el, value, ctx, { multiple: false, type: 'file' })
    )
    // Obsidian's own File type is left out of the type menu by an empty `reservedKeys`: offering
    // it is what lets a property be made a File by hand.
    const file = table.file
    if (file && Array.isArray(file.reservedKeys) && file.reservedKeys.length === 0) {
      const reserved = file.reservedKeys
      delete file.reservedKeys
      this.restores.push(() => {
        file.reservedKeys = reserved
      })
    }
  }

  get active(): boolean {
    return this.on
  }

  destroy(): void {
    this.restore()
    const table = typeRegistry(this.app)
    if (table && this.filesWidget && table[FILES_TYPE] === this.filesWidget) {
      delete table[FILES_TYPE]
    }
    this.filesWidget = null
    stopSweeping()
  }

  private restore(): void {
    this.on = false
    while (this.restores.length) this.restores.pop()?.()
    stopBadges?.()
    stopBadges = null
    sweepBadges(true)
  }

  private patch(
    table: Registry,
    type: string,
    draw: (original: Render, el: HTMLElement, value: unknown, ctx: WidgetContext) => unknown
  ): void {
    const widget = table[type]
    if (!widget || typeof widget.render !== 'function') {
      log(`no ${type} type to draw`)
      return
    }
    const original = widget.render
    const patched: Render = function (this: unknown, el, value, ctx) {
      const stock: Render = (e, v, c) => original.call(this, e, v, c)
      try {
        return draw(stock, el, value, ctx)
      } catch (err) {
        log(`${type} row fell back to the stock one`, err)
        el.empty()
        return stock(el, value, ctx)
      }
    }
    widget.render = patched
    this.restores.push(() => {
      if (widget.render === patched) widget.render = original
    })
  }
}

/**
 * Draws every Properties panel on screen again, so a switch of the setting shows at once.
 *
 * A panel redraws a row, whatever its value, when it hears that the row's property changed
 * type: that is the manager's `changed` event, which every panel — a note's, reading view's, the
 * file properties sidebar — listens to. Told only for the properties on screen, found in the
 * leaves' own elements so a pop-out window counts too; with nothing open it costs nothing.
 */
export function redrawProperties(app: App): void {
  const manager = (
    app as unknown as { metadataTypeManager?: { trigger?: (name: string, key: string) => void } }
  ).metadataTypeManager
  if (!manager?.trigger) return
  const keys = new Set<string>()
  try {
    app.workspace.iterateAllLeaves((leaf) => {
      const rows = leaf.view?.containerEl?.querySelectorAll<HTMLElement>(
        '.metadata-property[data-property-key]'
      )
      for (const row of Array.from(rows ?? [])) {
        const key = row.dataset.propertyKey
        if (key) keys.add(key.toLowerCase())
      }
    })
    for (const key of keys) manager.trigger('changed', key)
  } catch (err) {
    log('could not redraw the properties on screen', err)
  }
}
