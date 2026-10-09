import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Catalogue from '@/testing/DesignCatalogue.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { useVault } from '../helpers/testEnv'
const shell = {
  props: ['title', 'size'],
  template: '<div><slot/><footer><slot name="footer"/></footer></div>',
}
const open = (page: string) => {
  useVault([])
  return mount(Catalogue, { props: { page: page as never }, global: { stubs: { Modal: shell } } })
}
describe('plain, coherent examples', () => {
  it.each(['rows', 'events', 'waiting', 'controls', 'details'])(
    '%s identifies its purpose without debug scaffolding or unexplained footer menu',
    (page) => {
      const view = open(page)
      expect(view.getComponent(Modal).props('title')).not.toBe('Design catalogue')
      expect(view.text()).not.toMatch(
        /Native:|Synthetic fixtures|disclosed|Setting rows|Single line/
      )
      expect(view.get('footer').find('[aria-haspopup="menu"]').exists()).toBe(false)
      view.unmount()
    }
  )
  it('keeps location and source facts together, with no redundant type or duplicate source count', () => {
    const view = open('rows')
    const first = view.findAllComponents(ListRow)[0]
    expect(first.get('.abele-meta-line').text()).toBe('Work · Sources 2')
    expect(first.text()).not.toContain('Note ·')
    expect(first.get('.abele-list-row__content').find('.abele-list-row__detail').exists()).toBe(
      false
    )
    expect(view.findAllComponents(ListRow).length).toBeGreaterThanOrEqual(5)
    view.unmount()
  })
  it('keeps an answer action with the pending question, in the title column', () => {
    const view = open('waiting')
    const agent = view.findAllComponents(ListRow)[0]
    expect(agent.get('.abele-list-row__content').text()).toContain('Waiting for your answer')
    expect(agent.get('.abele-list-row__detail').text()).toContain('Reply')
    view.unmount()
  })
  it.each(['waiting', 'comment-thread', 'events'])(
    '%s puts retry beside its recovery message instead of in the title menu',
    (page) => {
      const view = open(page)
      const row = view.findAllComponents(ListRow).find((row) => row.props('state') === 'error')!
      expect(row.get('.abele-list-row__recovery').text()).toContain('Retry')
      view.unmount()
    }
  )
  it('names Cancel and preserves the editor name without a redundant visible label', async () => {
    const view = open('comment')
    expect(view.find('label[for="catalogue-comment"]').exists()).toBe(false)
    expect(view.get('textarea').attributes('aria-label')).toBe('Comment')
    expect(view.get('footer').text()).toContain('Cancel')
    view.unmount()
  })
})
