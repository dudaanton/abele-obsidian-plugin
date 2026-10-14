/**
 * A click on a link in a task's words follows the link and leaves the task alone.
 *
 * The row opens its task on a click anywhere in it, and only an internal link was let through:
 * a web address or a tag in the name or the description opened the task note as well as the
 * link. Folded and unfolded, each kind of link Obsidian draws is clicked; the task is not opened
 * and the row stays as it was. A click on the words outside a link still opens the task.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { MarkdownRenderer } from 'obsidian'
import TaskCard from '@/components/Task.vue'
import { Task } from '@/entities/Task'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness } from '../helpers/taskHarness'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

const opened = vi.hoisted(() => vi.fn())
vi.mock('@/helpers/vaultUtils', async (original) => ({
  ...(await original<typeof import('@/helpers/vaultUtils')>()),
  openFile: opened,
}))
const followed = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/ai/openChat', () => ({ openLink: followed }))

const BODY =
  '\nSample title [[Sample note]] [site](https://example.com/sample) #sample-tag\n\n' +
  'Sample description [[Other note]] [docs](https://example.com/docs) #other-tag\n'

// Obsidian's own markup for the three kinds of link, for the words the renderer is given.
const draw = (text: string, el: HTMLElement) => {
  const doc = el.ownerDocument
  const p = el.appendChild(doc.createElement('p'))
  const link = (cls: string, href: string) => {
    const a = p.appendChild(doc.createElement('a'))
    a.className = cls
    for (const [k, v] of Object.entries({ href, target: '_blank', rel: 'noopener nofollow' }))
      a.setAttribute(k, v)
    return a
  }
  for (const part of text.split(/(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|#[\w-]+)/)) {
    const wiki = /^\[\[(.+)\]\]$/.exec(part)
    const web = /^\[(.+)\]\((.+)\)$/.exec(part)
    if (wiki) {
      const a = link('internal-link', wiki[1])
      a.setAttribute('data-href', wiki[1])
      a.textContent = wiki[1]
    } else if (web) {
      // The words of a web link sit in an element of their own, as an image or code would.
      const span = link('external-link', web[2]).appendChild(doc.createElement('span'))
      span.textContent = web[1]
    } else if (part.startsWith('#')) link('tag', part).textContent = part
    else if (part) p.appendChild(doc.createTextNode(part))
  }
}

let view: VueWrapper | undefined
let task: Task

beforeEach(() => {
  taskHarness({}, [])
  installFakeIntersectionObserver()
  opened.mockClear()
  followed.mockClear()
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    draw(text, el)
  })
  task = reactive(new Task({ wikilink: '[[Water seedlings]]', filePath: 'Daily/Sample day.md' }))
})

afterEach(() => {
  view?.unmount()
  view = undefined
  task.cleanup()
  VaultWatcherWrapper.destroy()
  resetFakeIntersectionObservers()
  vi.restoreAllMocks()
})

const render = async () => {
  vi.spyOn(Task.prototype, 'loadContent').mockImplementation(async function (this: Task) {
    const lines = BODY.split('\n').filter((line) => line.trim())
    this.title = lines[0]
    this.description = lines.slice(1).join('\n')
  })
  view = mount(TaskCard, {
    props: { task },
    shallow: true,
    attachTo: document.body,
    global: { stubs: { EntryRow: false, ObsidianMarkdown: false, Markdown: false } },
  })
  await flushPromises()
  expect(scrollIntoView(view.find('.abele-task-view').element)).toBeGreaterThan(0)
  await flushPromises()
  await vi.waitFor(() => expect(view!.find('.abele-task-view__title a').exists()).toBe(true))
  return view
}

const unfold = async () => {
  await view!.find('.abele-entry-row__more').trigger('click')
  await flushPromises()
  await vi.waitFor(() => expect(view!.find('.abele-task-view__description a').exists()).toBe(true))
}

/** Clicks what `selector` finds in `part` and returns whether the browser was left to follow it. */
const click = (part: string, selector: string) => {
  const el = view!.find(`${part} ${selector}`).element as HTMLElement
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return !event.defaultPrevented
}

const rowState = () => ({
  unfolded: view!.find('.abele-task-view__description').exists(),
  chevron: view!.find('.abele-entry-row__more').attributes('aria-label'),
})

const kinds = [
  ['an internal link', 'a.internal-link'],
  ['a web link', 'a.external-link'],
  ['the words of a web link', 'a.external-link span'],
  ['a tag', 'a.tag'],
] as const

describe('task row — a link in its words', () => {
  for (const [state, part] of [
    ['folded', '.abele-task-view__title'],
    ['unfolded', '.abele-task-view__description'],
  ] as const) {
    for (const [name, selector] of kinds) {
      it(`${state}: a click on ${name} does not open the task or change the row`, async () => {
        await render()
        if (state === 'unfolded') await unfold()
        const before = rowState()
        click(part, selector)
        await flushPromises()
        expect(opened).not.toHaveBeenCalled()
        expect(rowState()).toEqual(before)
      })
    }

    it(`${state}: a web link is left to the browser to follow`, async () => {
      await render()
      if (state === 'unfolded') await unfold()
      expect(click(part, 'a.external-link')).toBe(true)
    })

    it(`${state}: an internal link opens its note, resolved from the task's own note`, async () => {
      await render()
      if (state === 'unfolded') await unfold()
      click(part, 'a.internal-link')
      await vi.waitFor(() => expect(followed).toHaveBeenCalledOnce())
      const href = state === 'folded' ? 'Sample note' : 'Other note'
      expect(followed).toHaveBeenCalledWith(href, task.taskPath, false)
    })
  }

  it('a click on the words outside a link still opens the task', async () => {
    await render()
    await view!.find('.abele-task-view__title p').trigger('click')
    expect(opened).toHaveBeenCalledOnce()
  })

  it('a click on the description outside a link still opens the task', async () => {
    await render()
    await unfold()
    await view!.find('.abele-task-view__description p').trigger('click')
    expect(opened).toHaveBeenCalledOnce()
  })
})
