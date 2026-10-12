import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RequestCard from '@/components/obsidian/RequestCard.vue'
import Button from '@/components/obsidian/Button.vue'
import Search from '@/components/obsidian/Search.vue'

describe('shared conversation patterns', () => {
  it('keeps waiting and failed cards distinct without making their body a control', async () => {
    const card = mount(RequestCard, {
      props: { waiting: true },
      slots: { default: 'Sample request' },
    })
    expect(card.classes()).toContain('abele-request-card_waiting')
    expect(card.attributes('tabindex')).toBeUndefined()
    expect(card.text()).toBe('Sample request')
    await card.setProps({ waiting: false })
    expect(card.classes()).not.toContain('abele-request-card_waiting')
    card.unmount()
  })
  it('renders a neutral row action as a semantic native icon button with no accent', async () => {
    const row = mount(Button, { props: { text: 'Sample answer', plain: true } })
    expect(row.element.tagName).toBe('BUTTON')
    expect(row.attributes('type')).toBe('button')
    expect(row.classes()).toContain('clickable-icon')
    expect(row.classes()).not.toContain('mod-cta')
    await row.trigger('click')
    expect(row.emitted('click')).toHaveLength(1)
    row.unmount()
  })
  it('keeps the action name and contextual facts together in the native tooltip label', () => {
    const row = mount(Button, {
      props: {
        text: '12:30',
        label: 'Message details',
        tooltip: 'Sample date · 20 tokens',
        plain: true,
      },
    })
    expect(row.attributes('aria-label')).toBe('Message details · Sample date · 20 tokens')
    row.unmount()
  })
  it('keeps a named search suffix updated inside the native field and can select its words', async () => {
    const field = mount(Search, {
      props: { modelValue: 'sample', suffix: '2/3', suffixLabel: 'Match 2 of 3' },
      attachTo: document.body,
    })
    const suffix = field.get('.abele-obsidian-search__suffix')
    expect(suffix.text()).toBe('2/3')
    expect(suffix.attributes('aria-label')).toBe('Match 2 of 3')
    field.vm.select()
    expect(field.get('input').element.selectionStart).toBe(0)
    expect(field.get('input').element.selectionEnd).toBe(6)
    await field.setProps({ suffix: '0', suffixLabel: 'No results' })
    expect(suffix.text()).toBe('0')
    expect(suffix.attributes('aria-label')).toBe('No results')
    field.unmount()
  })
})
