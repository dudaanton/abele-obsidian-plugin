/**
 * A GitHub tab as an agent sees it, and the ways from a tab into a chat.
 *
 * The owner wants agents that help him read code he is looking at: so `github_views` has to know
 * what is on screen — the item, the section, the open diffs, the lines selected with their code —
 * and "Chat about this" / "Ask here" start a chat with a link to it (and the code) in the input.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { diffAnchorHash } from '@/github/urls'
import { createGithubOpenTool, createGithubViewsTool } from '@/ai/tools/github/ViewTools'
import type { GithubViewModel } from '@/github/model'
import { PULL, file, openTab } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { Menu, Platform, WorkspaceLeaf } from 'obsidian'
import { GithubView } from '@/github/GithubView'

const { askAboutGithub } = vi.hoisted(() => ({ askAboutGithub: vi.fn(async () => {}) }))
vi.mock('@/github/chatAbout', () => ({ askAboutGithub }))

const PULL_ROUTES = {
  '/repos/o/r/pulls/7': { json: PULL },
  '/repos/o/r/issues/7/comments': { json: [] },
  '/repos/o/r/pulls/7/reviews': { json: [] },
  '/repos/o/r/pulls/7/comments': { json: [] },
  '/repos/o/r/pulls/7/files': { json: [file('src/app.ts')] },
}

let opened: { url: string; leaf: unknown }[]
let leaves: { view: { model: GithubViewModel; containerEl: { isShown: () => boolean } } }[]

function useWorkspace(ai = true) {
  const app = useVault([]) as unknown as Record<string, unknown>
  opened = []
  leaves = []
  const newLeaf = () => {
    const leaf = {
      setViewState: async (s: { state: { url: string } }) => {
        opened.push({ url: s.state.url, leaf })
      },
    }
    return leaf
  }
  app.workspace = {
    getLeavesOfType: (type: string) => (type === 'abele-github' ? leaves : []),
    getLeaf: () => newLeaf(),
    revealLeaf: async () => {},
  }
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: ai }
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
}

/** A click on a line number, by CodeMirror's 14 px estimate of a line (happy-dom lays nothing out). */
async function clickLineNumber(
  w: VueWrapper,
  gutter: string,
  line: number,
  shift = false,
  above = 0
) {
  const clientY = 14 * (line - 1) + 7 + above
  w.find(gutter).element.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, clientY, shiftKey: shift })
  )
  await flushPromises()
}

const run = async (tool: ReturnType<typeof createGithubViewsTool>, params = {}) =>
  (await tool.execute('call-1', params)).content[0].text

beforeEach(() => {
  useWorkspace()
  askAboutGithub.mockClear()
  document.body.replaceChildren()
})

describe('what is on screen', () => {
  it('follows the section, the open diffs and the selected lines with their code', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const { wrapper, model } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))

    expect(model.screen.title).toBe('Fix the crash')
    expect(model.screen.kind).toBe('pull')
    expect(model.screen.section).toBe('files')
    expect(model.screen.expanded).toEqual(['src/app.ts'])

    // The diff's rows: the hunk header, " a", "-b", "+c", "+d". Rows 4–5 are "+c" and "+d".
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 5, true, 40)
    expect(model.screen.selection).toEqual({
      path: 'src/app.ts',
      label: 'Lines 2–3',
      code: '+c\n+d',
      url: `https://github.com/o/r/pull/7/files#diff-${hash}R2-R3`,
    })

    // Folding the file away takes its selection with it.
    await wrapper.find('.abele-github-file__head').trigger('click')
    await flushPromises()
    expect(model.screen.expanded).toEqual([])
    expect(model.screen.selection).toBeNull()
  })

  it('is what github_views tells an agent', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    leaves = [{ view: { model, containerEl: { isShown: () => true } } }]

    const out = await run(createGithubViewsTool())

    expect(out).toContain('1 GitHub tab open.')
    expect(out).toContain('[on screen] Pull request o/r#7 — Fix the crash')
    expect(out).toContain('URL: https://github.com/o/r/pull/7/files')
    expect(out).toContain('Showing the changed files.')
    expect(out).toContain('Open diffs: src/app.ts')
    expect(out).toContain('Selected: src/app.ts, Line 2')
    expect(out).toContain('+c')
  })

  it("keeps a file's selected lines as they are, with no diff signs", async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/src/app.ts', {
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo\nthree' },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.cm-lineNumbers', 2)
    await clickLineNumber(wrapper, '.cm-lineNumbers', 3, true, 40)
    expect(model.screen.selection).toMatchObject({ path: 'src/app.ts', code: 'two\nthree' })
    expect(model.screen.link?.label).toBe('o/r@main · src/app.ts')
  })

  it('names a folder, and says when the file tree panel is open beside it', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/tree/main/src', {
      '/repos/o/r/contents/src': { json: [{ name: 'a.ts', path: 'src/a.ts', type: 'file' }] },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-folder').exists()).toBe(true))
    model.tree = true
    leaves = [{ view: { model, containerEl: { isShown: () => true } } }]

    const out = await run(createGithubViewsTool())
    expect(out).toContain('[on screen] Folder o/r: src/ — src')
    expect(out).toContain('The file tree panel is open beside it')
  })

  it('says so when no GitHub tab is open', async () => {
    expect(await run(createGithubViewsTool())).toContain('No GitHub tab is open')
  })
})

