/**
 * Words selected in a GitHub tab's prose — a discussion's comments and replies, a description —
 * and what can be done with them: ask about them in a new chat with a link to the exact comment
 * and the words quoted, copy that link, quote them into the note. `github_views` reports them, so
 * an agent asked "what does this mean" sees what "this" is.
 *
 * The owner, reading a discussion: selecting text offered nothing to ask the agent with.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { Menu, Platform } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { githubChatText } from '@/github/chatAbout'
import { createGithubViewsTool } from '@/ai/tools/github/ViewTools'
import { proseSnippet } from '@/github/proseSelection'
import type { GithubViewModel } from '@/github/model'
import { openTab } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

const { askAboutGithub } = vi.hoisted(() => ({ askAboutGithub: vi.fn(async () => {}) }))
vi.mock('@/github/chatAbout', async (real) => ({
  ...(await real<typeof import('@/github/chatAbout')>()),
  askAboutGithub,
}))

const DISCUSSION = {
  '/graphql': {
    json: {
      data: {
        repository: {
          discussion: {
            title: 'How should paging work?',
            number: 3,
            url: 'https://github.com/o/r/discussions/3',
            body: 'Pages of fifty, or of a hundred?',
            createdAt: '2026-01-01T10:00:00Z',
            isAnswered: true,
            closed: false,
            author: { login: 'carol' },
            category: { name: 'Ideas' },
            labels: { nodes: [] },
            comments: {
              totalCount: 2,
              nodes: [
                {
                  id: 'c1',
                  databaseId: 301,
                  body: 'Fifty reads better on a phone.',
                  createdAt: '2026-01-02T10:00:00Z',
                  isAnswer: true,
                  author: { login: 'dave' },
                  replies: {
                    totalCount: 1,
                    nodes: [
                      {
                        id: 'r1',
                        databaseId: 302,
                        body: 'Agreed.',
                        createdAt: '2026-01-02T11:00:00Z',
                        author: { login: 'bob' },
                      },
                    ],
                  },
                },
                {
                  id: 'c2',
                  databaseId: 303,
                  body: 'A hundred is fewer requests.',
                  createdAt: '2026-01-03T10:00:00Z',
                  isAnswer: false,
                  author: { login: 'erin' },
                  replies: { totalCount: 0, nodes: [] },
                },
              ],
            },
          },
        },
      },
    },
  },
}

const URL = 'https://github.com/o/r/discussions/3'

let leaves: { view: { model: GithubViewModel; containerEl: { isShown: () => boolean } } }[]

beforeEach(() => {
  const app = useVault([]) as unknown as Record<string, unknown>
  leaves = []
  app.workspace = { getLeavesOfType: (type: string) => (type === 'abele-github' ? leaves : []) }
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true }
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
  askAboutGithub.mockClear()
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
})

afterEach(() => {
  Platform.isPhone = false
  Platform.isMobile = false
})

/** The text node holding `words`, inside the element `selector` finds whose text has them. */
function textNode(w: VueWrapper, selector: string, words: string): Text {
  const el = w.findAll(selector).find((e) => e.text().includes(words))
  if (!el) throw new Error(`no ${selector} with "${words}"`)
  const walker = document.createTreeWalker(el.element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.data.includes(words)) return node
  }
  throw new Error(`"${words}" is not in one text node`)
}

/** Selects `words` as a person would — a range in the page — and lets the tab hear of it. */
async function select(from: Text, fromAt: number, to: Text, toAt: number) {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(from, fromAt)
  range.setEnd(to, toAt)
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await new Promise((r) => setTimeout(r, 450))
  await flushPromises()
}

async function selectWords(w: VueWrapper, selector: string, words: string) {
  const node = textNode(w, selector, words)
  const at = node.data.indexOf(words)
  await select(node, at, node, at + words.length)
}

