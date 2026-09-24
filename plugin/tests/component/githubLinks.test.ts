/**
 * Links made from inside a GitHub tab — to a comment, to the item, to lines of a diff or a file —
 * copied, or written into the note last worked in.
 *
 * What is asserted is the markdown that reaches the clipboard or the note. That every one of
 * these URLs opens back into the tab is pinned in `githubPermalinks.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { MarkdownView, Notice, TFile } from 'obsidian'
import { diffAnchorHash } from '@/github/urls'
import { ISSUE, PULL, file, openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

let writeText: ReturnType<typeof vi.fn>

/** A note open in a pane, with a cursor, holding its text as lines. */
function openNote(lines: string[], cursorLine: number) {
  const view = Object.create(MarkdownView.prototype) as MarkdownView
  const file = Object.assign(new TFile(), { path: 'Plans.md', basename: 'Plans' })
  let cursor = { line: cursorLine, ch: 0 }
  const editor = {
    getCursor: () => cursor,
    setCursor: (at: { line: number; ch: number }) => (cursor = at),
    getLine: (n: number) => lines[n],
    replaceRange: (text: string, at: { line: number; ch: number }) => {
      let offset = 0
      for (let i = 0; i < at.line; i++) offset += lines[i].length + 1
      const joined = lines.join('\n')
      const next = joined.slice(0, offset + at.ch) + text + joined.slice(offset + at.ch)
      lines.splice(0, lines.length, ...next.split('\n'))
    },
  }
  Object.assign(view, { file, editor })
  return { view, lines, cursor: () => cursor }
}

function withNotes(...views: MarkdownView[]) {
  const app = useVault([]) as unknown as Record<string, unknown>
  app.workspace = {
    getLeavesOfType: (type: string) =>
      type === 'markdown' ? views.map((view, i) => ({ view, activeTime: i })) : [],
  }
}

const ISSUE_ROUTES = {
  '/repos/o/r/issues/5': { json: ISSUE },
  '/repos/o/r/issues/5/comments': {
    json: [{ id: 9, user: { login: 'ann' }, body: 'Same here', created_at: '2026-01-02' }],
  },
}

const press = async (w: VueWrapper, selector: string, index = 0) => {
  await w.findAll(selector)[index].trigger('click')
  await flushPromises()
}

beforeEach(() => {
  withNotes()
  document.body.replaceChildren()
  Notice.shown.length = 0
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('a comment and the item itself', () => {
  it('copy a markdown link each, labelled with who wrote it or what it is', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', ISSUE_ROUTES)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-link-actions')).toHaveLength(2))

    const copies = '.abele-github-link-actions .abele-obsidian-icon:first-child'
    await press(wrapper, copies, 0)
    await press(wrapper, copies, 1)

    expect(writeText.mock.calls.map((c) => c[0])).toEqual([
      '[o/r#5 · Crash on start](https://github.com/o/r/issues/5)',
      '[o/r#5 · comment by ann](https://github.com/o/r/issues/5#issuecomment-9)',
    ])
    expect(Notice.shown).toContain('Link copied')
  })

  it('insert the link into the note last worked in, on a line of its own', async () => {
    const other = openNote(['Older'], 0)
    const note = openNote(['# Plans', 'A paragraph', 'More'], 1)
    withNotes(other.view, note.view)
    const { wrapper } = open('https://github.com/o/r/issues/5', ISSUE_ROUTES)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-link-actions')).toHaveLength(2))

    await press(wrapper, '.abele-github-link-actions .abele-obsidian-icon:last-child', 1)

    expect(note.lines).toEqual([
      '# Plans',
      'A paragraph',
      '[o/r#5 · comment by ann](https://github.com/o/r/issues/5#issuecomment-9)',
      'More',
    ])
    // The cursor follows, so a second link goes under the first.
    expect(note.cursor()).toEqual({ line: 2, ch: note.lines[2].length })
    expect(other.lines).toEqual(['Older'])
    expect(Notice.shown).toContain('Link added to Plans')
  })

  it('says so when no note is open, and writes nothing', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', ISSUE_ROUTES)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-link-actions')).toHaveLength(2))

    await press(wrapper, '.abele-github-link-actions .abele-obsidian-icon:last-child', 0)

    expect(Notice.shown).toContain('Open a note to put the link in')
  })
})

/**
 * A click on a line number, where CodeMirror looks for it: by height. happy-dom lays nothing out,
 * so CodeMirror's estimate of 14 px a line is what the height is read against.
 */
async function clickLineNumber(
  w: VueWrapper,
  gutter: string,
  line: number,
  shift = false,
  /** Height taken above the line by a bar already drawn, estimated at 40. */
  above = 0
) {
  const el = w.find(gutter).element
  const clientY = 14 * (line - 1) + 7 + above
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY, shiftKey: shift }))
  await flushPromises()
}

describe('lines of a diff', () => {
  it('a click on a line number marks it and offers its link', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const { wrapper } = open(`https://github.com/o/r/pull/7/files`, {
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7/reviews': { json: [] },
      '/repos/o/r/pulls/7/comments': { json: [] },
      '/repos/o/r/pulls/7/files': { json: [file('src/app.ts')] },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))

    // Lines: the hunk header, " a", "-b", "+c", "+d". Line 4 is "+c", new line 2.
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Line 2')

    await press(wrapper, '.abele-github-selection button', 0)
    expect(writeText).toHaveBeenLastCalledWith(
      `[o/r#7 · src/app.ts:2](https://github.com/o/r/pull/7/files#diff-${hash}R2)`
    )
  })
})

describe('lines of a file', () => {
  it('link to the commit the file was read at, not the branch', async () => {
    const SHA = '0123456789abcdef0123456789abcdef01234567'
    const commits = vi.fn(() => ({ text: `${SHA}\n` }))
    const { wrapper } = open('https://github.com/o/r/blob/main/src/app.ts#L2', {
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo\nthree\nfour' },
      '/repos/o/r/commits/main': commits,
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))

    await clickLineNumber(wrapper, '.cm-lineNumbers', 2)
    // The bar now sits under line 2, between it and line 3.
    await clickLineNumber(wrapper, '.cm-lineNumbers', 3, true, 40)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    expect(wrapper.find('.abele-github-selection__label').text()).toBe('Lines 2–3')

    await press(wrapper, '.abele-github-selection button', 0)
    await press(wrapper, '.abele-github-selection button', 0)
    expect(writeText.mock.calls.map((c) => c[0])).toEqual([
      `[o/r@0123456 · src/app.ts:2–3](https://github.com/o/r/blob/${SHA}/src/app.ts#L2-L3)`,
      `[o/r@0123456 · src/app.ts:2–3](https://github.com/o/r/blob/${SHA}/src/app.ts#L2-L3)`,
    ])
    // The branch is asked about once per tab.
    expect(commits).toHaveBeenCalledTimes(1)
  })
})
