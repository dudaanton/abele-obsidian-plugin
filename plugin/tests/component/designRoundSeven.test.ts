import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MetaLine from '@/components/obsidian/MetaLine.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import DesignCatalogue from '@/testing/DesignCatalogue.vue'

const catalogue = (page: 'waiting' | 'comment') =>
  mount(DesignCatalogue, {
    props: { page },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })

describe('plain list affordances', () => {
  it('labels unlabelled metadata by meaning rather than pairing ambiguous values', () => {
    const view = mount(MetaLine, {
      props: {
        facts: [
          { key: 'model', value: 'Sample model' },
          { key: 'where', value: 'Work' },
          { key: 'sources', value: 2 },
          { key: 'customScope', value: 'Selected notes' },
        ],
      },
    })
    expect(view.text()).toBe(
      'Model: Sample model · Folder: Work · Sources: 2 · Custom scope: Selected notes'
    )
  })
  it('shows an opening chevron only on the object action, preserving sibling disclosure', async () => {
    const row = mount(ListRow, {
      props: { title: 'sample.md', interactive: true, expanded: false },
    })
    expect(row.get('.abele-list-row__main .abele-list-row__opener').attributes('aria-hidden')).toBe(
      'true'
    )
    expect(row.get('.abele-list-row__main').classes()).toContain('is-clickable')
    await row.get('.abele-disclosure__control').trigger('click')
    expect(row.emitted('open')).toBeUndefined()
    await row.get('.abele-list-row__main').trigger('click')
    expect(row.emitted('open')).toHaveLength(1)
    await row.setProps({ interactive: false })
    expect(row.find('.abele-list-row__opener').exists()).toBe(false)
  })
  it.each(['loading', 'missing', 'error', 'waiting'] as const)(
    'pairs %s with a decorative native glyph and readable text',
    (state) => {
      const row = mount(ListRow, {
        props: { title: 'Sample assistant', state, message: 'Operation status' },
      })
      const status = row.get('.abele-list-row__state')
      expect(status.get('.abele-list-row__status-icon').attributes('aria-hidden')).toBe('true')
      expect(status.text()).toBe('Operation status')
      expect(status.classes()).toContain(`abele-list-row__state_${state}`)
      expect(status.find('button').exists()).toBe(false)
    }
  )
  it('uses one header dismiss action for a read-only catalogue and a labelled pending state', () => {
    const view = catalogue('waiting')
    expect(view.findAll('button').map((b) => b.text())).not.toContain('Close')
    expect(view.text()).toContain('Model: Sample model')
    expect(view.text()).toContain('Folder: Work')
    expect(view.get('.abele-list-row__state_waiting').text()).toBe('Waiting for your answer')
    view.unmount()
  })
  it('keeps Save and Cancel for the draft form and declares its footer dismiss policy', () => {
    const view = catalogue('comment')
    expect(view.findAll('button').map((b) => b.text())).toEqual(
      expect.arrayContaining(['Save', 'Cancel'])
    )
    expect(view.attributes('close-in-footer')).toBe('true')
    view.unmount()
  })
})
