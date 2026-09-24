/**
 * A markdown file in a GitHub tab: rendered by default, switched to its code and back, lines
 * selected from either view and kept across the switch, and the links in it pointed at the
 * repository.
 *
 * happy-dom lays nothing out and the renderer mock writes the markdown as text, so this asserts
 * which blocks exist, which are marked, what the bar links to and what a click does; how it looks
 * is for the running app.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { MarkdownRenderer, WorkspaceLeaf } from 'obsidian'
import { openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const README = [
  '# Widgets', // 1
  '',
  'Intro line', // 3
  'second line', // 4
  '',
  '- one', // 6
  '- two', // 7
  '',
  '```sh', // 9
  'npm i',
  '```', // 11
  '',
  'See [guide](docs/guide.md) and [bad](javascript:alert(1)).', // 13
].join('\n')

const ROUTES = {
  '/repos/o/r/contents/README.md': { text: README },
  '/repos/o/r/commits/main': { text: `${SHA}\n` },
}
const BASE = 'https://github.com/o/r/blob/main/README.md'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const blocks = (w: VueWrapper) => w.findAll('.abele-github-md__block')
const marked = (w: VueWrapper) =>
  w.findAll('.abele-github-md__block_marked').map((b) => b.attributes('data-start'))
const markedLines = (w: VueWrapper) =>
  w.findAll('.abele-github-code__line_target').map((l) => l.text())
const activeMode = (w: VueWrapper) => w.find('.abele-github-blob .abele-tabs__tab_active').text()

async function switchTo(w: VueWrapper, label: 'Preview' | 'Code') {
  const tab = w.findAll('.abele-github-blob .abele-tabs__tab').find((t) => t.text() === label)!
  await tab.trigger('click')
  await flushPromises()
}

async function pick(w: VueWrapper, index: number, shiftKey = false) {
  await blocks(w)[index].find('.abele-github-md__handle').trigger('click', { shiftKey })
  await flushPromises()
}

describe('a markdown file', () => {
  it('opens rendered, one block per piece of the file, with the switch on Preview', async () => {
    const { wrapper } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))

    expect(wrapper.find('.cm-editor').exists()).toBe(false)
    expect(activeMode(wrapper)).toBe('Preview')
    expect(
      blocks(wrapper).map((b) => [b.attributes('data-start'), b.attributes('data-end')])
    ).toEqual([
      ['1', '1'],
      ['3', '4'],
      ['6', '6'],
      ['7', '7'],
      ['9', '11'],
      ['13', '13'],
    ])
    await vi.waitFor(() => expect(blocks(wrapper)[1].text()).toContain('Intro line'))
    // The heading carries its anchor, for a link to #widgets.
    expect(blocks(wrapper)[0].attributes('data-anchor')).toBe('widgets')
  })

  it('a link naming lines opens the code at them; Preview then marks their blocks', async () => {
    const { wrapper, model } = open(`${BASE}#L4-L6`, ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    expect(activeMode(wrapper)).toBe('Code')
    expect(markedLines(wrapper)).toEqual(['second line', '', '- one'])

    await switchTo(wrapper, 'Preview')
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    expect(marked(wrapper)).toEqual(['3', '6'])
    // The tab remembers the switch, for back, forward and a restart.
    expect(model.mode).toBe('preview')
  })

  it('?plain=1 opens the code', async () => {
    const { wrapper } = open(`${BASE}?plain=1`, ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    expect(activeMode(wrapper)).toBe('Code')
  })

  it('a file that is not markdown has no switch', async () => {
    const { wrapper } = open('https://github.com/o/r/blob/main/src/a.ts', {
      '/repos/o/r/contents/src/a.ts': { text: 'let a' },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    expect(wrapper.find('.abele-github-blob .abele-tabs').exists()).toBe(false)
  })
})

describe('selecting lines from the rendered file', () => {
  it('a block handle selects its lines, Shift extends, and the link is to the source lines', async () => {
    const { wrapper } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))

    await pick(wrapper, 2)
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Line 6')
    await pick(wrapper, 4, true)
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Lines 6–11')
    expect(marked(wrapper)).toEqual(['6', '7', '9'])
    // The bar sits under the last block of the selection.
    expect(wrapper.find('.abele-github-md__bar').element.previousElementSibling).toBe(
      blocks(wrapper)[4].element
    )

    await wrapper.find('.abele-github-selection button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(
      `[o/r@0123456 · README.md:6–11](https://github.com/o/r/blob/${SHA}/README.md?plain=1#L6-L11)`
    )
  })

  it('picking the only selected block again clears the selection', async () => {
    const { wrapper } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    await pick(wrapper, 1)
    await pick(wrapper, 1)
    expect(wrapper.find('.abele-github-selection').exists()).toBe(false)
    expect(marked(wrapper)).toEqual([])
  })

  it('the selection stays when switching to the code, with its bar', async () => {
    const { wrapper } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    await pick(wrapper, 2)
    await pick(wrapper, 3, true)

    await switchTo(wrapper, 'Code')
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    expect(markedLines(wrapper)).toEqual(['- one', '- two'])
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-selection__label').text()).toBe('Lines 6–7')
    )
  })

  it('lines selected in the code show in the rendered file', async () => {
    const { wrapper } = open(`${BASE}#L1`, ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    // A click on line 10's number, where CodeMirror's 14 px estimate puts it.
    wrapper
      .find('.cm-lineNumbers')
      .element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 14 * 9 + 7 }))
    await flushPromises()
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Line 10')

    await switchTo(wrapper, 'Preview')
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    expect(marked(wrapper)).toEqual(['9'])
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Line 10')
  })
})

describe('links in the rendered file', () => {
  it('open a file of the repository in the tab, and never run a script', async () => {
    // What Obsidian makes of the last paragraph: a note link and an external one.
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
      if (!markdown.startsWith('See')) return
      const note = document.createElement('a')
      note.className = 'internal-link'
      note.textContent = 'guide'
      note.setAttribute('data-href', 'docs/guide.md')
      note.setAttribute('href', 'docs/guide.md')
      const bad = document.createElement('a')
      bad.className = 'external-link'
      bad.textContent = 'bad'
      bad.setAttribute('href', 'javascript:alert(1)')
      el.append(note, bad)
    })
    const { wrapper, onOpen } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-md a')).toHaveLength(2))

    const [guide, bad] = wrapper.findAll('.abele-github-md a')
    expect(bad.attributes('href')).toBeUndefined()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    bad.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)

    await guide.trigger('click')
    expect(onOpen).toHaveBeenCalledWith('https://github.com/o/r/blob/main/docs/guide.md')
  })
})

describe('a link to a folder', () => {
  it('says it is one, rather than showing its listing as a file', async () => {
    const listing = [{ name: 'a.ts', path: 'packages/core/a.ts', type: 'file', _links: {} }]
    const { wrapper } = open('https://github.com/o/r/blob/main/packages/core', {
      '/repos/o/r/contents/packages/core': { text: JSON.stringify(listing) },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github__error').exists()).toBe(true))
    expect(wrapper.text()).toContain('packages/core is a folder')
    expect(wrapper.find('.cm-editor').exists()).toBe(false)
  })
})

describe('the tab keeps the switch', () => {
  it('in its state, and forgets it when a link is followed', async () => {
    const { GithubView } = await import('@/github/GithubView')
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState({ url: BASE, mode: 'code' }, { history: false })
    expect(view.model.mode).toBe('code')
    expect(view.getState()).toEqual({ url: BASE, mode: 'code' })

    await view.setState({ url: `${BASE}#install` }, { history: false })
    expect(view.model.mode).toBeUndefined()
    expect(view.getState()).toEqual({ url: `${BASE}#install` })
  })
})

describe('find in a markdown file', () => {
  const count = (w: VueWrapper) => w.find('.abele-github-find__count').text()
  const find = async (w: VueWrapper, keys: { find: number }, q: string) => {
    keys.find++
    await flushPromises()
    const input = w.find<HTMLInputElement>('.abele-github-find__input').element
    input.value = q
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 150))
    await flushPromises()
  }

  it('finds in the rendered blocks, and in the code once switched to it', async () => {
    const { wrapper, keys } = open(BASE, ROUTES)
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    await find(wrapper, keys, 'second line')
    expect(count(wrapper)).toBe('1 of 1')
    await find(wrapper, keys, 'npm i')
    expect(count(wrapper)).toBe('1 of 1')

    await switchTo(wrapper, 'Code')
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await find(wrapper, keys, 'second line')
    expect(count(wrapper)).toBe('1 of 1')
  })

  it('names a file read at a commit by its short SHA in the code search scopes', async () => {
    const { wrapper } = open(`https://github.com/o/r/blob/${SHA}/README.md`, {
      [`/repos/o/r/contents/README.md?ref=${SHA}`]: { text: README },
    })
    await vi.waitFor(() => expect(blocks(wrapper)).toHaveLength(6))
    const icon = wrapper
      .findAll('.abele-github-header__actions .abele-obsidian-icon')
      .find((i) => i.attributes('aria-label')?.startsWith('Search the code'))!
    await icon.trigger('click')
    await flushPromises()
    const options = wrapper.findAll('.abele-github-search__scope option').map((o) => o.text())
    expect(options).toEqual([
      `Whole repository at ${SHA.slice(0, 7)}`,
      `File names at ${SHA.slice(0, 7)}`,
    ])
  })
})
