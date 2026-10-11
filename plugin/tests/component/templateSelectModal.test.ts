/**
 * Picking a template: rows as Obsidian's own suggestion list draws them, worked from the
 * keyboard as well as by pointer. Enter picks a template and, on the one already picked, uses
 * it; Enter on a folder or a breadcrumb goes there. Select comes first in the footer.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import TemplateSelectModal from '@/components/TemplateSelectModal.vue'
import type { UserTemplate } from '@/templates/UserTemplate'

const shell = defineComponent({ template: '<div><slot /><slot name="footer" /></div>' })
const template = (name: string, templateDir?: string) =>
  ({
    name,
    templateFor: 'note',
    templateDir,
    file: { path: `Templates/${templateDir ? templateDir + '/' : ''}${name}.md` },
  }) as unknown as UserTemplate
const templates = [
  template('Sample daily'),
  template('Sample weekly'),
  template('Sample plant', 'Garden'),
  template('Sample bed', 'Garden/Beds'),
]

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})
const draw = () =>
  (wrapper = mount(TemplateSelectModal, {
    props: { templates },
    global: { stubs: { Modal: shell } },
  }))
const option = (name: string) =>
  wrapper!
    .findAll('[role="option"]')
    .find((o) => o.find('.abele-template-select__item-name').text() === name)!
const enter = { key: 'Enter' }

describe('the template picker', () => {
  it('puts Select first, as the accent, and Cancel after it', () => {
    draw()
    const footer = wrapper!.findAll('button').slice(-2)
    expect(footer.map((b) => b.text())).toEqual(['Select', 'Cancel'])
    expect(footer[0].classes()).toContain('mod-cta')
  })

  it('picks a template with Enter, and uses the picked one on the next Enter', async () => {
    draw()
    expect(option('Sample daily').attributes('aria-selected')).toBe('false')
    await option('Sample daily').trigger('keydown', enter)
    expect(option('Sample daily').attributes('aria-selected')).toBe('true')
    expect(option('Sample weekly').attributes('aria-selected')).toBe('false')
    expect(wrapper!.emitted('select')).toBeUndefined()

    // Enter on another row moves the pick rather than using the first.
    await option('Sample weekly').trigger('keydown', enter)
    expect(option('Sample weekly').attributes('aria-selected')).toBe('true')
    expect(wrapper!.emitted('select')).toBeUndefined()

    await option('Sample weekly').trigger('keydown', enter)
    expect(wrapper!.emitted('select')).toEqual([[templates[1]]])
  })

  it('opens a folder with Enter and goes back up through the breadcrumbs with Enter', async () => {
    draw()
    const folder = () => wrapper!.findAll('.abele-template-select__item_folder')
    expect(folder().map((f) => f.attributes('role'))).toEqual(['button'])

    await folder()[0].trigger('keydown', enter)
    expect(wrapper!.findAll('[role="option"]').map((o) => o.text())).toEqual([
      expect.stringContaining('Sample plant'),
    ])
    await folder()[0].trigger('keydown', enter)
    expect(option('Sample bed').exists()).toBe(true)

    const crumbs = () => wrapper!.findAll('.abele-template-select__breadcrumb-item')
    expect(crumbs().map((c) => [c.text(), c.attributes('role')])).toEqual([
      ['All', 'button'],
      ['Garden', 'button'],
      ['Beds', 'button'],
    ])
    await crumbs()[1].trigger('keydown', enter)
    expect(option('Sample plant').exists()).toBe(true)
    await crumbs()[0].trigger('keydown', enter)
    expect(option('Sample daily').exists()).toBe(true)
    expect(wrapper!.find('.abele-template-select__breadcrumbs').exists()).toBe(false)
  })
})