async function openDiscussion() {
  const tab = openTab(URL, DISCUSSION)
  await vi.waitFor(() => expect(tab.wrapper.findAll('.abele-github-comment').length).toBe(4))
  return tab
}

const bar = (w: VueWrapper) => w.find('.abele-github-prose')

describe('words selected in a discussion comment', () => {
  it('bring up the bar, and "Ask here" links the comment and quotes the words', async () => {
    const { wrapper } = await openDiscussion()
    expect(bar(wrapper).exists()).toBe(false)

    await selectWords(wrapper, '.abele-github-comment__body', 'reads better')
    expect(bar(wrapper).exists()).toBe(true)

    const ask = bar(wrapper)
      .findAll('button')
      .find((b) => b.text().includes('Ask here'))!
    await ask.trigger('click')
    await flushPromises()

    const [link, quote] = askAboutGithub.mock.calls[0] as unknown as [
      { label: string; url: string },
      { text: string },
    ]
    expect(link).toEqual({
      label: 'o/r#3 · comment by dave',
      url: 'https://github.com/o/r/discussions/3#discussioncomment-301',
    })
    expect(quote).toEqual({ text: 'reads better' })
    expect(githubChatText(link, quote)).toBe(
      '[o/r#3 · comment by dave](https://github.com/o/r/discussions/3#discussioncomment-301)\n' +
        '> reads better\n\n'
    )
  })

  it('in a reply, link the reply', async () => {
    const { wrapper, model } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment_reply .abele-github-comment__body', 'Agreed')
    expect(model.screen.prose).toMatchObject({
      text: 'Agreed',
      where: 'the reply by bob',
      author: 'bob',
      anchor: 'discussioncomment-302',
      link: { url: 'https://github.com/o/r/discussions/3#discussioncomment-302' },
    })
    // Into the note as a quote card: who wrote it, and only the words selected.
    const card = proseSnippet(model.screen.prose!)
    expect(card).toMatchObject({ kind: 'comment', label: 'o/r#3 · reply by bob' })
    expect(card.text).toMatch(/^\*\*bob\*\* · .+\n\nAgreed$/)
  })

  it('in the description, link the item itself', async () => {
    const { wrapper, model } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment__body', 'Pages of fifty')
    expect(model.screen.prose).toMatchObject({
      text: 'Pages of fifty',
      where: "the discussion's description",
      link: {
        label: 'o/r#3 · How should paging work?',
        url: 'https://github.com/o/r/discussions/3',
      },
    })
    expect(model.screen.prose?.anchor).toBeUndefined()
  })

  it('across two comments, link the item and say which comments they run through', async () => {
    const { wrapper, model } = await openDiscussion()
    const from = textNode(wrapper, '.abele-github-comment__body', 'Fifty reads')
    const to = textNode(wrapper, '.abele-github-comment__body', 'A hundred')
    await select(from, 0, to, 'A hundred'.length)

    const prose = model.screen.prose!
    expect(prose.link.url).toBe('https://github.com/o/r/discussions/3')
    expect(prose.spans).toEqual(['the comment by dave', 'the reply by bob', 'the comment by erin'])

    await bar(wrapper)
      .findAll('button')
      .find((b) => b.text().includes('Ask here'))!
      .trigger('click')
    await vi.waitFor(() => expect(askAboutGithub).toHaveBeenCalled())
    const [link, quote] = askAboutGithub.mock.calls[0] as unknown as [
      { label: string; url: string },
      { text: string; note: string },
    ]
    expect(githubChatText(link, quote)).toMatch(
      /^\[o\/r#3 · How should paging work\?\]\(https:\/\/github\.com\/o\/r\/discussions\/3\)\nAcross the comment by dave, the reply by bob and the comment by erin:\n> Fifty[\s\S]*A hundred\n\n$/
    )
  })

  it('a right-click offers the same in a menu', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const { wrapper } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment__body', 'fewer requests')
    const target = textNode(wrapper, '.abele-github-comment__body', 'fewer requests').parentElement!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    const menu = shown.mock.contexts[0] as unknown as Menu & { items: { title: string }[] }
    expect(menu.items.map((i) => i.title)).toEqual([
      'Copy',
      'Ask here',
      'Copy link to this',
      'Insert as quote',
    ])
    shown.mockRestore()
  })

  it('go when a click lets them go in the tab, but stay while the person is in the chat', async () => {
    const { wrapper, model } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment__body', 'reads better')
    expect(model.screen.prose?.text).toBe('reads better')

    // Over in the chat to type the question: the selection is somewhere else now.
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.append(outside)
    await select(outside.firstChild as Text, 0, outside.firstChild as Text, 4)
    expect(bar(wrapper).exists()).toBe(false)
    expect(model.screen.prose?.text).toBe('reads better')

    // A click back in the tab: the selection is gone.
    const inside = textNode(wrapper, '.abele-github-comment__body', 'Agreed')
    await select(inside, 1, inside, 1)
    expect(model.screen.prose).toBeNull()
  })

  it('are what github_views tells an agent', async () => {
    const { wrapper, model } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment_reply .abele-github-comment__body', 'Agreed')
    leaves = [{ view: { model, containerEl: { isShown: () => true } } }]

    const out = (await createGithubViewsTool().execute('call-1', {})).content[0].text
    expect(out).toContain('[on screen] Discussion')
    expect(out).toContain('How should paging work?')
    expect(out).toContain(
      'Selected text in the reply by bob (#discussioncomment-302) — https://github.com/o/r/discussions/3#discussioncomment-302'
    )
    expect(out).toContain('   > Agreed')
  })

  it('in code are left to the line selection', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/src/app.ts', {
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo\nthree' },
    })
    await vi.waitFor(() => expect(wrapper.find('.cm-content').exists()).toBe(true))
    const line = textNode(wrapper, '.cm-line', 'two')
    await select(line, 0, line, 3)
    expect(bar(wrapper).exists()).toBe(false)
    expect(model.screen.prose).toBeNull()
  })
})

