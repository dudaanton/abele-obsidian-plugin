import { placed, replyNumbers } from '@/ai/replyLinks'
import type { ChatReplyTo } from '@/ai/types'
import { replyChip } from './replyChip'

/** Where a place stands in the markdown being rendered: characters markdown reads nothing into. */
const SPOT = /(\d+)/g
const spot = (i: number) => `${i}`

/**
 * A sent question's markdown with a spot where each of its places stands, and the places in the
 * order of their spots. A question without places is its text as it is.
 */
export function questionMarkdown(
  content: string,
  replyTo: readonly ChatReplyTo[] | undefined
): { text: string; order: ChatReplyTo[] } {
  if (!replyTo?.length) return { text: content, order: [] }
  const order = placed(content, replyTo)
  let text = ''
  let last = 0
  order.forEach((to, i) => {
    text += content.slice(last, to.at) + spot(i)
    last = to.at
  })
  return { text: text + content.slice(last), order }
}

/**
 * The places of a rendered question drawn as chips where their spots are, each the way back to
 * its words; one whose message is not in the branch on screen stays, faint, leading nowhere.
 * Drawn again when that changes: the chips already there are replaced.
 */
export function paintReplyChips(
  root: HTMLElement,
  order: readonly ChatReplyTo[],
  gone: (to: ChatReplyTo) => boolean,
  open: (to: ChatReplyTo) => void
) {
  if (!order.length) return
  const doc = root.ownerDocument
  const numbers = replyNumbers(order)
  const several = new Set(numbers).size > 1
  const chip = (i: number) => {
    const to = order[i]
    const lost = gone(to)
    const el = replyChip(doc, to, {
      number: several ? numbers[i] : undefined,
      gone: lost,
      onOpen: lost ? undefined : () => open(to),
    })
    el.dataset.replySpot = String(i)
    return el
  }
  for (const old of Array.from(root.querySelectorAll<HTMLElement>('[data-reply-spot]'))) {
    const i = Number(old.dataset.replySpot)
    if (order[i]) old.replaceWith(chip(i))
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.nodeValue?.includes('')) texts.push(node as Text)
  for (const node of texts) {
    const value = node.nodeValue ?? ''
    const parts: (string | HTMLElement)[] = []
    let last = 0
    for (const m of value.matchAll(SPOT)) {
      parts.push(value.slice(last, m.index))
      const i = Number(m[1])
      if (order[i]) parts.push(chip(i))
      last = m.index + m[0].length
    }
    parts.push(value.slice(last))
    node.replaceWith(...parts.filter((p) => p !== ''))
  }
}
