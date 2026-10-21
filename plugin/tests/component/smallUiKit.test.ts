import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Progress from '@/components/obsidian/Progress.vue'
import Section from '@/components/obsidian/Section.vue'

it('keeps section explanations in a heading tooltip and updates them', async () => {
  const view = mount(Section, { props: { title: 'Sample', tooltip: 'Sample explanation' } })
  expect(view.get('h3').attributes('aria-label')).toBe('Sample explanation')
  await view.setProps({ tooltip: 'Changed explanation' })
  expect(view.get('h3').attributes('aria-label')).toBe('Changed explanation')
  view.unmount()
})

describe('shared progress', () => {
  it.each([0, 25, 100])('exposes a named native progress value of %s', (value) => {
    const view = mount(Progress, { props: { label: 'Sample import', value } })
    const bar = view.get('progress')
    expect(bar.attributes('aria-label')).toBe('Sample import')
    expect(bar.attributes('value')).toBe(String(value))
    expect(bar.attributes('max')).toBe('100')
    view.unmount()
  })
  it('clamps out-of-range values and supports an indeterminate state', async () => {
    const view = mount(Progress, { props: { label: 'Sample import', value: 150 } })
    expect(view.get('progress').attributes('value')).toBe('100')
    await view.setProps({ value: -4 })
    expect(view.get('progress').attributes('value')).toBe('0')
    await view.setProps({ value: undefined })
    expect(view.get('progress').attributes('value')).toBeUndefined()
    expect(view.get('progress').attributes('aria-busy')).toBe('true')
    await view.setProps({ value: Number.NaN })
    expect(view.get('progress').attributes('value')).toBeUndefined()
    view.unmount()
  })
})
describe('section caption actions', () => {
  it('keeps actions beside a single heading and outside the section content', () => {
    const view = mount(Section, {
      props: { title: 'Sample items' },
      slots: { actions: '<button>Inspect</button>', default: '<p>Sample content</p>' },
    })
    expect(view.findAll('h3')).toHaveLength(1)
    const header = view.get('.abele-section__header')
    expect(header.get('h3').text()).toBe('Sample items')
    expect(header.get('button').text()).toBe('Inspect')
    expect(header.find('p').exists()).toBe(false)
    view.unmount()
  })
})