describe('into a chat', () => {
  it('"Ask here" under selected lines passes their link and code on', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)

    const ask = wrapper
      .findAll('.abele-github-selection button')
      .find((b) => b.text().includes('Ask here'))!
    await ask.trigger('click')
    await flushPromises()

    expect(askAboutGithub).toHaveBeenCalledWith(
      { label: 'o/r#7 · src/app.ts:2', url: `https://github.com/o/r/pull/7/files#diff-${hash}R2` },
      { code: '+c', path: 'src/app.ts', diff: true }
    )
  })

  it('"Chat about this" in the header passes a link to the item on', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pull/7', PULL_ROUTES)
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-header__title').text()).toContain('Fix')
    )

    await wrapper
      .find('.abele-github-header__actions [aria-label^="Chat about this"]')
      .trigger('click')
    await flushPromises()

    expect(askAboutGithub.mock.calls[0][0]).toEqual({
      label: 'o/r#7 · Fix the crash',
      url: 'https://github.com/o/r/pull/7',
    })
  })

  it('"Chat about this" with lines selected quotes them, as "Ask here" does', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)

    await wrapper
      .find('.abele-github-header__actions [aria-label^="Chat about this"]')
      .trigger('click')
    await flushPromises()

    expect(askAboutGithub).toHaveBeenCalledWith(
      { label: 'o/r#7 · src/app.ts:2', url: `https://github.com/o/r/pull/7/files#diff-${hash}R2` },
      { code: '+c', path: 'src/app.ts', diff: true }
    )
  })

  it('"Chat about this" goes back to the item once the selection is gone', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    await wrapper.find('.abele-github-file__head').trigger('click')
    await flushPromises()
    expect(model.screen.selection).toBeNull()

    await wrapper
      .find('.abele-github-header__actions [aria-label^="Chat about this"]')
      .trigger('click')
    await flushPromises()

    const [link, quote] = askAboutGithub.mock.calls[0] as unknown as [unknown, unknown]
    expect(link).toEqual({ label: 'o/r#7 · Fix the crash', url: 'https://github.com/o/r/pull/7' })
    expect(quote).toBeUndefined()
  })

  it('is not offered with the AI side off', async () => {
    useWorkspace(false)
    const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)

    expect(wrapper.find('.abele-github-selection').text()).not.toContain('Ask here')
    expect(
      wrapper.find('.abele-github-header__actions [aria-label^="Chat about this"]').exists()
    ).toBe(false)
  })
})

describe('the bar under selected lines on a phone', () => {
  const platform = Platform as unknown as Record<string, boolean>

  it('is one row of named icons, and each still does its job', async () => {
    platform.isPhone = true
    try {
      const hash = await diffAnchorHash('src/app.ts')
      const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
      await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
      await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)

      const bar = wrapper.find('.abele-github-selection')
      expect(bar.findAll('button')).toHaveLength(0)
      const icons = bar.findAll('.abele-obsidian-icon')
      expect(icons.map((i) => i.attributes('aria-label'))).toEqual([
        'Copy link',
        'Insert into note',
        'Insert with code',
        'Ask here',
      ])

      await icons[3].trigger('click')
      await flushPromises()
      expect(askAboutGithub.mock.calls[0][0]).toEqual({
        label: 'o/r#7 · src/app.ts:2',
        url: `https://github.com/o/r/pull/7/files#diff-${hash}R2`,
      })
    } finally {
      platform.isPhone = false
    }
  })

  it('keeps its labelled buttons on a desktop', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    expect(wrapper.findAll('.abele-github-selection button').map((b) => b.text())).toEqual([
      'Copy link',
      'Insert into note',
      'Insert with code',
      'Ask here',
    ])
  })
})

describe('a drawn diff', () => {
  it('never says its file has no changes, selected or not', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    expect(wrapper.find('.abele-github-file__body').text()).not.toContain('No changes')

    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    expect(wrapper.find('.abele-github-file__body').text()).not.toContain('No changes')
  })
})

