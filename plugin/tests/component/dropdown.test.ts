/**
 * The kit's select: Obsidian builds the element, and the component hands it what a caller says
 * about it — a label, a choice that cannot be picked, a moment it cannot be changed.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Dropdown from '@/components/obsidian/Dropdown.vue'

const options = [
  { value: 'ask', display: 'Спрашивать' },
  { value: 'auto', display: 'Автоматически' },
  { value: 'off', display: 'Выкл.', disabled: true },
]

describe('Dropdown', () => {
  it("gives a caller's label to the select and keeps its class on the field", () => {
    const view = mount(Dropdown, {
      props: { options, modelValue: 'ask' },
      attrs: { class: 'caller-place', 'aria-label': 'Режим' },
    })

    expect(view.classes()).toContain('caller-place')
    const select = view.find('select')
    expect(select.classes()).toContain('abele-obsidian-dropdown__base')
    expect(select.attributes('aria-label')).toBe('Режим')
    expect(select.classes()).not.toContain('caller-place')
  })

  it('shows a choice that cannot be picked', () => {
    const view = mount(Dropdown, { props: { options, modelValue: 'ask' } })

    const off = view.find('option[value="off"]').element as HTMLOptionElement
    expect(off.disabled).toBe(true)
  })

  it('cannot be changed while disabled, and follows the prop', async () => {
    const view = mount(Dropdown, { props: { options, modelValue: 'ask', disabled: true } })
    const select = view.find('select').element as HTMLSelectElement

    expect(select.disabled).toBe(true)
    expect(view.classes()).toContain('abele-obsidian-dropdown_disabled')
    await view.setProps({ disabled: false })
    expect(select.disabled).toBe(false)
  })
})
