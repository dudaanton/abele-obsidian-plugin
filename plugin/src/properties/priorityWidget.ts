/**
 * The row of a priority property: lower, the level drawn as three bars in the colour tasks mark
 * it with and its name, raise. Drawn whole by the plugin, like the counter.
 */
import './kinds.css'
import { TASK_PRIORITIES } from '@/helpers/taskMeta'
import { iconButton } from './dateWidget'
import { PRIORITY_COLORS, priorityAt, priorityLevel, priorityName, stepPriority } from './priority'
import type { WidgetContext } from './widgets'

export function renderPriority(el: HTMLElement, value: unknown, ctx: WidgetContext, type: string) {
  el.empty()
  let current = value
  const row = el.createDiv({ cls: 'abele-property-priority' })
  const lower = iconButton(row, 'abele-property-priority__lower', 'chevron-down', 'Lower priority')
  const level = row.createDiv({ cls: 'abele-property-priority__level' })
  const bars = level.createDiv({ cls: 'abele-property-priority__bars' })
  const barEls = TASK_PRIORITIES.map(() => bars.createSpan({ cls: 'abele-property-priority__bar' }))
  const name = level.createSpan({ cls: 'abele-property-priority__name' })
  const raise = iconButton(row, 'abele-property-priority__raise', 'chevron-up', 'Raise priority')

  const show = (v: unknown) => {
    const n = priorityLevel(v) ?? 0
    const priority = priorityAt(n)
    row.dataset.priority = priority ?? 'none'
    for (const color of Object.values(PRIORITY_COLORS))
      level.toggleClass(`abele-property-priority_${color}`, false)
    if (priority) level.addClass(`abele-property-priority_${PRIORITY_COLORS[priority]}`)
    barEls.forEach((bar, i) => bar.toggleClass('is-on', i < n))
    name.setText(priorityName(n))
    name.toggleClass('is-empty', n === 0)
    lower.toggleClass('is-disabled', n === 0)
    raise.toggleClass('is-disabled', n === TASK_PRIORITIES.length)
    level.setAttribute('aria-label', `Priority: ${priorityName(n)}`)
  }
  const step = (delta: number) => {
    const next = stepPriority(current, delta)
    if (next === undefined) return
    current = next
    show(next)
    ctx.onChange(next)
  }

  lower.addEventListener('click', () => step(-1))
  raise.addEventListener('click', () => step(1))
  show(current)

  return {
    containerEl: el,
    type,
    focus: () => raise.focus(),
    onFocus: () => raise.focus(),
    setValue: (next: unknown) => {
      current = next
      show(next)
    },
  }
}