describe("the tab's more-options menu", () => {
  it('offers "Chat about this" once the item has loaded, and only then', async () => {
    const view = new GithubView(new WorkspaceLeaf())
    const titles = () => {
      const menu = new Menu()
      view.onPaneMenu(menu as never, 'more-options')
      return menu.items.map((i) => i.title)
    }
    expect(titles()).not.toContain('Chat about this')

    view.model.screen.link = { label: 'o/r#7 · Fix', url: 'https://github.com/o/r/pull/7' }
    expect(titles()).toContain('Chat about this')

    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false }
    expect(titles()).not.toContain('Chat about this')
  })
})

describe('"Chat about this" from the tab\'s menu or command', () => {
  it("quotes a file's selected lines, else links the item", async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/src/app.ts', {
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo\nthree' },
      '/repos/o/r/commits/main': { text: '0123456789abcdef0123456789abcdef01234567' },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))
    const view = new GithubView(new WorkspaceLeaf())
    view.model.screen = model.screen

    view.chatAbout()
    await vi.waitFor(() => expect(askAboutGithub).toHaveBeenCalledTimes(1))
    const [item, none] = askAboutGithub.mock.calls[0] as unknown as [unknown, unknown]
    expect([item, none]).toEqual([model.screen.link, undefined])

    await clickLineNumber(wrapper, '.cm-lineNumbers', 2)
    view.chatAbout()
    await vi.waitFor(() => expect(askAboutGithub).toHaveBeenCalledTimes(2))
    const [link, quote] = askAboutGithub.mock.calls[1] as unknown as [unknown, unknown]
    expect(await link).toEqual({
      label: 'o/r@0123456 · src/app.ts:2',
      url: 'https://github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/src/app.ts#L2',
    })
    expect(quote).toEqual({ code: 'two', path: 'src/app.ts' })
  })
})

describe('github_open', () => {
  it('shows owner/repo#n in a tab, as the issue link a pull request is also reached by', async () => {
    const out = await run(createGithubOpenTool(), { url: 'acme/widgets#7' })
    expect(opened.map((o) => o.url)).toEqual(['https://github.com/acme/widgets/issues/7'])
    expect(out).toContain('Shown in a GitHub tab')
  })

  it("marks lines in a pull request's file the way GitHub's own links do", async () => {
    const hash = await diffAnchorHash('src/app.ts')
    await run(createGithubOpenTool(), {
      url: 'https://github.com/acme/widgets/pull/7',
      path: 'src/app.ts',
      start_line: 10,
      end_line: 12,
    })
    expect(opened[0].url).toBe(`https://github.com/acme/widgets/pull/7/files#diff-${hash}R10-R12`)
  })

  it('marks lines of a file', async () => {
    await run(createGithubOpenTool(), {
      url: 'https://github.com/acme/widgets/blob/main/src/app.ts',
      start_line: 3,
    })
    expect(opened[0].url).toBe('https://github.com/acme/widgets/blob/main/src/app.ts#L3')
  })

  it('shows a folder', async () => {
    await run(createGithubOpenTool(), { url: 'https://github.com/acme/widgets/tree/main/src' })
    expect(opened[0].url).toBe('https://github.com/acme/widgets/tree/main/src')
    await expect(
      run(createGithubOpenTool(), {
        url: 'https://github.com/acme/widgets/tree/main/src',
        start_line: 3,
      })
    ).rejects.toThrow('Lines can be marked')
  })

  it('refuses what no tab can show', async () => {
    await expect(
      run(createGithubOpenTool(), { url: 'https://github.com/acme/widgets' })
    ).rejects.toThrow('not this link')
    expect(opened).toEqual([])
  })
})

describe('a rendered markdown file', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567'
  const ROUTES = {
    '/repos/o/r/contents/README.md': { text: '# Title\n\n- one\n- two\n' },
    '/repos/o/r/commits/main': { text: SHA },
  }

  it('records lines picked in the preview, and "Ask here" passes them on', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/README.md', ROUTES)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-md__block')).toHaveLength(3))
    const handles = wrapper.findAll('.abele-github-md__handle')
    await handles[1].trigger('click')
    await handles[2].trigger('click', { shiftKey: true })
    await flushPromises()

    expect(model.screen.selection).toEqual({
      path: 'README.md',
      label: 'Lines 3–4',
      code: '- one\n- two',
    })
    const ask = wrapper
      .findAll('.abele-github-selection button')
      .find((b) => b.text().includes('Ask here'))!
    await ask.trigger('click')
    await flushPromises()
    const [link, quote] = askAboutGithub.mock.calls.at(-1) as unknown as [unknown, unknown]
    expect([await link, quote]).toEqual([
      {
        label: 'o/r@0123456 · README.md:3–4',
        url: `https://github.com/o/r/blob/${SHA}/README.md?plain=1#L3-L4`,
      },
      { code: '- one\n- two', path: 'README.md' },
    ])
  })
})
