/**
 * The card an `abele-github` block in a note is drawn as, and the buttons in a GitHub tab that
 * write one.
 *
 * The card is asserted by what reaches the DOM: the label as a link to the place, the code with
 * the numbers it had in the file, a diff's added and removed lines, a comment as markdown — and
 * a block edited into nonsense shown as written rather than as an error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { MarkdownView, Notice, TFile, type MarkdownPostProcessorContext } from 'obsidian'
import { registerSnippetBlock } from '@/github/snippetCard'
import { formatSnippet, parseSnippet, type SnippetBlock } from '@/github/snippetBlock'
import { parseGithubUrl } from '@/github/urls'
import { PULL, file, openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

const HOST = 'github.example.com'
const SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'

function render(source: string) {
  let handler: ((s: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) | null =
    null
  registerSnippetBlock((lang, h) => {
    expect(lang).toBe('abele-github')
    handler = h
  })
  const el = document.body.appendChild(document.createElement('div'))
  const children: unknown[] = []
  const ctx = { sourcePath: 'Plans.md', addChild: (c: unknown) => children.push(c) }
  handler!(source, el, ctx as unknown as MarkdownPostProcessorContext)
  return { el, children }
}

const inner = (s: SnippetBlock) => formatSnippet(s).split('\n').slice(1, -1).join('\n')
const texts = (el: Element, selector: string) =>
  [...el.querySelectorAll(selector)].map((n) => n.textContent)

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  Notice.shown.length = 0
})

describe('the card in a note', () => {
  it('lines of a file: the label links to them, the numbers start where the lines did', async () => {
    const url = `https://${HOST}/acme/widgets/blob/${SHA}/src/app.ts#L10-L12`
    const { el } = render(
      inner({
        url,
        label: 'acme/widgets@1a2b3c4 · src/app.ts:10–12',
        kind: 'code',
        lang: 'ts',
        start: 10,
        text: 'const a = 1\nconst b = 2\nconst c = 3',
      })
    )
    await flushPromises()

    const title = el.querySelector('a.abele-card__name')!
    expect(title.getAttribute('href')).toBe(url)
    expect(title.textContent).toBe('acme/widgets@1a2b3c4 · src/app.ts:10–12')
    expect(parseGithubUrl(title.getAttribute('href')!, [HOST])).toMatchObject({
      lines: { start: 10, end: 12 },
    })
    expect(texts(el, '.cm-line')).toEqual(['const a = 1', 'const b = 2', 'const c = 3'])
    expect(
      texts(el, '.cm-lineNumbers .cm-gutterElement').filter((t) => /^\d+$/.test(t!))
    ).toContain('10')
    expect(texts(el, '.cm-lineNumbers .cm-gutterElement')).not.toContain('1')
  })

  it('lines of a diff: added and removed lines coloured, numbered on both sides', async () => {
    const { el } = render(
      inner({
        url: `https://${HOST}/acme/widgets/pull/42/files#diff-${'a'.repeat(64)}R11`,
        label: 'x',
        kind: 'diff',
        lang: 'ts',
        text: '@@ -11 +11 @@\n-old\n+new\n same',
      })
    )
    await flushPromises()

    expect(texts(el, '.abele-github-code__line_del')).toEqual(['old'])
    expect(texts(el, '.abele-github-code__line_add')).toEqual(['new'])
    expect(texts(el, '.abele-github-code__gutter_old .cm-gutterElement')).toEqual(
      expect.arrayContaining(['11', '12'])
    )
    expect(texts(el, '.abele-github-code__gutter_new .cm-gutterElement')).toEqual(
      expect.arrayContaining(['11', '12'])
    )
  })

  it('a comment: its text as markdown, no code view', async () => {
    const { el } = render(
      inner({
        url: `https://${HOST}/acme/widgets/pull/42#issuecomment-5`,
        label: 'acme/widgets#42 · comment by alice',
        kind: 'comment',
        text: '**alice** · 2 Sep 2026\n\nLooks good.',
      })
    )
    await flushPromises()
    expect(el.querySelector('.abele-github-snippet__quote')?.textContent).toContain('Looks good.')
    expect(el.querySelector('.cm-editor')).toBeNull()
  })

  it('a block edited into nonsense is shown as written, not as an error', () => {
    const { el } = render('lang: ts\nsome code the person pasted')
    expect(el.querySelector('.abele-card')).toBeNull()
    expect(el.querySelector('pre')?.textContent).toBe('lang: ts\nsome code the person pasted')
  })

  it('is unmounted with the note', () => {
    const { children } = render('url: x\nlabel: y\n---\nz')
    expect(children).toHaveLength(1)
  })
})

/** A note open in a pane, with a cursor, holding its text as lines. */
function openNote(lines: string[], cursorLine: number) {
  const view = Object.create(MarkdownView.prototype) as MarkdownView
  let cursor = { line: cursorLine, ch: 0 }
  const editor = {
    getCursor: () => cursor,
    setCursor: (at: { line: number; ch: number }) => (cursor = at),
    getLine: (n: number) => lines[n],
    lineCount: () => lines.length,
    replaceRange: (text: string, at: { line: number; ch: number }) => {
      let offset = 0
      for (let i = 0; i < at.line; i++) offset += lines[i].length + 1
      const joined = lines.join('\n')
      lines.splice(
        0,
        lines.length,
        ...(joined.slice(0, offset + at.ch) + text + joined.slice(offset + at.ch)).split('\n')
      )
    },
  }
  Object.assign(view, {
    file: Object.assign(new TFile(), { path: 'Plans.md', basename: 'Plans' }),
    editor,
  })
  const app = useVault([]) as unknown as Record<string, unknown>
  app.workspace = {
    getLeavesOfType: (t: string) => (t === 'markdown' ? [{ view, activeTime: 1 }] : []),
  }
  return lines
}

