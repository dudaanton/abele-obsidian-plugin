import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from '@/components/obsidian/Icon.vue'

// Obsidian keeps the hover background off a clickable icon only when it carries
// aria-disabled, and lights up anything with `clickable-icon`. These are the two
// contracts the icon's look depends on.
describe('Icon states', () => {
  it('keeps trailing content after the count inside the same action', () => {
    const w = mount(Icon, {
      props: { icon: 'folder-lock', textRight: '2', label: 'Access', interactive: true },
      slots: { default: '<span aria-hidden="true">mode</span>' },
    })
    expect(w.element.tagName).toBe('BUTTON')
    expect([...w.element.children].map((child) => child.textContent)).toEqual(['', '2', 'mode'])
    expect(w.findAll('button')).toHaveLength(1)
    w.unmount()
  })

  it('marks a disabled action the way Obsidian does, so the theme drops its hover', () => {
    const w = mount(Icon, {
      props: { icon: 'pin', label: 'Pin', disabled: true, onClick: () => {} },
    })
    const el = w.element as HTMLElement
    expect(el.tagName).toBe('BUTTON')
    expect(el.classList.contains('clickable-icon')).toBe(true)
    expect(el.getAttribute('aria-disabled')).toBe('true')
    expect(el.classList.contains('abele-obsidian-icon_disabled')).toBe(true)
  })

  it('leaves an enabled action without the disabled mark', () => {
    const w = mount(Icon, { props: { icon: 'pin', label: 'Pin', onClick: () => {} } })
    expect((w.element as HTMLElement).hasAttribute('aria-disabled')).toBe(false)
  })

  it('keeps a picture-only icon out of the clickable family', () => {
    const w = mount(Icon, { props: { icon: 'pin' } })
    const el = w.element as HTMLElement
    expect(el.tagName).toBe('SPAN')
    expect(el.classList.contains('clickable-icon')).toBe(false)
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Icon sizes', () => {
  it('takes one of the host icon sizes by name, as a BEM modifier', () => {
    for (const size of ['xs', 'm', 'l', 'xl'] as const) {
      const w = mount(Icon, { props: { icon: 'pin', size } })
      expect(
        (w.element as HTMLElement).classList.contains(`abele-obsidian-icon_size-${size}`)
      ).toBe(true)
    }
  })

  it('without a size, leaves the size to the place it sits in', () => {
    const w = mount(Icon, { props: { icon: 'pin' } })
    expect([...(w.element as HTMLElement).classList].some((c) => c.includes('_size-'))).toBe(false)
  })
})
