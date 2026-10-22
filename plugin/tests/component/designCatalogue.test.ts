import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesignCatalogue from '@/testing/DesignCatalogue.vue'
import { CATALOGUE_PAGES, CATALOGUE_COMPONENTS } from '@/testing/designCatalogue'
import { readdirSync } from 'node:fs'

describe('test-only design catalogue', () => {
  it('previews the new reports, short lists, anchored cards and selection bar', async () => {
    const options = {
      global: { stubs: { Modal: { template: '<div><slot /></div>' }, NotePicker: true } },
    }
    const states = mount(DesignCatalogue, { ...options, props: { page: 'states' } })
    expect(states.find('.abele-run-report').exists()).toBe(true)
    expect(states.find('.abele-short-list').exists()).toBe(true)
    expect(states.find('.abele-call-note').text()).toBe('The sample action was not sent.')
    expect(states.get('.abele-state-line__text').text()).toBe(
      'The sample operation did not finish.'
    )
    states.unmount()
    const controls = mount(DesignCatalogue, { ...options, props: { page: 'controls' } })
    expect(controls.find('[data-selection-sample]').exists()).toBe(true)
    const button = controls.findAll('button').find((button) => button.text() === 'Anchored card')!
    await button.trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.abele-anchored-card')?.textContent).toContain(
      'Sample context'
    )
    controls.unmount()
    expect(document.body.querySelector('.abele-anchored-card')).toBeNull()
  })
  it('inventories every shared Vue primitive, so new kit entries cannot escape review', () => {
    const kit = readdirSync('src/components/obsidian')
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.slice(0, -4))
      .sort()
    expect([...CATALOGUE_COMPONENTS].sort()).toEqual(kit)
    expect(CATALOGUE_PAGES).toEqual(expect.arrayContaining(['artifact', 'comment', 'waiting']))
  })
  it('previews selection actions through the shared bar in the controls recipe', async () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'controls' },
      global: { stubs: { Modal: { template: '<div><slot /></div>' }, NotePicker: true } },
    })
    const button = view.findAll('button').find((button) => button.text() === 'Selection actions')!
    expect(button).toBeDefined()
    await button.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    const toolbar = document.body.querySelector('.abele-selection-bar')!
    expect(toolbar.getAttribute('aria-label')).toBe('Selection')
    expect(toolbar.querySelector('[data-action="ask"]')).not.toBeNull()
    expect(toolbar.querySelector('[data-action="add"]')).not.toBeNull()
    view.unmount()
    expect(document.body.querySelector('.abele-selection-bar')).toBeNull()
  })
  it('renders named native progress states in the state recipes', () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'states' },
      global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
    })
    const bars = view.findAll('progress')
    expect(bars.map((bar) => bar.attributes('value'))).toEqual(['0', '50', '100', undefined])
    expect(bars.every((bar) => !!bar.attributes('aria-label'))).toBe(true)
    view.unmount()
  })
  it('includes the named compact state indicators in the state recipes', () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'states' },
      global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
    })
    expect(view.findAll('.abele-status-dot').map((dot) => dot.attributes('aria-label'))).toEqual([
      'The sample operation did not finish.',
      'Running',
      'Paused',
      'Exited',
      'Connection lost',
    ])
    view.unmount()
  })
  it('keeps a comment draft while a swatch changes and exposes one primary action', async () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'comment' },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await view.get('textarea').setValue('Retained draft')
    await view.get('[aria-label="Green"]').trigger('click')
    expect((view.get('textarea').element as HTMLTextAreaElement).value).toBe('Retained draft')
    expect(view.findAll('.mod-cta')).toHaveLength(1)
    expect(view.text()).not.toContain('Add comment')
    view.unmount()
  })
  it('shows list entries under a group heading, with codes, label dots and an unfolding note', async () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'navigation' },
      global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
    })
    expect(view.findAll('.abele-group-heading__label').map((l) => l.text())).toContain('Garden')
    const rows = view.findAll('.abele-entry-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).toContain('is-active')
    expect(rows[0].get('.abele-entry-row__codes').text()).toBe('09:30')
    expect(rows[1].findAll('.abele-label-dot').map((d) => d.classes())).toEqual([
      expect.arrayContaining(['abele-label-dot_orange']),
      ['abele-label-dot'],
    ])
    expect(rows[0].find('.abele-entry-row__detail').exists()).toBe(false)
    await rows[0].get('button[aria-label="Show note"]').trigger('click')
    expect(rows[0].get('.abele-entry-row__detail').text()).toBe('Both beds by the shed.')
    view.unmount()
  })
})
