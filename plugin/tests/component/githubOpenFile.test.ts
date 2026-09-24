/**
 * A changed file of a pull request or a commit, opened whole from its diff: the header's "Open
 * file" button and the path beside it both open the file at the commit the diff is of — the base
 * for a file the change deleted — at the lines selected in the diff, if any.
 *
 * happy-dom lays nothing out, so "the line in view" is pinned in `githubOpenFile.test.ts` of the
 * unit tier and in the running app; here nothing is scrolled into a diff.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { PULL, file, openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const COMMIT = 'c'.repeat(40)
const PARENT = 'd'.repeat(40)

const pullRoutes = (files: unknown[]) => ({
  '/repos/o/r/pulls/7': {
    json: { ...PULL, base: { ref: 'main', sha: BASE }, head: { label: 'ann:fix', sha: HEAD } },
  },
  '/repos/o/r/issues/7/comments': { json: [] },
  '/repos/o/r/pulls/7/reviews': { json: [] },
  '/repos/o/r/pulls/7/comments': { json: [] },
  '/repos/o/r/pulls/7/files': { json: files },
})

const removed = (name: string) => ({
  ...file(name, '@@ -1,2 +0,0 @@\n-a\n-b'),
  status: 'removed',
  additions: 0,
  deletions: 2,
})

const fileEl = (w: VueWrapper, path: string) => {
  const found = w.findAll('.abele-github-file').find((f) => f.attributes('data-path') === path)
  if (!found) throw new Error(`no file ${path}`)
  return found
}

async function clickLineNumber(w: VueWrapper, path: string, line: number) {
  const el = fileEl(w, path).find('.abele-github-code__gutter_new').element
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 14 * (line - 1) + 7 }))
  await flushPromises()
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

describe('a file of a pull request', () => {
  const r = pullRoutes([file('src/app.ts'), removed('old/gone.ts'), file('docs/guide.md')])

  it('opens whole at the head commit, reusing the tab', async () => {
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(3))

    await fileEl(wrapper, 'src/app.ts').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(`https://github.com/o/r/blob/${HEAD}/src/app.ts`, false)
    // The press opens the file; it does not fold the diff it sits on.
    expect(fileEl(wrapper, 'src/app.ts').find('.cm-editor').exists()).toBe(true)
  })

  it('opens in a new tab on a Mod-click', async () => {
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(3))

    await fileEl(wrapper, 'src/app.ts')
      .find('.abele-github-file__open')
      .trigger('click', { metaKey: true })
    expect(onOpen).toHaveBeenLastCalledWith(`https://github.com/o/r/blob/${HEAD}/src/app.ts`, 'tab')
  })

  it('goes to the browser on an Alt-click', async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(3))

    await fileEl(wrapper, 'src/app.ts')
      .find('.abele-github-file__open')
      .trigger('click', { altKey: true })
    expect(onOpen).not.toHaveBeenCalled()
    expect(opened).toHaveBeenCalledWith(`https://github.com/o/r/blob/${HEAD}/src/app.ts`)
    opened.mockRestore()
  })

  it('opens a deleted file at the base, where it still exists', async () => {
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(3))

    await fileEl(wrapper, 'old/gone.ts').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${BASE}/old/gone.ts`,
      false
    )
  })

  it('opens at the lines selected in the diff', async () => {
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.cm-editor')).toHaveLength(3))

    // Lines: the hunk header, " a", "-b", "+c", "+d". Line 4 is "+c", new line 2.
    await clickLineNumber(wrapper, 'src/app.ts', 4)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))

    await fileEl(wrapper, 'src/app.ts').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${HEAD}/src/app.ts#L2`,
      false
    )
  })

  it('opens a markdown file rendered, and as code at a selected line', async () => {
    const { wrapper, onOpen } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.cm-editor')).toHaveLength(3))

    await fileEl(wrapper, 'docs/guide.md').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${HEAD}/docs/guide.md`,
      false
    )

    await clickLineNumber(wrapper, 'docs/guide.md', 5)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    await fileEl(wrapper, 'docs/guide.md').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${HEAD}/docs/guide.md?plain=1#L3`,
      false
    )
  })

  it('makes the path a link to the same place, without folding the diff', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/7/files', r)
    await vi.waitFor(() => expect(wrapper.findAll('.cm-editor')).toHaveLength(3))

    const link = fileEl(wrapper, 'src/app.ts').find('a.abele-github-file__path-link')
    // The file's name is the link to it; the folder before it, a link to the folder.
    expect(fileEl(wrapper, 'src/app.ts').find('.abele-github-file__path').text()).toBe('src/app.ts')
    expect(link.text()).toBe('app.ts')
    expect(link.attributes('href')).toBe(`https://github.com/o/r/blob/${HEAD}/src/app.ts`)

    await clickLineNumber(wrapper, 'src/app.ts', 4)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    // Brought up to date the moment the pointer comes down, before the click reads it.
    await link.trigger('pointerdown')
    expect(link.attributes('href')).toBe(`https://github.com/o/r/blob/${HEAD}/src/app.ts#L2`)

    await link.trigger('click')
    expect(fileEl(wrapper, 'src/app.ts').find('.cm-editor').exists()).toBe(true)
  })
})

describe('a file of a commit', () => {
  const routes = {
    [`/repos/o/r/commits/${COMMIT}`]: {
      json: {
        sha: COMMIT,
        html_url: `https://github.com/o/r/commit/${COMMIT}`,
        commit: { message: 'Tidy', author: { name: 'ann', date: '2026-01-02' } },
        parents: [{ sha: PARENT }],
        files: [file('src/app.ts'), removed('old/gone.ts')],
      },
    },
  }

  it('opens at the commit, and a deleted one at its parent', async () => {
    const { wrapper, onOpen } = open(`https://github.com/o/r/commit/${COMMIT}`, routes)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(2))

    await fileEl(wrapper, 'src/app.ts').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${COMMIT}/src/app.ts`,
      false
    )
    await fileEl(wrapper, 'old/gone.ts').find('.abele-github-file__open').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/blob/${PARENT}/old/gone.ts`,
      false
    )
  })
})
