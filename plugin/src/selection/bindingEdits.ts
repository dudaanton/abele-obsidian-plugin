import { resolveReplyPassage, type ReplyTextRenderer } from './passageMapping'
import type { BindingPatch } from './bindings'

/** The format adapter supplies the link syntax; proof is against its real renderer. */
export async function prepareBindingEdit(
  content: string,
  quote: string,
  start: number,
  render: ReplyTextRenderer,
  replacement: (label: string, source: { from: number; old: string }) => string
): Promise<BindingPatch & { result: string }> {
  const passage = await resolveReplyPassage(content, quote, start, render)
  const after = replacement(quote, passage)
  const result =
    content.slice(0, passage.from) + after + content.slice(passage.from + passage.old.length)
  if ((await render(result)) !== (await render(content)))
    throw new Error('The link would change rendered text. The card was kept; nothing was linked.')
  return {
    range: { space: 'source', start: passage.from, end: passage.from + passage.old.length },
    before: passage.old,
    after,
    result,
  }
}

/** A single proven outside edit may translate ownership. No quote/nearest-match search.
 * Multiple edit regions or a changed link refuse the inverse rather than reverting a message. */
export function ownedBindingRange(current: string, published: string, patch: BindingPatch): number {
  const at = patch.range.start
  if (published.slice(at, at + patch.after.length) !== patch.after)
    throw new Error('The link ownership proof is unavailable.')
  if (current === published) return at
  let left = 0
  while (left < current.length && left < published.length && current[left] === published[left])
    left++
  let right = 0
  while (
    right < current.length - left &&
    right < published.length - left &&
    current[current.length - 1 - right] === published[published.length - 1 - right]
  )
    right++
  const end = published.length - right
  let mapped: number
  if (left >= at + patch.after.length) mapped = at
  else if (end <= at) mapped = at + current.length - published.length
  else throw new Error('The link changed or its placement is ambiguous. Nothing was removed.')
  // A copied link is ambiguous even if a prefix/suffix happens to align.
  if (
    current.indexOf(patch.after) !== current.lastIndexOf(patch.after) ||
    current.slice(mapped, mapped + patch.after.length) !== patch.after
  )
    throw new Error('The link ownership is ambiguous. Nothing was removed.')
  return mapped
}
export function undoBindingEdit(current: string, published: string, patch: BindingPatch): string {
  const at = ownedBindingRange(current, published, patch)
  return current.slice(0, at) + patch.before + current.slice(at + patch.after.length)
}

/** Never replace assistant/provider history with decoration syntax. */
export function semanticBindingText(
  content: string,
  operations: Array<{ patch: BindingPatch; publishedContent?: string; undoneAt?: number }>
): string {
  let text = content
  for (const operation of [...operations].reverse()) {
    if (operation.undoneAt || !operation.publishedContent) continue
    try {
      text = undoBindingEdit(text, operation.publishedContent, operation.patch)
    } catch {
      /* Semantic edits keep their established correction semantics. */
    }
  }
  return text
}
