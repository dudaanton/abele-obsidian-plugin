/** Shared lazy pele renderer and bounded drawing cache. */
import { cleanDiagram } from './cleanDiagram'
import type { DiagramTheme } from './mermaidSource'
import type { LinkInfo, RenderOptions } from 'pele/lazy'

type DiagramTypography = Pick<RenderOptions, 'fontFamily' | 'fontFamilyMono' | 'fontSize'>

export type DiagramResult =
  | {
      ok: true
      svg: string
      renderId: string
      width: number
      height: number
      type: string
      links: LinkInfo[]
    }
  | { ok: false; error: string; line: number; column: number; snippet: string }

const CACHE_LIMIT = 120
const cache = new Map<string, Promise<DiagramResult>>()
let counter = 0

export function clearDiagramCache(): void {
  cache.clear()
}

export function renderDiagram(
  source: string,
  theme: DiagramTheme,
  typography: DiagramTypography = {}
): Promise<DiagramResult> {
  const key = `${theme}\u0000${JSON.stringify(typography)}\u0000${source}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const made = draw(source, typography)
  cache.set(key, made)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return made
}

async function draw(source: string, typography: DiagramTypography): Promise<DiagramResult> {
  const renderId = `abele-pele-${++counter}-d`
  try {
    const { renderAsync } = await import('pele/lazy')
    const result = await renderAsync(source, {
      idPrefix: renderId,
      maxWidth: 800,
      responsive: false,
      ...typography,
    })
    return { ok: true, ...result, renderId }
  } catch (error) {
    console.debug('Abele: pele could not draw a diagram', error)
    return formatDiagramError(source, error)
  }
}

/** Keep parser diagnostics in one source-based snippet, including synthetic EOF locations. */
export function formatDiagramError(
  source: string,
  error: unknown
): Extract<DiagramResult, { ok: false }> {
  const detail = error as { message?: string; line?: number; column?: number; snippet?: string }
  let line = detail?.line ?? 0
  let column = detail?.column ?? 0
  let message = detail?.message ?? (typeof error === 'string' ? error : 'Diagram rendering failed')
  // Parser messages may already carry their snippet. Remove it before adding our source line.
  if (detail?.snippet) message = message.split(detail.snippet).join('')
  const messageLines = message.split('\n')
  for (let i = messageLines.length - 1; i >= 0; i--) {
    if (/^[\s-]*\^\s*$/.test(messageLines[i])) {
      messageLines.splice(Math.max(0, i - 1), i > 0 ? 2 : 1)
    }
  }
  message = messageLines
    .filter((text) => text.trim())
    .join('\n')
    .replace(/^(Parse|Lexical) error on line \d+[:.]\s*/, '$1 error: ')
    .trim()
  const lines = source.split(/\r?\n/)
  const end =
    line > lines.length ||
    (line > 0 && !lines[line - 1]?.trim() && /\$end|end of input|EOF/i.test(message))
  if (end) {
    line = lines.length
    while (line > 1 && !lines[line - 1].trim()) line--
    column = lines[line - 1].length + 1
    message += ' (end of diagram)'
  }
  const snippet =
    line > 0 && line <= lines.length
      ? lines[line - 1] + '\n' + ' '.repeat(Math.max(0, column - 1)) + '^'
      : ''
  return {
    ok: false,
    error: [message, snippet, line ? `Line ${line}, column ${column}` : '']
      .filter(Boolean)
      .join('\n'),
    line,
    column,
    snippet,
  }
}

let instances = 0

/** Each mounted copy owns its marker, clip and label ids. */
export function placeDiagram(
  el: HTMLElement,
  diagram: Extract<DiagramResult, { ok: true }>
): SVGSVGElement {
  const id = `abele-pele-view-${++instances}-d`
  const markup = diagram.svg.split(diagram.renderId).join(id)
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const svg = parsed.body.querySelector('svg')
  if (!svg) throw new Error('Pele returned no drawing')
  // Pele returns note-link metadata separately from its SVG anchors.
  for (const link of diagram.links) {
    if (!link.internal) continue
    const target = Array.from(svg.querySelectorAll('[data-id]')).find(
      (node) => node.getAttribute('data-id') === link.id
    )
    const anchor = target?.closest('a') ?? target?.querySelector('a')
    if (anchor) {
      anchor.classList.add('internal-link')
      anchor.setAttribute('href', link.href)
      anchor.setAttribute('data-href', link.href)
    }
  }
  cleanDiagram(svg)
  const node = el.ownerDocument.importNode(svg, true)
  node.setAttribute('width', String(diagram.width))
  node.setAttribute('height', String(diagram.height))
  node.setAttribute('id', id)
  el.appendChild(node)
  return node
}
