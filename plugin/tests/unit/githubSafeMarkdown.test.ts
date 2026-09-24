/**
 * GitHub text rendered anywhere in the plugin — a comment, a description, a commit message, a
 * quoted comment in a note, a rendered file — goes through one renderer, which keeps what someone
 * else wrote from acting inside the vault.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MarkdownRenderer, Component } from 'obsidian'
import {
  ZWSP,
  guardInlineCode,
  prepareGithubMarkdown,
  renderGithubMarkdown,
  repoOfUrl,
  githubMarkdownClick,
} from '@/github/safeMarkdown'
import type { RepoFile } from '@/github/markdownLinks'

const md = (...lines: string[]) => lines.join('\n')
const REPO: RepoFile = { host: 'github.com', owner: 'acme', repo: 'widgets', ref: 'HEAD', path: '' }

afterEach(() => vi.restoreAllMocks())

describe('inline code, which other plugins read as commands', () => {
  it('starts with an invisible mark, so a Dataview `= …` or `$= …` is not taken as a query', () => {
    expect(guardInlineCode('Today is `= date(today)` and `$= dv.el("b")`.')).toBe(
      `Today is \`${ZWSP}= date(today)\` and \`${ZWSP}$= dv.el("b")\`.`
    )
  })

  it('keeps the one space a padded span strips, and longer backtick runs', () => {
    expect(guardInlineCode('`` `a` `` and ` x `')).toBe(`\`\` ${ZWSP}\`a\` \`\` and \` ${ZWSP}x \``)
  })

  it('leaves fenced code alone, also inside a list or a quote', () => {
    const text = md('- item', '  ```', '  `= x`', '  ```', '> ```', '> `y`', '> ```', '`z`')
    expect(guardInlineCode(text)).toBe(
      md('- item', '  ```', '  `= x`', '  ```', '> ```', '> `y`', '> ```', `\`${ZWSP}z\``)
    )
  })

  it('a span across two lines is still one span', () => {
    expect(guardInlineCode(md('`a', 'b`'))).toBe(md(`\`${ZWSP}a`, 'b`'))
  })
})

describe('the text handed to the renderer', () => {
  it('has plugin-only fences as plain text and inline code guarded', () => {
    expect(prepareGithubMarkdown(md('```dataviewjs', 'dv.el("b")', '```', '`= 1`'))).toBe(
      md('```text', 'dv.el("b")', '```', `\`${ZWSP}= 1\``)
    )
  })
})

describe('rendering', () => {
  it('renders the prepared text, then points links at the repository and takes the mark out', async () => {
    const seen: string[] = []
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
      seen.push(markdown)
      const code = document.createElement('code')
      code.textContent = `${ZWSP}= date(today)`
      const bad = document.createElement('a')
      bad.setAttribute('href', 'javascript:alert(1)')
      const embed = document.createElement('span')
      embed.className = 'internal-embed'
      embed.setAttribute('src', 'img/shot.png')
      el.append(code, bad, embed)
    })
    const el = document.createElement('div')
    await renderGithubMarkdown(el, 'Text `= date(today)`', REPO, new Component())

    expect(seen).toEqual([`Text \`${ZWSP}= date(today)\``])
    expect(el.querySelector('code')!.textContent).toBe('= date(today)')
    expect(el.querySelector('a')!.hasAttribute('href')).toBe(false)
    expect(el.querySelector('img')!.getAttribute('src')).toBe(
      'https://raw.githubusercontent.com/acme/widgets/HEAD/img/shot.png'
    )
  })
})

describe('the repository a link belongs to', () => {
  it('reads host, owner and repository from any GitHub address', () => {
    expect(repoOfUrl('https://github.example.com/acme/widgets/pull/4#issuecomment-1')).toEqual({
      host: 'github.example.com',
      owner: 'acme',
      repo: 'widgets',
      ref: 'HEAD',
      path: '',
    })
    expect(repoOfUrl('not a url')).toBeNull()
    expect(repoOfUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('a click in rendered GitHub text', () => {
  const click = (a: HTMLElement) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: a })
    return event
  }

  it('does nothing on a link that was taken apart', () => {
    const a = document.createElement('a')
    a.dataset.abeleBlocked = ''
    const e = click(a)
    githubMarkdownClick(e, {})
    expect(e.defaultPrevented).toBe(true)
  })

  it('opens a file of the repository in a tab, and hands a heading to whoever shows it', () => {
    const open = vi.fn()
    const anchor = vi.fn()
    const file = document.createElement('a')
    file.dataset.abeleRepo = ''
    file.setAttribute('href', 'https://github.com/acme/widgets/blob/HEAD/a.md')
    const heading = document.createElement('a')
    heading.dataset.abeleAnchor = 'usage'
    const e1 = click(file)
    githubMarkdownClick(e1, { open, anchor })
    const e2 = click(heading)
    githubMarkdownClick(e2, { open, anchor })
    expect(open).toHaveBeenCalledWith('https://github.com/acme/widgets/blob/HEAD/a.md')
    expect(anchor).toHaveBeenCalledWith('usage')
    expect([e1.defaultPrevented, e2.defaultPrevented]).toEqual([true, true])
  })

  it('leaves a web link to the browser', () => {
    const a = document.createElement('a')
    a.setAttribute('href', 'https://example.com')
    const e = click(a)
    githubMarkdownClick(e, {})
    expect(e.defaultPrevented).toBe(false)
  })
})
