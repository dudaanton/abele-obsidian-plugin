import { h, render } from 'vue'
import { placed } from '@/ai/replyLinks'
import type { ChatReplyTo } from '@/ai/types'
import ChatReplyCard from './ChatReplyCard.vue'

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
 * The places of a rendered question, each drawn as its card where its spot is, the person's words
 * around it: pressed, the chat goes to the words it replies to; one whose message is not in the
 * branch on screen is faint and leads nowhere. Drawn again, the cards already there are replaced.
 * Returns what takes them down.
 */
export function paintReplyChips(
  root: HTMLElement,
  order: readonly ChatReplyTo[],
  gone: (to: ChatReplyTo) => boolean,
  open: (to: ChatReplyTo) => void
): () => void {
  const mounted: HTMLElement[] = []
  if (!order.length) return () => {}
  const doc = root.ownerDocument
  const card = (el: HTMLElement, i: number) => {
    const to = order[i]
    render(h(ChatReplyCard, { to, gone: gone(to), onOpen: () => open(to) }), el)
    mounted.push(el)
  }
  for (const old of Array.from(root.querySelectorAll<HTMLElement>('[data-reply-spot]'))) {
    const i = Number(old.dataset.replySpot)
    if (order[i]) card(old, i)
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
      last = m.index + m[0].length
      const i = Number(m[1])
      if (!order[i]) continue
      const el = doc.win.createSpan({ cls: 'abele-chat-reply-inline' })
      el.dataset.replySpot = String(i)
      card(el, i)
      parts.push(el)
    }
    parts.push(value.slice(last))
    const kept = parts.filter((p) => p !== '')
    node.replaceWith(...kept)
    // A card is a line of its own: the line breaks either side of it would be empty lines.
    for (const el of kept)
      if (typeof el !== 'string')
        for (const side of [el.previousSibling, el.nextSibling])
          if (side?.nodeName === 'BR') side.remove()
  }
  return () => mounted.forEach((el) => render(null, el))
}
