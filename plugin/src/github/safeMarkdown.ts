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
import type { Component } from 'obsidian'
import { renderUntrustedMarkdown, type RenderPolicy } from '@/markdown/renderUntrusted'
import { guardGithubImages } from './remoteImages'
import { guardGithubMarkup } from './markupSafety'
import { prepareMarkdown, finishCode } from '@/markdown/untrustedCode'
export { ZWSP, guardInlineCode } from '@/markdown/untrustedCode'
import { GlobalStore } from '@/stores/GlobalStore'
import { rewriteRendered, type RepoFile } from './markdownLinks'

/** The text as it is handed to the renderer. */
export function prepareGithubMarkdown(text: string): string {
  return prepareMarkdown(text)
}

/**
 * What is done to rendered GitHub text once it is rendered: the marks taken back out of code, and
 * the links and images pointed at the repository.
 */
export function finishGithubMarkdown(el: HTMLElement, repo: RepoFile): void {
  finishCode(el)
  rewriteRendered(el, repo)
}

/** GitHub-only rules: replies intentionally keep their normal internet images. */
export function githubPolicy(repo: RepoFile, approved = new Set<string>()): RenderPolicy {
  return {
    github: true,
    before: (el) => {
      guardGithubMarkup(el)
      for (const embed of Array.from(el.querySelectorAll('.internal-embed')))
        embed.classList.add('is-loaded')
      guardGithubImages(el, repo, approved)
    },
    after: (el) => {
      finishGithubMarkdown(el, repo)
      guardGithubImages(el, repo, approved)
    },
  }
}

/**
 * Renders GitHub text into `el`, replacing what was there. Built away from the page and swapped
 * in whole, so the element never stands empty while the renderer works.
 */
export async function renderGithubMarkdown(
  el: HTMLElement,
  text: string,
  repo: RepoFile,
  component: Component,
  approved?: Set<string>
): Promise<void> {
  const next = createDiv()
  await renderUntrustedMarkdown(next, text, component, '', githubPolicy(repo, approved))
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
