import { t } from '@/i18n'
/**
 * The row of a select property: the picked option as a label is drawn — its icon in its colour,
 * or a dot of the colour, and its name — and a field that opens the list of options under the
 * row, narrowed by what is typed. Several at once are several of those, with «Add…» after them.
 *
 * A name the list does not have stays as it is, drawn with an empty ring where the colour would
 * be; the list then offers to add it to the settings, or another option to pick instead.
 */
import { AbstractInputSuggest, setIcon, setTooltip, type App } from 'obsidian'
import './kinds.css'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  offer,
  optionOf,
  pick,
  selectValues,
  unpick,
  type SelectOption,
  type SelectProperty,
} from './select'
import type { WidgetContext } from './widgets'

/** A line of the list: an option, or the typed or unknown name to add to the list. */
type Choice = { option: SelectOption } | { add: string } | { clear: true }

/** The option's mark: its icon in its colour, a dot of the colour, or an empty ring when unknown. */
export function drawMark(host: HTMLElement, option: SelectOption | null): HTMLElement {
  const mark = host.createSpan({ cls: 'abele-property-select__mark' })
  if (!option) mark.addClass('is-unknown')
  else if (option.icon) setIcon(mark, option.icon)
  else mark.addClass('is-dot')
  if (option?.color && option.color !== 'grey')
    mark.addClass(`abele-property-select__mark_${option.color}`)
  return mark
}

class SelectSuggest extends AbstractInputSuggest<Choice> {
  shown = false

  constructor(
    app: App,
    private readonly field: HTMLInputElement,
    private readonly property: () => SelectProperty,
    private readonly held: () => unknown,
    private readonly take: (name: string) => void,
    private readonly addToList: (name: string) => void,
    private readonly clear: () => void
  ) {
    super(app, field)
  }

  protected getSuggestions(query: string): Choice[] {
    const property = this.property()
    const choices: Choice[] = offer(property, this.held(), query).map((option) => ({ option }))
    const typed = query.trim()
    const unknown = selectValues(this.held()).filter((v) => !optionOf(property, v))
    const name = typed && !optionOf(property, typed) ? typed : !typed ? unknown[0] : undefined
    // What the note holds and the list lacks comes first: it is what the row is asking about.
    if (name && !typed && !property.multiple) choices.unshift({ add: name })
    else if (name) choices.push({ add: name })
    // One option at a time has no cross on its label: emptying it is the list's last line.
    if (!property.multiple && !typed && selectValues(this.held()).length)
      choices.push({ clear: true })
    return choices
  }

  renderSuggestion(choice: Choice, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-property-select__choice')
    const icon = el.createDiv({ cls: 'suggestion-icon' })
    const content = el.createDiv({ cls: 'suggestion-content' })
    if ('clear' in choice) {
      el.addClass('is-add')
      setIcon(icon.createSpan({ cls: 'abele-property-select__mark' }), 'eraser')
      content.createDiv({ cls: 'suggestion-title', text: t('area.selectClear') })
      return
    }
    if ('add' in choice) {
      el.addClass('is-add')
      setIcon(icon.createSpan({ cls: 'abele-property-select__mark' }), 'plus')
      content.createDiv({
        cls: 'suggestion-title',
        text: t('area.selectAddToList', { value: choice.add }),
      })
      return
    }
    const { option } = choice
    drawMark(icon, option)
    content.createDiv({ cls: 'suggestion-title', text: option.value })
    if (option.description) content.createDiv({ cls: 'suggestion-note', text: option.description })
    const chosen = selectValues(this.held()).some(
      (v) => v.toLowerCase() === option.value.toLowerCase()
    )
    if (chosen)
      setIcon(el.createDiv({ cls: 'suggestion-aux' }).createSpan('suggestion-flair'), 'check')
  }

  selectSuggestion(choice: Choice): void {
    if ('clear' in choice) this.clear()
    else if ('add' in choice) {
      this.addToList(choice.add)
      this.take(choice.add)
    } else this.take(choice.option.value)
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

export function renderSelect(
  el: HTMLElement,
  value: unknown,
  ctx: WidgetContext,
  type: string,
  property: () => SelectProperty
) {
  el.empty()
  let current = value
  const row = el.createDiv({
    cls: 'multi-select-container abele-property-labels abele-property-select',
  })
  const pills = row.createDiv({ cls: 'abele-property-labels__pills' })
  const input = row.createEl('input', {
    cls: 'abele-property-labels__input abele-property-select__input',
    attr: { type: 'text' },
  })

  const write = (next: unknown) => {
    current = next
    show(next)
    ctx.onChange(next)
  }
  const take = (name: string) => write(pick(property(), current, name))
  const remove = (name: string) => write(unpick(property(), current, name))
  const addToList = (name: string) => {
    const config = AbeleConfig.getInstance()
    const key = property().key.toLowerCase()
    config.selectProperties = (config.selectProperties ?? []).map((p) =>
      p.key.toLowerCase() === key && !optionOf(p, name)
        ? { ...p, options: [...p.options, { value: name }] }
        : p
    )
    void config.saveSettings()
  }

  const show = (v: unknown) => {
    const prop = property()
    pills.empty()
    const names = selectValues(v)
    row.toggleClass('is-empty', names.length === 0)
    for (const name of names) {
      const option = optionOf(prop, name)
      const pill = pills.createDiv({
        cls: 'multi-select-pill abele-property-labels__pill abele-property-select__pill',
      })
      pill.dataset.value = name
      const content = pill.createDiv({ cls: 'multi-select-pill-content' })
      drawMark(content, option)
      content.createSpan({ cls: 'abele-property-select__name', text: name })
      if (!option) {
        pill.addClass('is-unknown')
        setTooltip(pill, t('area.selectUnknown', { key: prop.key }))
      } else if (option.description) setTooltip(pill, option.description)
      if (!prop.multiple) {
        pill.addClass('is-single')
        pill.addEventListener('click', () => input.focus())
        continue
      }
      const x = pill.createDiv({
        cls: 'multi-select-pill-remove-button',
        attr: {
          role: 'button',
          tabindex: '0',
          'aria-label': t('area.removeLabelValue', { label: name }),
        },
      })
      setIcon(x, 'x')
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        remove(name)
      })
      x.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        remove(name)
        input.focus()
      })
      pill.addEventListener('click', () => input.focus())
    }
    // One option at a time: the field only says something while nothing is picked.
    const placeholder = prop.multiple
      ? t('area.selectAdd')
      : names.length
        ? ''
        : t('area.selectEmpty')
    input.setAttribute('placeholder', placeholder)
    input.setAttribute('aria-label', t('area.selectChoose', { key: prop.key }))
    input.toggleClass('is-tucked', !prop.multiple && names.length > 0)
  }

  const suggest = new SelectSuggest(
    ctx.app,
    input,
    property,
    () => current,
    take,
    addToList,
    () => write(null)
  )
  // The list opens on entering the field, not only once something is typed. With one option at
  // a time the field takes the whole row while the list is open, the option named in it faintly,
  // so the list lines up under the row.
  input.addEventListener('focus', () => {
    if (!property().multiple) {
      row.addClass('is-picking')
      input.setAttribute('placeholder', selectValues(current)[0] ?? t('area.selectEmpty'))
    }
    suggest.open()
  })
  input.addEventListener('blur', () => {
    row.removeClass('is-picking')
    show(current)
  })
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Backspace' && !input.value) {
      const names = selectValues(current)
      if (names.length) remove(names[names.length - 1])
    } else if (e.key === 'Escape') {
      input.value = ''
      input.blur()
    }
  })
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
