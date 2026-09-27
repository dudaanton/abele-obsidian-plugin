/**
 * The row of a counter property: − , the number, + — Obsidian's own icon buttons around its own
 * number field. Drawn whole by the plugin rather than beside the stock field, so nothing Obsidian
 * redraws inside the cell can take the buttons away again.
 *
 * The field takes a number typed by hand, or a sum (`helpers/calculator`), on Enter or on leaving
 * it; emptied, the property is empty. What is not a number puts back what was there.
 */
import { setIcon } from 'obsidian'
import './counter.css'
import { evaluateAmount } from '@/helpers/calculator'
import { counterValue, stepCounter } from './counter'
import type { WidgetContext } from './widgets'

const isEmpty = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '')

export function renderCounter(el: HTMLElement, value: unknown, ctx: WidgetContext, type: string) {
  el.empty()
  let current = value
  const row = el.createDiv({ cls: 'abele-property-counter' })
  const button = (name: 'decrease' | 'increase', icon: string, label: string) => {
    const b = row.createEl('button', {
      cls: `clickable-icon abele-property-counter__${name}`,
      attr: { type: 'button', 'aria-label': label },
    })
    setIcon(b, icon)
    return b
  }
  const minus = button('decrease', 'minus', 'Decrease')
  const input = row.createEl('input', {
    cls: 'metadata-input metadata-input-number abele-property-counter__value',
    type: 'text',
    attr: { placeholder: 'Empty' },
  })
  const plus = button('increase', 'plus', 'Increase')

  const show = (v: unknown) => {
    const n = counterValue(v)
    input.value = isEmpty(v) || n === null ? '' : String(n)
  }
  const write = (next: number | null) => {
    current = next
    show(next)
    ctx.onChange(next)
  }
  const step = (delta: number) => {
    const next = stepCounter(current, delta)
    if (next !== null) write(next)
  }
  const settle = () => {
    const text = input.value.trim()
    if (!text) {
      if (!isEmpty(current)) write(null)
      return
    }
    const n = Number.isFinite(Number(text)) ? Number(text) : evaluateAmount(text)
    if (n === null) show(current)
    else if (n === current) show(current)
    else write(n)
  }

  minus.addEventListener('click', () => step(-1))
  plus.addEventListener('click', () => step(1))
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      settle()
      input.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      show(current)
      input.blur()
    }
  })
  input.addEventListener('blur', settle)
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
