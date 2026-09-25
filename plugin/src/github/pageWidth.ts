/**
 * How wide a GitHub tab lets its text run: the conversation of an issue, a pull request or a
 * discussion, a commit's message, a rendered markdown file and a folder's page. Diffs and code
 * are not held to it — a line of code wants the whole pane, and wrapping it or hiding its end
 * helps nobody — so they keep the full width whatever this says.
 *
 * The value is a CSS length, put on the tab as `--abele-github-width`: the notes' own readable
 * line width, a width in pixels, or the whole pane.
 */
import type { GithubSettings } from './settings'

export type PageWidth = 'readable' | 'custom' | 'full'

/** The narrowest custom width that still reads as a page, and the widest worth typing. */
export const PAGE_WIDTH_MIN = 400
export const PAGE_WIDTH_MAX = 4000

export function pageWidthCss(settings: Pick<GithubSettings, 'pageWidth' | 'pageWidthPx'>): string {
  if (settings.pageWidth === 'full') return '100%'
  if (settings.pageWidth === 'custom') {
    const px = Math.round(Number(settings.pageWidthPx))
    if (Number.isFinite(px) && px > 0) {
      return `${Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, px))}px`
    }
  }
  return 'var(--file-line-width)'
}