describe('on a phone', () => {
  it('a touch selection brings up the bar, as icons and "Ask here", under the words', async () => {
    Platform.isPhone = true
    Platform.isMobile = true
    const { wrapper } = await openDiscussion()
    await selectWords(wrapper, '.abele-github-comment__body', 'reads better')

    expect(bar(wrapper).exists()).toBe(true)
    expect(bar(wrapper).text()).toContain('Ask here')
    expect(bar(wrapper).findAll('.abele-obsidian-icon_with-bg')).toHaveLength(2)
  })
})

describe("words selected in a folder's README", () => {
  it('are asked about with a link to the README file, not the folder', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/tree/main/src', {
      '/repos/o/r/contents/src': {
        json: [
          { name: 'app.ts', path: 'src/app.ts', type: 'file', size: 300 },
          { name: 'README.md', path: 'src/README.md', type: 'file', size: 64 },
        ],
      },
      '/repos/o/r/contents/src/README.md': { text: 'The helpers live here.' },
    })
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-folder__readme .abele-github-text').text()).toContain(
        'live here'
      )
    )
    await selectWords(wrapper, '.abele-github-folder__readme .abele-github-text', 'live here')

    expect(model.screen.prose).toMatchObject({
      text: 'live here',
      where: 'the README',
      link: {
        label: 'o/r@main · src/README.md',
        url: 'https://github.com/o/r/blob/main/src/README.md',
      },
    })
    await bar(wrapper)
      .findAll('button')
      .find((b) => b.text().includes('Ask here'))!
      .trigger('click')
    await vi.waitFor(() => expect(askAboutGithub).toHaveBeenCalled())
    const [link] = askAboutGithub.mock.calls[0] as unknown as [{ url: string }]
    expect(link.url).toBe('https://github.com/o/r/blob/main/src/README.md')
  })
})
