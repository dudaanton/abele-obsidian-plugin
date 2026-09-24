/**
 * Opening a note at a range of its lines.
 *
 * The note opens where Obsidian's own `openLinkText` would put it — the same leaf reused, or a
 * new tab, split or window when the click asked for one — and is then brought to the lines:
 * selected in the editor, flashed in reading view. A range past the end of the note is taken
 * as its last line rather than refused; the note may have been shortened since the link was
 * written.
 */
import { MarkdownView, Platform, TFile, type App, type PaneType } from 'obsidian'
import { clampRange, parseLineLink, type LineRange } from './parse'

/** How long a section flashes in reading view; the same length as a footnote's flash. */
const FLASH_MS = 2500

/**
 * Lines of context left above the range in reading view, so it does not sit under the header —
 * more on a phone, where the header floats over the top of the note.
 */
const contextAbove = (): number => (Platform.isPhone ? 5 : 2)

/**
 * One section of the reading view as Obsidian's renderer keeps it. Not part of the published
 * API: `start` and `end` are 0-based positions in the source, `el` the rendered block.
 */
interface PreviewSection {
  start?: { line: number }
  end?: { line: number }
  el?: HTMLElement
}

/**
 * The lines a range may reach: the note's, less the blank ones at its end — a link past the end
 * lands on the last line that says something, which reading view has a block for.
 */
function lineCountOf(view: MarkdownView): number {
  const text = typeof view.data === 'string' ? view.data : view.editor.getValue()
  const lines = text.split('\n')
  let count = lines.length
  while (count > 1 && lines[count - 1].trim() === '') count--
  return count
}

/** The range selected in the editor and scrolled so its first line is in the middle. */
function selectInEditor(view: MarkdownView, range: LineRange): void {
  const { editor } = view
  const from = { line: range.from - 1, ch: 0 }
  const to = { line: range.to - 1, ch: editor.getLine(range.to - 1).length }
  editor.setSelection(from, to)
  editor.scrollIntoView({ from, to: from }, true)
  editor.focus()
}

/** How long reading view is given to render the blocks holding the range after the note opens. */
const RENDER_WAIT_MS = 1500
const RENDER_POLL_MS = 25

function previewSections(view: MarkdownView): PreviewSection[] {
  const preview = view.previewMode as unknown as { renderer?: { sections?: PreviewSection[] } }
  return preview.renderer?.sections ?? []
}

/** Whether reading view has laid out the block holding `line` (0-based) yet. */
function rendered(view: MarkdownView, line: number): boolean {
  return previewSections(view).some((s) => !!s.el && !!s.end && s.end.line >= line)
}

/**
 * Reading view scrolled to the range, and the blocks holding it flashed. A note just opened is
 * rendered a moment later, so this waits for its blocks — briefly: a note that never renders
 * that far is left as it is.
 */
async function flashInPreview(view: MarkdownView, range: LineRange): Promise<void> {
  for (let waited = 0; waited < RENDER_WAIT_MS && !rendered(view, range.from - 1); ) {
    await new Promise((resolve) => window.setTimeout(resolve, RENDER_POLL_MS))
    waited += RENDER_POLL_MS
  }
  view.previewMode.applyScroll(Math.max(0, range.from - 1 - contextAbove()))
  for (const section of previewSections(view)) {
    if (!section.el || !section.start || !section.end) continue
    if (section.start.line > range.to - 1 || section.end.line < range.from - 1) continue
    const el = section.el
    el.removeClass('abele-line-flash')
    // A reflow between the two, so a second click on the same link flashes again.
    void el.offsetWidth
    el.addClass('abele-line-flash')
    window.setTimeout(() => el.removeClass('abele-line-flash'), FLASH_MS)
  }
}

/** Brings an open note to a range of its lines, in whichever mode it is showing. */
export async function revealLines(view: MarkdownView, lines: LineRange): Promise<void> {
  const range = clampRange(lines, lineCountOf(view))
  if (view.getMode() === 'preview') await flashInPreview(view, range)
  else selectInEditor(view, range)
}

/** Opens `file` in the leaf a link click would use and brings it to `lines`. */
export async function openNoteAtLines(
  app: App,
  file: TFile,
  lines: LineRange,
  pane: PaneType | false = false
): Promise<void> {
  const leaf = app.workspace.getLeaf(pane)
  await leaf.openFile(file, { active: true })
  if (leaf.view instanceof MarkdownView) await revealLines(leaf.view, lines)
}

/**
 * The note a link to lines points at, when `href` is one and it resolves to a markdown note.
 * Null for anything else, which is then left to go wherever it always went.
 */
export function resolveLineLink(
  app: App,
  href: string,
  sourcePath: string
): { file: TFile; lines: LineRange } | null {
  const link = parseLineLink(href)
  if (!link) return null
  const file = app.metadataCache.getFirstLinkpathDest(link.linkpath, sourcePath)
  if (!(file instanceof TFile) || file.extension !== 'md') return null
  return { file, lines: link.lines }
}
