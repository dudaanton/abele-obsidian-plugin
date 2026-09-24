/**
 * Every place GitHub text is rendered goes through the one hardened renderer: an issue's
 * description and comments, a review comment beside its diff, a commit message, and a comment
 * quoted into a note as a card.
 *
 * The renderer mock stands in for Obsidian: it records the markdown it was handed and draws what
 * Obsidian would make of a hostile text — a `javascript:` link, an embed of a vault note, a code
 * span a plugin would read as a command. What is asserted is that none of it survives.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { MarkdownRenderer, type MarkdownPostProcessorContext } from 'obsidian'
import { ISSUE, PULL, file, openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { registerSnippetBlock } from '@/github/snippetCard'
import { formatSnippet } from '@/github/snippetBlock'
import { ZWSP } from '@/github/safeMarkdown'

const HOSTILE = [
  'Click [here](javascript:alert(1)), see ![[Secret note]] and `= this.file.name`.',
  '',
  '```dataviewjs',
  'dv.el("b", "ran")',
  '```',
  '',
  '![shot](docs/shot.png)',
].join('\n')

let seen: string[]

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  seen = []
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
    seen.push(markdown)
    const bad = document.createElement('a')
    bad.className = 'external-link'
    bad.setAttribute('href', 'javascript:alert(1)')
    bad.textContent = 'here'
    const note = document.createElement('span')
    note.className = 'internal-embed'
    note.setAttribute('src', 'Secret note')
    const shot = document.createElement('span')
    shot.className = 'internal-embed'
    shot.setAttribute('src', 'docs/shot.png')
    const code = document.createElement('code')
    code.textContent = /`([^`]*)`/.exec(markdown)?.[1] ?? ''
    el.append(bad, note, shot, code)
  })
})

afterEach(() => vi.restoreAllMocks())

/** What must hold of one rendered piece of GitHub text. */
function expectHardened(el: Element | null | undefined) {
  expect(el).toBeTruthy()
  const bad = el!.querySelector('a')!
  expect(bad.hasAttribute('href')).toBe(false)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  bad.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  expect(el!.querySelector('.internal-embed')).toBeNull()
  expect(el!.textContent).toContain('Secret note')
  expect(el!.querySelector('img')!.getAttribute('src')).toBe(
    'https://raw.githubusercontent.com/o/r/HEAD/docs/shot.png'
  )
  // The mark that kept plugins off the code span is gone once it is on screen.
  expect(el!.querySelector('code')!.textContent).toBe('= this.file.name')
}

function expectPrepared() {
  const text = seen.find((m) => m.includes('dv.el'))!
  expect(text).toContain('```text\ndv.el("b", "ran")')
  expect(text).not.toContain('```dataviewjs')
  expect(text).toContain(`\`${ZWSP}= this.file.name\``)
}

describe('GitHub text is rendered hardened', () => {
  it('in an issue: its description and its comments', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', {
      '/repos/o/r/issues/5': { json: { ...ISSUE, body: HOSTILE } },
      '/repos/o/r/issues/5/comments': {
        json: [{ id: 9, user: { login: 'ann' }, body: HOSTILE, created_at: '2026-01-02' }],
      },
    })
    await vi.waitFor(() =>
      expect(wrapper.findAll('.abele-github-comment__body img')).toHaveLength(2)
    )
    for (const body of wrapper.findAll('.abele-github-comment__body')) expectHardened(body.element)
    expectPrepared()
  })

  it('in a review comment beside its diff', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/7/files', {
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7/reviews': { json: [] },
      '/repos/o/r/pulls/7/comments': {
        json: [
          {
            id: 55,
            path: 'a.ts',
            user: { login: 'ann' },
            body: HOSTILE,
            created_at: '2026-01-03',
            side: 'RIGHT',
            line: 2,
          },
        ],
      },
      '/repos/o/r/pulls/7/files': { json: [file('a.ts')] },
    })
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-file .abele-github-comment__body img').exists()).toBe(true)
    )
    expectHardened(wrapper.find('.abele-github-file .abele-github-comment__body').element)
    expectPrepared()
  })

  it('in a commit message', async () => {
    const { wrapper } = open('https://github.com/o/r/commit/abc1234', {
      '/repos/o/r/commits/abc1234': {
        json: {
          sha: 'abc1234',
          commit: { message: `Fix it\n\n${HOSTILE}`, author: { name: 'ann', date: '2026-01-01' } },
          files: [],
        },
      },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github__message img').exists()).toBe(true))
    expectHardened(wrapper.find('.abele-github__message').element)
    expectPrepared()
  })

  it('in a comment kept in a note as a card', async () => {
    let handler: ((s: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) | null =
      null
    registerSnippetBlock((_lang, h) => (handler = h))
    const el = document.body.appendChild(document.createElement('div'))
    const ctx = { sourcePath: 'Plans.md', addChild: () => {} }
    const block = formatSnippet({
      url: 'https://github.com/o/r/issues/5#issuecomment-9',
      label: 'o/r#5 · comment by ann',
      kind: 'comment',
      text: HOSTILE,
    })
    handler!(block.split('\n').slice(1, -1).join('\n'), el, ctx as never)
    await vi.waitFor(() =>
      expect(el.querySelector('.abele-github-snippet__quote img')).toBeTruthy()
    )
    await flushPromises()
    expectHardened(el.querySelector('.abele-github-snippet__quote'))
    expectPrepared()
  })
})
