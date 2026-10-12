/**
 * The row of a date property: a day back, the date that opens the plugin's own date window, a day on, how far away the
 * date is, and a button to the daily note of that day. Drawn whole by the plugin, like the
 * counter, so nothing Obsidian redraws inside the cell can take the buttons away.
 *
 * A date stays a date and a date with a time keeps its time (`dates.ts`). A date without a time
 * of its own takes one from a property beside it named like it plus `Time` — `due` and `dueTime`
 * — for the distance only; that property is never written.
 */
import { Keymap, setIcon, TFile } from 'obsidian'
import dayjs from 'dayjs'
import { openComponentDialog } from '@/modal/componentDialog'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
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
  // The date as text that opens the plugin's date window, the one a task's dates use, not the
  // system's own picker, which looks different on every platform.
  const input = row.createEl('input', {
    cls: 'metadata-input metadata-input-text mod-date abele-property-date__value',
    attr: { readonly: 'true', 'aria-haspopup': 'dialog', placeholder: 'Empty' },
  })
  const later = iconButton(row, 'abele-property-date__later', 'chevron-right', 'Next day')
  // Together, so a narrow cell wraps them onto the next line as one rather than leaving the
  // button alone there.
  const after = row.createSpan({ cls: 'abele-property-date__after' })
  const relative = after.createSpan({ cls: 'abele-property-date__relative' })
  const daily = iconButton(after, 'abele-property-date__daily', 'calendar-days', 'Open daily note')

  const show = (v: unknown) => {
    const parsed = parseDateValue(v)
    const timed = !!parsed?.time
    input.type = 'text'
    input.toggleClass('mod-datetime', timed)
    const day = parsed ? dayjs(String(v).trim().slice(0, 10)) : null
    input.value = day?.isValid()
      ? `${day.format(DISPLAY_DATE_FORMAT)}${timed ? ` ${parsed.time}` : ''}`
      : ''
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
  const pick = () => {
    const parsed = parseDateValue(current)
    const day = parsed ? dayjs(String(current).trim().slice(0, 10)) : undefined
    const dialog = openComponentDialog(
      async () => (await import('@/components/DateTimePickerModal.vue')).default,
      {
        mode: 'event',
        title: ctx.key,
        initialDate: day?.isValid() ? day : undefined,
        initialTime: parsed?.time ?? null,
        onConfirm: ({ date, time }: { date: dayjs.Dayjs; time: string | null }) => {
          const next = withDay(current, date.format('YYYY-MM-DD'), time)
          if (next !== current) write(next)
          dialog.close()
        },
        onClear: () => {
          if (!isEmpty(current)) write(null)
          dialog.close()
        },
        onCancel: () => dialog.close(),
      },
      { document: el.ownerDocument }
    )
  }
  input.addEventListener('click', pick)
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    pick()
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
