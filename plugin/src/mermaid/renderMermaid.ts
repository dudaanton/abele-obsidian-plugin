/**
 * Draws a diagram with the Mermaid Obsidian ships, and keeps what it drew.
 *
 * Obsidian's copy, not one of ours: it is already in the app, it is initialised the way Obsidian
 * wants it — `securityLevel: 'strict'`, which it also lists among the keys a diagram may not
 * override from inside — and it is the version every other diagram in the vault is drawn with.
 * Nothing here calls `initialize`, because that would reconfigure it for Obsidian as well.
 */
import { loadMermaid } from 'obsidian'
import { withTheme, type DiagramTheme } from './mermaidSource'

export type DiagramResult =
  | { ok: true; svg: string; renderId: string; width: number; height: number }
  | { ok: false; error: string }

interface MermaidApi {
  render(id: string, text: string, container?: Element): Promise<{ svg: string }>
}

/**
 * The width a diagram is laid out at. Most diagrams size themselves and ignore it; a Gantt
 * chart stretches to it. One width for every place a diagram is shown is what lets the note,
 * the chat and the full-screen view share a drawing — the viewer scales it from there.
 */
const LAYOUT_WIDTH = 800

/** Enough for every diagram of a long note in both themes, small enough not to matter. */
const CACHE_LIMIT = 120

const cache = new Map<string, Promise<DiagramResult>>()
let counter = 0

export function clearDiagramCache(): void {
  cache.clear()
}

/** Draws `source` in `theme`, or returns the drawing made the last time it was asked for. */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<DiagramResult> {
  const key = `${theme}\u0000${source}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Most recently used goes to the back, so the oldest is the one evicted.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const made = draw(source, theme)
  cache.set(key, made)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return made
}

async function draw(source: string, theme: DiagramTheme): Promise<DiagramResult> {
  // The trailing letter keeps one id from being the prefix of another — `…-1-d` is not the
  // start of `…-12-d` — which is what lets `placeDiagram` swap ids by plain replacement.
  const renderId = `abele-mermaid-${++counter}-d`
  // Mermaid measures text while it lays a diagram out, which needs an element in the page.
  const scratch = activeDocument.body.createDiv({ cls: 'abele-mermaid-scratch' })
  scratch.setCssStyles({ width: `${LAYOUT_WIDTH}px` })
  try {
    const mermaid = (await loadMermaid()) as MermaidApi
    const { svg } = await mermaid.render(renderId, withTheme(source, theme), scratch)
    const size = measure(svg)
    return { ok: true, svg, renderId, ...size }
  } catch (error) {
    console.debug('Abele: mermaid could not draw a diagram', error)
    return { ok: false, error: errorText(error) }
  } finally {
    scratch.remove()
    // What Mermaid leaves behind when it gives up: its own scratch element and a half-drawn
    // diagram, both at the end of the page.
    for (const id of [`d${renderId}`, renderId]) activeDocument.getElementById(id)?.remove()
  }
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const { str, message } = error as { str?: unknown; message?: unknown }
    if (typeof str === 'string' && str) return str
    if (typeof message === 'string' && message) return message
  }
  return typeof error === 'string' ? error : 'Mermaid could not read this diagram'
}

/** The drawing's own size, from its view box — its `width` is often just `100%`. */
function measure(svg: string): { width: number; height: number } {
  const box = /viewBox="\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*"/.exec(svg)
  if (box) return { width: parseFloat(box[1]), height: parseFloat(box[2]) }
  const width = /\swidth="([\d.]+)"/.exec(svg)
  const height = /\sheight="([\d.]+)"/.exec(svg)
  return { width: width ? parseFloat(width[1]) : 0, height: height ? parseFloat(height[1]) : 0 }
}

let instances = 0

/**
 * Puts a copy of a drawing into `el` and returns it.
 *
 * Each copy gets ids of its own. Mermaid names the diagram's arrowheads and scopes its style by
 * the id it drew with, and the same drawing can be on screen twice — a note and its full-screen
 * view, or one diagram in two notes. With shared ids the second copy's arrows point at the
 * first's markers, and disappear when the first is hidden.
 */
export function placeDiagram(
  el: HTMLElement,
  diagram: Extract<DiagramResult, { ok: true }>
): SVGSVGElement {
  const id = `abele-mermaid-view-${++instances}-d`
  const markup = diagram.svg.split(diagram.renderId).join(id)
  // Parsed as HTML, which is how Mermaid wrote it: labels are HTML inside `foreignObject`, and
  // an XML parser rejects the `<br>` they contain.
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const svg = parsed.body.querySelector('svg')
  if (!svg) throw new Error('Mermaid returned no drawing')
  const node = el.doc.importNode(svg, true)

  node.setAttribute('width', String(diagram.width))
  node.setAttribute('height', String(diagram.height))
  // `max-width` from Mermaid's own fitting; the viewer does the fitting here.
  node.removeAttribute('style')
  linkNotes(node)
  el.appendChild(node)
  return node
}

/**
 * Obsidian's convention, kept: a node given the class `internal-link` is a link to the note its
 * label names. The viewer opens it; this only makes the label a link.
 */
function linkNotes(svg: SVGSVGElement): void {
  for (const label of Array.from(
    svg.querySelectorAll('.internal-link > g.label foreignObject > div')
  )) {
    const target = label.textContent
    if (!target) continue
    while (label.firstChild) label.removeChild(label.firstChild)
    label.appendChild(
      label.ownerDocument.win.createEl('a', {
        cls: 'internal-link',
        text: target,
        attr: { href: target },
      })
    )
  }
}
