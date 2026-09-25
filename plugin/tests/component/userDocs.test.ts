/**
 * The documentation view: the contents beside a page on a desktop, behind a menu button on a
 * phone, and a search over every page.
 *
 * The markdown itself is Obsidian's to render; the mock writes it in as text, which is enough
 * to ask which page is on screen. Links are built by hand where the test needs one, the way
 * Obsidian draws a link between notes: `a.internal-link` with the target in `data-href`.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { Platform } from 'obsidian'
import UserDocs from '@/components/docs/UserDocs.vue'
import { USER_DOCS, type DocTarget } from '@/userdocs'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | null = null

beforeEach(() => {
  useVault([])
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  Platform.isPhone = false
})

const settle = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await flushPromises()
}

async function open(target: Partial<DocTarget> = {}) {
  const model = reactive<DocTarget>({ page: 'getting-started', heading: '', ...target })
  wrapper = mount(UserDocs, { props: { model }, attachTo: document.body })
  await settle()
  return model
}

const article = () => wrapper!.find('.abele-user-docs__article')
const contents = () => wrapper!.findAll('.abele-user-docs__contents .abele-tree-item__self')
const typeSearch = async (text: string) => {
  const input = wrapper!.find('.abele-user-docs__nav input')
  ;(input.element as HTMLInputElement).value = text
  await input.trigger('input')
  await settle()
}

describe('on a desktop', () => {
  it('lists every page in the contents', async () => {
    await open()
    const titles = contents().map((row) => row.text())
    for (const page of USER_DOCS) expect(titles).toContain(page.title)
  })

  it('shows the page it was opened on', async () => {
    await open({ page: 'finance' })
    expect(article().text()).toContain('# Finance')
  })

  it('opens a page picked in the contents, and says which one is open', async () => {
    const model = await open()
    const row = contents().find((r) => r.text() === 'Tasks')!
    await row.trigger('click')
    await settle()

    expect(model.page).toBe('tasks')
    expect(article().text()).toContain('# Tasks')
    expect(wrapper!.find('.abele-user-docs__contents .is-active').text()).toBe('Tasks')
  })

  it("lists the open page's sections under it, to jump to", async () => {
    const model = await open({ page: 'tasks' })
    const section = contents().find((r) => r.text() === 'Priority and labels')!
    await section.trigger('click')
    await settle()

    expect(model).toEqual({ page: 'tasks', heading: 'priority-and-labels' })
  })

  it('follows a link to another page without opening a note', async () => {
    const model = await open({ page: 'getting-started' })
    const link = document.createElement('a')
    link.className = 'internal-link'
    link.setAttribute('data-href', 'groups#the-footer')
    article().element.querySelector('.abele-markdown')!.appendChild(link)
    link.click()
    await settle()

    expect(model).toEqual({ page: 'groups', heading: 'the-footer' })
  })

  it('shows the contents and the page side by side, with no menu button', async () => {
    await open()
    expect(wrapper!.find('.abele-user-docs__nav').exists()).toBe(true)
    expect(article().isVisible()).toBe(true)
    expect(wrapper!.find('.abele-user-docs__menu').exists()).toBe(false)
  })
})

describe('search', () => {
  it('replaces the contents with what it found, the words marked', async () => {
    await open()
    await typeSearch('passphrase')

    expect(wrapper!.find('.abele-user-docs__contents').exists()).toBe(false)
    const hits = wrapper!.findAll('.abele-user-docs__hit')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text()).toContain('Transfer and keys')
    expect(hits[0].find('mark').text().toLowerCase()).toBe('passphrase')
  })

  it('opens the section a result is in', async () => {
    const model = await open()
    await typeSearch('synced keys')
    await wrapper!.find('.abele-user-docs__hit').trigger('click')
    await settle()

    expect(model).toEqual({ page: 'transfer', heading: 'synced-keys' })
  })

  it('marks the words it found on the page it opens', async () => {
    await open()
    await typeSearch('passphrase')
    await wrapper!.find('.abele-user-docs__hit').trigger('click')
    await settle()

    const marks = article().findAll('mark.abele-user-docs__mark')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].text().toLowerCase()).toBe('passphrase')
  })

  it('leaves a page picked from the contents unmarked', async () => {
    await open()
    await typeSearch('passphrase')
    await wrapper!.find('.abele-user-docs__hit').trigger('click')
    await settle()
    await typeSearch('')
    await contents()
      .find((r) => r.text() === 'Tasks')!
      .trigger('click')
    await settle()

    expect(article().findAll('mark').length).toBe(0)
  })

  it('says so when nothing matches', async () => {
    await open()
    await typeSearch('zzqxv')
    expect(wrapper!.find('.abele-user-docs__hit').exists()).toBe(false)
    expect(wrapper!.find('.abele-empty-state').text()).toContain('Nothing')
  })

  it('goes back to the contents once the search is emptied', async () => {
    await open()
    await typeSearch('timer')
    await typeSearch('')
    expect(wrapper!.find('.abele-user-docs__contents').exists()).toBe(true)
  })
})

describe('on a phone', () => {
  beforeEach(() => {
    Platform.isPhone = true
  })

  it('shows the page, with the contents behind a menu button', async () => {
    await open({ page: 'books' })
    expect(article().isVisible()).toBe(true)
    expect(wrapper!.find('.abele-user-docs__nav').exists()).toBe(false)
    expect(wrapper!.find('.abele-user-docs__menu').exists()).toBe(true)
    expect(wrapper!.find('.abele-user-docs__bar').text()).toContain('Books')
  })

  it('opens the contents from the menu button, and closes them once a page is picked', async () => {
    const model = await open()
    await wrapper!.find('.abele-user-docs__menu').trigger('click')
    await settle()
    expect(wrapper!.find('.abele-user-docs__nav').exists()).toBe(true)
    expect(article().isVisible()).toBe(false)

    await contents()
      .find((r) => r.text() === 'Finance')!
      .trigger('click')
    await settle()

    expect(model.page).toBe('finance')
    expect(wrapper!.find('.abele-user-docs__nav').exists()).toBe(false)
    expect(article().isVisible()).toBe(true)
  })
})
