/**
 * The row of a date property: a day back, Obsidian's own date field, a day on, how far away the
 * date is, and a button to the daily note of that day. Drawn whole by the plugin, like the
 * counter, so nothing Obsidian redraws inside the cell can take the buttons away.
 *
 * A date stays a date and a date with a time keeps its time (`dates.ts`). A date without a time
 * of its own takes one from a property beside it named like it plus `Time` — `due` and `dueTime`
 * — for the distance only; that property is never written.
 */
import { Keymap, setIcon, TFile } from 'obsidian'
import './kinds.css'
import { formatDay, parseDateValue, relativeTime, stepDate, timeOf, withDay } from './dates'
import { openDailyNote } from './dailyNote'
import type { WidgetContext } from './widgets'

const isEmpty = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '')

/** The time kept beside the date, as tasks keep `dueTime` beside `due`. */
function siblingTime(ctx: WidgetContext): string | null {
  try {
    const file = ctx.app.vault.getAbstractFileByPath(ctx.sourcePath)
    const fm = file instanceof TFile ? ctx.app.metadataCache.getFileCache(file)?.frontmatter : null
    if (!fm) return null
    const want = `${ctx.key}time`.toLowerCase()
    const key = Object.keys(fm).find((k) => k.toLowerCase() === want)
    return key ? timeOf(fm[key]) : null
  } catch {
    return null
  }
}

export function iconButton(parent: HTMLElement, cls: string, icon: string, label: string) {
  const b = parent.createEl('button', {
    cls: `clickable-icon ${cls}`,
    attr: { type: 'button', 'aria-label': label },
  })
  setIcon(b, icon)
  return b
}

export function renderDate(el: HTMLElement, value: unknown, ctx: WidgetContext, type: string) {
  el.empty()
  let current = value
  const row = el.createDiv({ cls: 'abele-property-date' })
  const earlier = iconButton(row, 'abele-property-date__earlier', 'chevron-left', 'Previous day')
  const input = row.createEl('input', {
    cls: 'metadata-input metadata-input-text mod-date abele-property-date__value',
  })
  const later = iconButton(row, 'abele-property-date__later', 'chevron-right', 'Next day')
  const relative = row.createSpan({ cls: 'abele-property-date__relative' })
  const daily = iconButton(row, 'abele-property-date__daily', 'calendar-days', 'Open daily note')

  const show = (v: unknown) => {
    const parsed = parseDateValue(v)
    const timed = !!parsed?.time
    input.type = timed ? 'datetime-local' : 'date'
    input.toggleClass('mod-datetime', timed)
    input.value = parsed ? `${String(v).trim().slice(0, 10)}${timed ? `T${parsed.time}` : ''}` : ''
    const text = relativeTime(v, new Date(), siblingTime(ctx))
    relative.setText(text ?? '')
    relative.toggle(!!text)
    relative.toggleClass('is-past', !!text && (text.endsWith(' ago') || text === 'yesterday'))
  }
  const write = (next: string | null) => {
    current = next
    show(next)
    ctx.onChange(next)
  }
  const step = (days: number) => {
    const next = stepDate(current, days)
    if (next !== null) write(next)
  }

  earlier.addEventListener('click', () => step(-1))
  later.addEventListener('click', () => step(1))
  input.addEventListener('change', () => {
    const picked = input.value.trim()
    if (!picked) {
      if (!isEmpty(current)) write(null)
      return
    }
    const [day, time] = picked.split('T')
    const next = withDay(current, day, time ?? null)
    if (next !== current) write(next)
  })
  daily.addEventListener('click', (e) => {
    const parsed = parseDateValue(current)
    const day = parsed ? String(current).trim().slice(0, 10) : formatDay(new Date())
    void openDailyNote(ctx.app, day, Keymap.isModEvent(e))
  })
  show(current)

  return {
    containerEl: el,
    type,
    inputEl: input,
    focus: () => input.focus(),
    onFocus: () => input.focus(),
    setValue: (next: unknown) => {
      current = next
      show(next)
    },
  }
}
