/**
 * The one way GitHub text is rendered in the plugin: comments, descriptions, commit messages, a
 * comment quoted into a note, a markdown file. It is someone else's text, rendered by Obsidian's
 * own renderer — which also hands the result to every other plugin's post-processor and code
 * block processor — so before and after rendering it is kept from acting inside the vault:
 *
 * - a fence in a language only a plugin knows (```dataviewjs) is shown as plain code;
 * - inline code starts with an invisible mark while it is rendered, so a plugin that reads a
 *   code span as a command by how it starts — Dataview's `= …` and `$= …`, Meta Bind's
 *   `INPUT[…]`, a button's `button-…` — does not recognise it; the mark is taken out again once
 *   the text is on screen;
 * - links go where GitHub sends them, and anything but a web or mail address does nothing;
 * - an embed of a vault note is shown as its name, and relative images load from the repository.
 *
 * `MarkdownRenderer` offers no way to leave other plugins out, so this is what can be done from
 * outside it. It is rendered with an empty source path — no note of the vault — and into an
 * element away from the page, which is swapped in whole.
 */
import { MarkdownRenderer, type Component } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { neutraliseFences } from './markdownPreview'
import { rewriteRendered, type RepoFile } from './markdownLinks'

/** A zero-width space: not whitespace to `trim()`, so `startsWith('=')` fails on it. */
export const ZWSP = '​'

const FENCE_LINE = /^[ \t>]*?(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g

function guardSpans(text: string): string {
  return text.replace(CODE_SPAN, (whole, ticks: string, content: string) => {
    // Not a span: empty, or running over a paragraph break.
    if (!content || /\n[ \t]*\n/.test(content)) return whole
    const padded = content.length > 1 && content.startsWith(' ')
    const guarded = padded ? ` ${ZWSP}${content.slice(1)}` : `${ZWSP}${content}`
    return `${ticks}${guarded}${ticks}`
  })
}

/** Every inline code span outside fenced code, started with `ZWSP`. */
export function guardInlineCode(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let run: string[] = []
  let open: { char: string; length: number } | null = null
  const flush = () => {
    if (run.length) out.push(guardSpans(run.join('\n')))
    run = []
  }
  for (const line of lines) {
    const m = FENCE_LINE.exec(line)
    if (open) {
      out.push(line)
      if (m && m[1][0] === open.char && m[1].length >= open.length && !m[2] && !m[3].trim())
        open = null
      continue
    }
    if (m && !(m[1][0] === '`' && m[3].includes('`'))) {
      flush()
      out.push(line)
      open = { char: m[1][0], length: m[1].length }
      continue
    }
    run.push(line)
  }
  flush()
  return out.join('\n')
}

/** The text as it is handed to the renderer. */
export function prepareGithubMarkdown(text: string): string {
  return guardInlineCode(neutraliseFences(text))
}

/**
 * What is done to rendered GitHub text once it is rendered: the marks taken back out of code, and
 * the links and images pointed at the repository.
 */
export function finishGithubMarkdown(el: HTMLElement, repo: RepoFile): void {
  for (const code of Array.from(el.querySelectorAll('code'))) {
    const walker = el.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue?.includes(ZWSP)) node.nodeValue = node.nodeValue.split(ZWSP).join('')
    }
  }
  rewriteRendered(el, repo)
}

/**
 * Renders GitHub text into `el`, replacing what was there. Built away from the page and swapped
 * in whole, so the element never stands empty while the renderer works.
 */
export async function renderGithubMarkdown(
  el: HTMLElement,
  text: string,
  repo: RepoFile,
  component: Component
): Promise<void> {
  const next = createDiv()
  await MarkdownRenderer.render(
    GlobalStore.getInstance().app,
    prepareGithubMarkdown(text),
    next,
    '',
    component
  )
  finishGithubMarkdown(next, repo)
  el.replaceChildren(...Array.from(next.childNodes))
}

/** The repository a GitHub address is in, for resolving what a comment on it links to. */
export function repoOfUrl(url: string): RepoFile | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return null
  // `HEAD` is the default branch, which is what a relative link in a comment means on GitHub.
  return { host: parsed.host, owner, repo, ref: 'HEAD', path: '' }
}

/**
 * A click in rendered GitHub text. A link that was taken apart does nothing; a file of the
 * repository opens in a GitHub tab — reached only when the link handler that takes GitHub links
 * first is switched off; a heading of the same text goes to `anchor`, or nowhere. Anything else is
 * left to the browser.
 */
export function githubMarkdownClick(
  event: MouseEvent,
  on: { open?: (url: string) => void; anchor?: (slug: string) => void }
): void {
  const a = (event.target as Element | null)?.closest?.('a') as HTMLElement | null
  if (!a) return
  const data = a.dataset
  if (data.abeleBlocked !== undefined) {
    event.preventDefault()
  } else if (data.abeleAnchor !== undefined) {
    event.preventDefault()
    on.anchor?.(data.abeleAnchor)
  } else if (data.abeleRepo !== undefined) {
    event.preventDefault()
    const url = a.getAttribute('href') ?? ''
    if (on.open) on.open(url)
    else
      void import('./GithubService').then((m) =>
        m.openGithubUrl(GlobalStore.getInstance().app, url)
      )
  }
}
