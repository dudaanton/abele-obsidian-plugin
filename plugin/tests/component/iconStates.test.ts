import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from '@/components/obsidian/Icon.vue'

// Obsidian keeps the hover background off a clickable icon only when it carries
// aria-disabled, and lights up anything with `clickable-icon`. These are the two
// contracts the icon's look depends on.
describe('Icon states', () => {
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
