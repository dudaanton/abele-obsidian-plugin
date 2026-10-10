/**
 * The kit's settings row: Obsidian's name, description and control, with the parts named so a
 * snippet can reach them, Obsidian's own error under the control, and its section heading.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Setting from '@/components/obsidian/Setting.vue'

describe('Setting', () => {
  it('names its parts beside Obsidian’s own classes', () => {
    const view = mount(Setting, {
      props: { name: 'Режим', desc: 'Как работает агент' },
      slots: { default: '<select class="own-control"></select>' },
    })

    expect(view.get('.setting-item-name').classes()).toContain('abele-obsidian-setting__name')
    expect(view.get('.setting-item-description').text()).toBe('Как работает агент')
    expect(view.get('.abele-obsidian-setting__control .own-control').exists()).toBe(true)
  })

  it('says what is wrong under the control, as Obsidian does', () => {
    const view = mount(Setting, {
      props: { name: 'Адрес', error: 'Сервер не отвечает' },
      slots: { default: '<input />' },
    })

    expect(view.classes()).toEqual(
      expect.arrayContaining(['is-invalid', 'abele-obsidian-setting_invalid'])
    )
    const error = view.get('.setting-item-control .setting-item-error')
    expect(error.text()).toBe('Сервер не отвечает')
    expect(error.attributes('role')).toBe('alert')
  })

  it('stands as a section heading without a control', () => {
    const view = mount(Setting, { props: { name: 'Синхронизация', heading: true } })

    expect(view.classes()).toEqual(
      expect.arrayContaining(['setting-item-heading', 'abele-obsidian-setting_heading'])
    )
    expect(view.find('.setting-item-control').exists()).toBe(false)
  })

  it('takes its own name and description content', () => {
    const view = mount(Setting, {
      props: { name: 'Режим' },
      slots: { name: '<b class="own-name">Режим</b>', desc: '<a class="own-desc">Подробнее</a>' },
    })

    expect(view.get('.setting-item-name .own-name').exists()).toBe(true)
    expect(view.get('.setting-item-description .own-desc').exists()).toBe(true)
  })
})