/** The block the note now holds, read back. */
function blockIn(lines: string[]): SnippetBlock | null {
  const text = lines.join('\n')
  const m = /(`{3,})abele-github\n([\s\S]*?)\n\1/.exec(text)
  return m ? parseSnippet(m[2]) : null
}

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

describe('writing a card from a GitHub tab', () => {
  it('lines of a diff, with their signs and numbers', async () => {
    const note = openNote(['# Plans', 'Text', '', 'More'], 1)
    const { wrapper } = open('https://github.com/o/r/pull/7/files', {
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7/reviews': { json: [] },
      '/repos/o/r/pulls/7/comments': { json: [] },
      '/repos/o/r/pulls/7/files': { json: [file('src/app.ts')] },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))

    // " a", "-b", "+c": view lines 2–4.
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 2)
    await clickLineNumber(wrapper, '.abele-github-code__gutter_new', 4, true, 40)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    const insert = wrapper
      .findAll('.abele-github-selection button')
      .find((b) => b.text() === 'Insert with code')!
    await insert.trigger('click')
    await flushPromises()

    expect(note.slice(0, 3)).toEqual(['# Plans', 'Text', ''])
    // No second blank line after it, and nothing lost.
    expect(note.slice(-3)).toEqual(['```', '', 'More'])
    const block = blockIn(note)
    expect(block).toMatchObject({ kind: 'diff', lang: 'ts', text: '@@ -1 +1 @@\n a\n-b\n+c' })
    expect(parseGithubUrl(block!.url, ['github.com'])).toMatchObject({
      kind: 'pull',
      tab: 'files',
      file: { side: 'R', line: 1, endLine: 2 },
    })
    expect(Notice.shown).toContain('Added to Plans')
  })

  it('lines of a file, pinned to the commit, starting at their own number', async () => {
    const note = openNote([''], 0)
    const { wrapper } = open('https://github.com/o/r/blob/main/src/app.ts', {
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo\nthree\nfour' },
      '/repos/o/r/commits/main': { text: SHA },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-editor').exists()).toBe(true))

    await clickLineNumber(wrapper, '.cm-lineNumbers', 2)
    await clickLineNumber(wrapper, '.cm-lineNumbers', 3, true, 40)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-selection').exists()).toBe(true))
    await wrapper
      .findAll('.abele-github-selection button')
      .find((b) => b.text() === 'Insert with code')!
      .trigger('click')
    await vi.waitFor(() => expect(blockIn(note)).not.toBeNull())

    expect(blockIn(note)).toEqual({
      url: `https://github.com/o/r/blob/${SHA}/src/app.ts#L2-L3`,
      label: 'o/r@1a2b3c4 · src/app.ts:2–3',
      kind: 'code',
      lang: 'ts',
      start: 2,
      text: 'two\nthree',
    })
  })

  it('a comment, as a quote with who wrote it', async () => {
    const note = openNote([''], 0)
    const { wrapper } = open('https://github.com/o/r/issues/5', {
      '/repos/o/r/issues/5': {
        json: {
          title: 'Crash',
          number: 5,
          html_url: 'x',
          user: { login: 'bob' },
          created_at: '2026-01-01T10:00:00Z',
          state: 'open',
          labels: [],
          body: 'It crashes.',
        },
      },
      '/repos/o/r/issues/5/comments': {
        json: [
          { id: 9, user: { login: 'ann' }, body: 'Same here', created_at: '2026-01-02T10:00:00Z' },
        ],
      },
    })
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-link-actions')).toHaveLength(2))

    await wrapper
      .findAll('.abele-github-link-actions')[1]
      .findAll('.abele-obsidian-icon')[2]
      .trigger('click')
    await flushPromises()

    const block = blockIn(note)!
    expect(block).toMatchObject({
      kind: 'comment',
      label: 'o/r#5 · comment by ann',
      url: 'https://github.com/o/r/issues/5#issuecomment-9',
    })
    expect(block.text).toMatch(/^\*\*ann\*\* · 2 Jan 2026/)
    expect(block.text.endsWith('\n\nSame here')).toBe(true)
  })
})
