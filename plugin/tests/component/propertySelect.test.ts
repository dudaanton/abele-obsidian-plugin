import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AbstractInputSuggest, type App } from 'obsidian'
import { renderSelect } from '@/properties/selectWidget'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { SelectProperty } from '@/properties/select'
import type { WidgetContext } from '@/properties/widgets'

let host: HTMLElement
let property: SelectProperty
let app: App
beforeEach(() => {
  app = useVault([]) as unknown as App
  configureAbele()
  property = {
    key: ' Stage ',
    multiple: false,
    options: [{ value: 'Ready', description: 'Can begin', color: 'green' }, { value: 'Waiting' }],
  }
  AbeleConfig.getInstance().selectProperties = [property]
  host = document.body.createDiv()
})
afterEach(() => {
  host.remove()
  vi.restoreAllMocks()
})
function draw(value: unknown) {
  const onChange = vi.fn()
  const ctx = {
    app,
    key: 'stage',
    sourcePath: 'Sample.md',
    onChange,
    blur: vi.fn(),
  } as WidgetContext
  const widget = renderSelect(
    host,
    value,
    ctx,
    'text',
    () => AbeleConfig.getInstance().selectProperties[0]
  )
  const suggest = AbstractInputSuggest.attachedTo.get(widget.inputEl)!
  return { widget, suggest, onChange }
}
it('draws a chosen value and checked suggestions with descriptions, writes only the name', () => {
  const { suggest, onChange } = draw('Ready')
  expect(host.textContent).toContain('Ready')
  const choices = suggest.suggestionsNow()
  const row = document.createElement('div')
  suggest.renderSuggestion(choices[0], row)
  expect(row.textContent).toContain('Can begin')
  expect(row.querySelector('.suggestion-aux')).not.toBeNull()
  suggest.selectSuggestion(choices[1])
  expect(onChange).toHaveBeenCalledWith('Waiting')
  expect(suggest.closed).toBe(true)
})
it('clears through the list without changing the configured options', () => {
  const { suggest, onChange } = draw('Ready')
  suggest.selectSuggestion(suggest.suggestionsNow().at(-1)!)
  expect(onChange).toHaveBeenCalledWith(null)
  expect(property.options).toHaveLength(2)
})
it('keeps unknown text and adds it to the matching settings key', () => {
  const save = vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const { suggest, onChange } = draw('  Legacy  ')
  expect(host.querySelector('.is-unknown')).not.toBeNull()
  expect(host.querySelector('.abele-property-select__name')?.textContent).toBe('  Legacy  ')
  suggest.selectSuggestion(suggest.suggestionsNow()[0])
  expect(AbeleConfig.getInstance().selectProperties[0].options.at(-1)?.value).toBe('  Legacy  ')
  expect(save).toHaveBeenCalledOnce()
  expect(onChange).toHaveBeenCalledWith('  Legacy  ')
})
it('adds and removes multiple values without discarding unknown ones', () => {
  property.multiple = true
  const { suggest, onChange } = draw(['Legacy', 'Ready'])
  suggest.selectSuggestion(suggest.suggestionsNow()[0])
  expect(onChange).toHaveBeenLastCalledWith(['Legacy', 'Ready', 'Waiting'])
  host.querySelector<HTMLElement>('[data-value="Ready"] .multi-select-pill-remove-button')!.click()
  expect(onChange).toHaveBeenLastCalledWith(['Legacy', 'Waiting'])
})
it('offers unknown multiple values for adding to the list', () => {
  property.multiple = true
  const { suggest } = draw(['Legacy', 'Ready'])
  const choices = suggest.suggestionsNow()
  const rows = choices.map((choice) => {
    const row = document.createElement('div')
    suggest.renderSuggestion(choice, row)
    return row.textContent
  })
  expect(rows.some((text) => text?.includes('Add “Legacy”'))).toBe(true)
})
it('allows keyboard removal of a multiple value', () => {
  property.multiple = true
  const { onChange } = draw(['Legacy', 'Ready'])
  const remove = host.querySelector<HTMLElement>(
    '[data-value="Ready"] .multi-select-pill-remove-button'
  )!
  expect(remove.tabIndex).toBe(0)
  remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(onChange).toHaveBeenLastCalledWith(['Legacy'])
})
it('external setValue redraws without writing and Escape does not clear a value', () => {
  const { widget, onChange } = draw('Ready')
  widget.setValue('Legacy')
  widget.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(host.textContent).toContain('Legacy')
  expect(onChange).not.toHaveBeenCalled()
})
