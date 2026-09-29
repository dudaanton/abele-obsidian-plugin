/**
 * The row of a labels property: Obsidian's own pills, each with its ×, tinted with the colour the
 * label has in the task settings, and a field that adds one more — picked from the labels the
 * vault already uses under this property, or typed fresh. Drawn whole by the plugin, like the
 * counter. Backspace in the empty field takes the last label off.
 */
import { AbstractInputSuggest, setIcon, type App } from 'obsidian'
import './kinds.css'
import { labelColor } from '@/helpers/taskMeta'
import { AbeleConfig } from '@/services/AbeleConfig'
import { addLabel, collectLabels, labelsOf, removeLabel, suggestLabels } from './labels'
import type { WidgetContext } from './widgets'

/**
 * The labels the vault uses under `key`, most used first. Read once each time the field is
 * entered and kept while it is typed into, rather than walking the vault on every key.
 */
let known: { key: string; at: number; labels: string[] } | null = null

function vaultLabels(app: App, key: string): string[] {
  const want = key.toLowerCase()
  if (known && known.key === want && Date.now() - known.at < 5000) return known.labels
  const values: unknown[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    if (!fm) continue
    for (const k in fm) if (k.toLowerCase() === want) values.push(fm[k])
  }
  known = { key: want, at: Date.now(), labels: collectLabels(values) }
  return known.labels
}

/** A line of the list: a label the vault has, or the typed text as a new one. */
interface Choice {
  label: string
  fresh: boolean
}

class LabelSuggest extends AbstractInputSuggest<Choice> {
  shown = false

  constructor(
    app: App,
    private readonly field: HTMLInputElement,
    private readonly key: string,
    private readonly held: () => string[],
    private readonly take: (label: string) => void
  ) {
    super(app, field)
  }

  protected getSuggestions(query: string): Choice[] {
    const held = this.held()
    const choices: Choice[] = suggestLabels(vaultLabels(this.app, this.key), held, query)
      .slice(0, 50)
      .map((label) => ({ label, fresh: false }))
    const typed = query.trim().replace(/^#+/, '').trim()
    const lower = typed.toLowerCase()
    const known = (l: string) => l.toLowerCase() === lower
    if (typed && !choices.some((c) => known(c.label)) && !held.some(known))
      choices.push({ label: typed, fresh: true })
    return choices
  }

  renderSuggestion(choice: Choice, el: HTMLElement): void {
    el.addClass('abele-property-labels__choice')
    el.setText(choice.fresh ? `Add “${choice.label}”` : choice.label)
  }

  selectSuggestion(choice: Choice): void {
    this.take(choice.label)
    this.field.value = ''
    this.close()
  }

  open(): void {
    this.shown = true
    super.open()
  }

  close(): void {
    this.shown = false
    super.close()
  }
}

export function renderLabels(el: HTMLElement, value: unknown, ctx: WidgetContext, type: string) {
  el.empty()
  let current = value
  const row = el.createDiv({ cls: 'multi-select-container abele-property-labels' })
  const pills = row.createDiv({ cls: 'abele-property-labels__pills' })
  const input = row.createEl('input', {
    cls: 'abele-property-labels__input',
    attr: { type: 'text', placeholder: 'Add label', 'aria-label': 'Add label' },
  })

  const write = (next: unknown[] | null) => {
    current = next
    show(next)
    ctx.onChange(next)
  }
  const add = (label: string) => {
    const next = addLabel(current, label)
    if (next) write(next)
  }
  const remove = (label: string) => write(removeLabel(current, label))

  const show = (v: unknown) => {
    pills.empty()
    const colors = AbeleConfig.getInstance().taskLabelColors
    for (const label of labelsOf(v)) {
      const pill = pills.createDiv({ cls: 'multi-select-pill abele-property-labels__pill' })
      const color = labelColor(label, colors)
      if (color !== 'grey') pill.addClass('is-tinted', `abele-property-labels__pill_${color}`)
      pill.dataset.label = label
      pill.createDiv({ cls: 'multi-select-pill-content', text: label })
      const x = pill.createDiv({
        cls: 'multi-select-pill-remove-button',
        attr: { role: 'button', 'aria-label': `Remove ${label}` },
      })
      setIcon(x, 'x')
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        remove(label)
      })
    }
  }

  // Entered again: what the vault holds may have changed since the last read.
  input.addEventListener('focus', () => (known = null), true)
  const suggest = new LabelSuggest(ctx.app, input, ctx.key, () => labelsOf(current), add)
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter' && !suggest.shown) {
      e.preventDefault()
      const text = input.value
      input.value = ''
      add(text)
    } else if (e.key === 'Backspace' && !input.value) {
      const labels = labelsOf(current)
      if (labels.length) remove(labels[labels.length - 1])
    } else if (e.key === 'Escape') {
      input.value = ''
      input.blur()
    }
  })
  // A click on the row, between the pills, is a click into the field.
  row.addEventListener('click', (e) => {
    if (e.target === row || e.target === pills) input.focus()
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
