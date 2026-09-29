/**
 * What lets a markdown render that is replaced over and over — a reply being streamed — keep
 * what has not changed on the page, rather than build all of it again with every token.
 *
 * Building all of it again was harmless for plain text, which comes back the same height, and
 * not for anything drawn after the render: a diagram came back at its placeholder height and
 * grew again, a picture came back empty until it had loaded. Above the place being read that
 * shook the text under the reader with every token.
 *
 * Two pieces:
 *
 * - **Signatures.** Each top-level block of a render is known by the HTML Obsidian produced for
 *   it, read before any post-processor has drawn into it — a chart's block is still its code
 *   there, and a drawn block cannot be compared with anything. Two renders whose blocks have the
 *   same signature at the same place drew the same source, so the one on the page can stay.
 * - **Hand-over.** When a reply ends, the markdown that showed it streaming goes and the message
 *   that replaces it mounts a markdown of its own, which used to start empty and render its text
 *   afresh. For as long as that took the reply had no height: the chat's scroll range collapsed
 *   under the reader, the browser clamped them to the new end, and the chat took them for someone
 *   who had scrolled to the end and kept them there. What the streaming markdown had drawn is now
 *   offered to whoever mounts next with the same text, and taken over as it is.
 */
import type { Component, MarkdownPostProcessorContext } from 'obsidian'

/** Renders being recorded — the elements handed to `MarkdownRenderer.render` — and what was read. */
const recording = new WeakMap<Node, { sigs: Array<string | undefined>; count: number }>()

/** Starts recording the signatures of what is rendered into `root`. */
export function recordInto(root: HTMLElement): void {
  recording.set(root, { sigs: [], count: -1 })
}

/**
 * Stops recording for `root`, and gives the signature of each top-level node it now holds, by
 * place: a processor that draws a block may put an element of its own where the block was. When
 * something took blocks away or added some, places no longer line up and nothing is known.
 */
export function stopRecording(root: HTMLElement): Array<string | null> {
  const record = recording.get(root)
  recording.delete(root)
  const count = root.childNodes.length
  if (!record || record.count !== count) return new Array<string | null>(count).fill(null)
  return Array.from({ length: count }, (_, i) => record.sigs[i] ?? null)
}

const signatureOf = (node: Node): string =>
  node.nodeType === Node.ELEMENT_NODE
    ? (node as Element).outerHTML
    : `#${node.nodeType}:${node.textContent ?? ''}`

/**
 * The post-processor that reads the signatures, registered to run before every other one.
 * Obsidian hands a render either as the whole element or block by block; both are covered.
 */
export function recordSignatures(el: HTMLElement, _ctx?: MarkdownPostProcessorContext): void {
  const whole = recording.get(el)
  if (whole) {
    const nodes = Array.from(el.childNodes)
    whole.sigs = nodes.map(signatureOf)
    whole.count = nodes.length
    return
  }
  const parent = el.parentNode
  const record = parent && recording.get(parent)
  if (!record || !parent) return
  const nodes = Array.from(parent.childNodes)
  record.sigs[nodes.indexOf(el)] = signatureOf(el)
  record.count = nodes.length
}

/** Before every processor the plugin or Obsidian registers. */
export const SIGNATURE_PROCESSOR_ORDER = -1_000_000

/** One top-level node of what a markdown shows, and the render it belongs to. */
export interface Part {
  node: ChildNode
  sig: string | null
  owner: Component
}

/** What a streaming markdown drew, waiting for the markdown that replaces it. */
export interface Offer {
  /** The text it was drawn from, before anything was held back. */
  text: string
  /** Whether it is short of that text: a block held back, or a render not yet caught up. */
  partial: boolean
  doc: Document
  parts: Part[]
}

const offers: Offer[] = []

/**
 * Offers what a streaming markdown drew to whatever mounts in the same pass. What nobody takes
 * by the next task is let go through `release`: the reply was stopped, or ended in an error.
 */
export function offer(o: Offer, release: () => void): void {
  offers.push(o)
  o.doc.defaultView?.setTimeout(() => {
    const at = offers.indexOf(o)
    if (at === -1) return
    offers.splice(at, 1)
    release()
  }, 0)
}

/** Takes what was offered for `text` in this document: drawn from it, or from its beginning. */
export function take(text: string, doc: Document): Offer | null {
  const at = offers.findIndex((o) => o.doc === doc && o.text && text.startsWith(o.text))
  if (at === -1) return null
  return offers.splice(at, 1)[0]
}
