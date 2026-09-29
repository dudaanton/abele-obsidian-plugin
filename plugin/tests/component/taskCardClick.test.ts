/**
 * A click on a task card opens the task, unless it ends a drag that selected the card's words.
 *
 * The browser fires a click after a drag that starts and ends on the same card, so selecting a
 * description to copy it opened the task instead and the selection went with the page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Task } from '@/entities/Task'
import TaskCard from '@/components/Task.vue'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

const opened = vi.hoisted(() => [] as string[])
vi.mock('@/helpers/vaultUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/vaultUtils')>()),
  openFile: (path: string) => {
    opened.push(path)
  },
}))

let view: VueWrapper | null = null

const render = () => {
  const task = new Task({ wikilink: '[[Tasks/Sample card]]' })
  task.loaded = true
  task.title = 'Sample card'
  view = mount(TaskCard, { props: { task }, shallow: true, attachTo: document.body })
  return view
}

describe('task card — click', () => {
  beforeEach(() => {
    installFakeIntersectionObserver()
    useVault([])
    configureAbele()
    opened.length = 0
    document.getSelection()?.removeAllRanges()
  })

  afterEach(() => {
    document.getSelection()?.removeAllRanges()
    view?.unmount()
    view = null
  })

  it('opens the task', async () => {
    const card = render()
    await card.find('.abele-task-view__content').trigger('click')
    expect(opened).toHaveLength(1)
  })

  it('does not open it when the click ends a selection of its words', async () => {
    const card = render()
    const content = card.find('.abele-task-view__content').element
    content.appendChild(document.createTextNode('Words to select'))
    const range = document.createRange()
    range.selectNodeContents(content)
    document.getSelection()!.addRange(range)

    await card.find('.abele-task-view__content').trigger('click')
    expect(opened).toHaveLength(0)
  })

  it('opens it when the selection is somewhere else', async () => {
    const card = render()
    const elsewhere = document.body.appendChild(document.createElement('p'))
    elsewhere.textContent = 'Other words'
    const range = document.createRange()
    range.selectNodeContents(elsewhere)
    document.getSelection()!.addRange(range)

    await card.find('.abele-task-view__content').trigger('click')
    expect(opened).toHaveLength(1)
    elsewhere.remove()
  })
})
