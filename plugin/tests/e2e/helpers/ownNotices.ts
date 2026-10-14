import { evalRaw } from './obsidianCli'

/**
 * Closes the notices a file raised itself, by their text, before the next file starts.
 *
 * A notice outlives the file that caused it: an export's "Saved whole canvas" or a deliberate
 * error stays on screen while the next file opens, covers its phone targets and is reported as
 * inherited at that file's boundary. Name only what this file's own actions say; a notice
 * nobody expected is left for the boundary to report.
 */
export function dismissOwnNotices(...texts: string[]): string[] {
  const raw = evalRaw(
    `(() => JSON.stringify([...document.querySelectorAll('.notice')]
      .filter(notice => ${JSON.stringify(texts)}.some(text => (notice.textContent ?? '').includes(text)))
      .map(notice => { const text = notice.textContent ?? ''; notice.click(); return text })))()`
  )
  const closed = JSON.parse(raw) as string[]
  if (closed.length) console.info('Own notices closed:', closed)
  return closed
}
