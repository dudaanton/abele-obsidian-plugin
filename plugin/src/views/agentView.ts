/**
 * A view an agent writes itself, in HTML, inside its answer: product cards, a comparison, a
 * timetable — whatever has no block of its own. It is drawn in a frame of its own with no
 * scripts, no forms and no way into Obsidian, in Obsidian's colours and fonts, with a small set of
 * classes so a card takes five lines and looks like the app in any theme.
 *
 * What the frame may reach is only pictures over https and its own styles. A link inside it does
 * nothing by itself: the plugin reads it and opens the browser, a note, or puts a question in the
 * chat's field.
 */

/** The event an «ask» link sends up to the chat, with the question, from where the view is. */
export const ASK_EVENT = 'abele-view-ask'

/** The language of the block an agent writes: ```abele-view. */
export const VIEW_LANGUAGE = 'abele-view'

/** Obsidian's variables the view is drawn with, copied in from the app so it follows the theme. */
const THEME_VARIABLES = [
  '--background-primary',
  '--background-primary-alt',
  '--background-secondary',
  '--background-modifier-border',
  '--background-modifier-border-hover',
  '--background-modifier-hover',
  '--text-normal',
  '--text-muted',
  '--text-faint',
  '--text-accent',
  '--text-on-accent',
  '--interactive-accent',
  '--interactive-accent-hover',
  '--interactive-normal',
  '--interactive-hover',
  '--color-red',
  '--color-orange',
  '--color-yellow',
  '--color-green',
  '--color-blue',
  '--color-purple',
  '--font-interface',
  '--font-text',
  '--font-monospace',
  '--font-ui-smaller',
  '--font-ui-small',
  '--font-ui-medium',
  '--font-ui-large',
  '--font-semibold',
  '--line-height-tight',
  '--line-height-normal',
  '--radius-s',
  '--radius-m',
  '--radius-l',
  '--size-2-1',
  '--size-2-2',
  '--size-2-3',
  '--size-4-1',
  '--size-4-2',
  '--size-4-3',
  '--size-4-4',
  '--size-4-6',
  '--shadow-s',
]

/** The theme as the view's own variables, read from the element it is drawn beside. */
export function themeOf(el: Element): string {
  const style = getComputedStyle(el)
  return THEME_VARIABLES.map((name) => `${name}: ${style.getPropertyValue(name).trim()};`).join(' ')
}

/**
 * The classes an agent may use. Everything takes Obsidian's variables, so a card in the dark theme
 * is a dark card; anything else the agent styles itself.
 */
export const VIEW_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: transparent; color: var(--text-normal);
  font-family: var(--font-interface); font-size: var(--font-ui-medium);
  line-height: var(--line-height-normal); -webkit-text-size-adjust: 100%; }
body { padding: var(--size-4-1); }
a { color: var(--text-accent); text-decoration: none; }
a[data-abele-href] { cursor: pointer; -webkit-touch-callout: none; }
a[data-abele-href]:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }
a:hover { text-decoration: underline; }
img { display: block; max-width: 100%; }
.cards { display: grid; gap: var(--size-4-3);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 11em), 1fr)); }
.card { display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m);
  background: var(--background-primary); }
.card > img, .card .picture { width: 100%; aspect-ratio: 4 / 3; object-fit: cover;
  background: var(--background-secondary); }
.picture.is-missing { background: var(--background-modifier-hover); }
.card .body { display: flex; flex: 1; flex-direction: column; gap: var(--size-2-2);
  padding: var(--size-4-2) var(--size-4-3) var(--size-4-3); }
.title { font-weight: var(--font-semibold); line-height: var(--line-height-tight); }
.price { font-weight: var(--font-semibold); font-variant-numeric: tabular-nums; white-space: nowrap; }
.meta { color: var(--text-muted); font-size: var(--font-ui-small); line-height: var(--line-height-tight); }
.tag { display: inline-block; padding: 0 var(--size-4-1); border-radius: var(--radius-s);
  background: var(--background-modifier-hover); color: var(--text-muted); font-size: var(--font-ui-smaller); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--size-2-3) var(--size-4-2); }
.spacer { flex: 1; }
.actions { display: flex; flex-wrap: wrap; gap: var(--size-2-3); margin-top: auto; padding-top: var(--size-2-2); }
.button { display: inline-flex; align-items: center; justify-content: center;
  padding: var(--size-2-2) var(--size-4-3); border-radius: var(--radius-s);
  background: var(--interactive-normal); color: var(--text-normal); font-size: var(--font-ui-small);
  box-shadow: var(--shadow-s); }
.button:hover { background: var(--interactive-hover); text-decoration: none; }
.button.accent { background: var(--interactive-accent); color: var(--text-on-accent); }
.button.accent:hover { background: var(--interactive-accent-hover); }
table { width: 100%; border-collapse: collapse; font-size: var(--font-ui-small); }
th, td { padding: var(--size-2-3) var(--size-4-2); border-bottom: 1px solid var(--background-modifier-border); text-align: start; }
th { color: var(--text-muted); font-weight: var(--font-semibold); }
@media (max-width: 24em) {
  .cards { grid-template-columns: minmax(0, 1fr); }
  .card { flex-direction: row; }
  .card > img, .card .picture { flex: none; width: 5.5em; aspect-ratio: auto; align-self: stretch; }
  .card .body { padding: var(--size-4-2) var(--size-4-2) var(--size-4-2) var(--size-4-3); }
}
`

const ALLOWED_TAGS = new Set(
  'div span p a img table thead tbody tfoot tr th td caption colgroup col ul ol li dl dt dd h1 h2 h3 h4 h5 h6 strong em b i small br hr pre code blockquote section article header footer details summary'.split(
    ' '
  )
)

/** No escapes, resource functions or legacy executable CSS. */
function safeStyle(value: string): boolean {
  if (/[\\@<>]|\/\*|expression|behavior|binding/i.test(value)) return false
  return [...value.matchAll(/([\w-]+)\s*\(/g)].every((match) =>
    /^(var|calc|min|max|clamp|repeat|minmax|fit-content|rgb|rgba|hsl|hsla|color|color-mix|light-dark|lab|lch|oklab|oklch|linear-gradient|radial-gradient)$/.test(
      match[1].toLowerCase()
    )
  )
}

function cleanTheme(theme: string): string {
  return theme
    .split(';')
    .flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      const name = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      return THEME_VARIABLES.includes(name) && safeStyle(value) && !/[{}]/.test(value)
        ? [`${name}: ${value};`]
        : []
    })
    .join(' ')
}

/**
 * The agent's HTML with what could run or reach out taken away: scripts, frames, forms, event
 * attributes and links that are not to a web page, a note or the chat. The frame refuses all of
 * these anyway; taking them out keeps the source honest when it is shown.
 */
export function cleanViewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!ALLOWED_TAGS.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      el.remove()
      continue
    }
    const href = el.localName === 'a' ? el.getAttribute('href')?.trim() : undefined
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      const keep =
        /^(class|title|alt|role|aria-label|colspan|rowspan|width|height)$/.test(name) ||
        (name === 'src' && el.localName === 'img' && /^(https:\/\/|data:image\/)/i.test(value)) ||
        (name === 'style' && safeStyle(value))
      if (!keep) el.removeAttribute(attr.name)
    }
    // No native navigation, even before the parent attaches its listeners. Never trust
    // routing data supplied in the HTML: only derive it from an allowlisted source href.
    if (href && readViewLink(href)) {
      el.setAttribute('data-abele-href', href)
      el.setAttribute('role', 'link')
      el.setAttribute('tabindex', '-1')
      el.setAttribute('aria-hidden', 'true')
    }
  }
  return doc.body.innerHTML
}

/** The whole document of the frame: no scripts by its own rule, the theme, the classes, the view. */
export function viewDocument(html: string, theme: string): string {
  const policy =
    "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src 'none'"
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    `<style>:root { ${cleanTheme(theme)} }${VIEW_BASE_CSS}</style></head>` +
    `<body>${cleanViewHtml(html)}</body></html>`
  )
}

/** What a press on a link in a view asks for. */
export type ViewLink =
  | { kind: 'web'; url: string }
  | { kind: 'note'; path: string }
  | { kind: 'ask'; text: string }
  | null

/**
 * A link as the plugin reads it: a web page, a note (`abele:note?path=`), or a question to put in
 * the chat's field (`abele:ask?text=`). Anything else does nothing.
 */
export function readViewLink(href: string): ViewLink {
  const value = href.trim()
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' && !url.username && !url.password)
        return { kind: 'web', url: value }
    } catch {
      /* Invalid links are inert. */
    }
    return null
  }
  const m = /^abele:(note|ask)\?(.*)$/i.exec(value)
  if (!m) return null
  const params = new URLSearchParams(m[2])
  if (m[1].toLowerCase() === 'note') {
    const path = params.get('path')?.trim()
    return path ? { kind: 'note', path } : null
  }
  const text = params.get('text')?.trim()
  return text ? { kind: 'ask', text } : null
}

export interface ViewLinkRect {
  left: number
  top: number
  width: number
  height: number
}

/** Frame layout read by the parent, never frame input listeners. Coordinates are viewport-local. */
export function viewLinkTargets(doc: Document, width: number, height: number) {
  const styleOf = (el: Element) => doc.defaultView?.getComputedStyle(el) ?? getComputedStyle(el)
  return Array.from(doc.querySelectorAll('a[data-abele-href]')).flatMap((element) => {
    const href = element.getAttribute('data-abele-href') ?? ''
    if (!readViewLink(href)) return []
    const bounds = { left: 0, top: 0, right: width, bottom: height }
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = styleOf(ancestor)
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
        return []
      if (ancestor === element) continue
      const rect = ancestor.getBoundingClientRect()
      if (/hidden|clip|scroll|auto/.test(style.overflowX || style.overflow)) {
        bounds.left = Math.max(bounds.left, rect.left)
        bounds.right = Math.min(bounds.right, rect.right)
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY || style.overflow)) {
        bounds.top = Math.max(bounds.top, rect.top)
        bounds.bottom = Math.min(bounds.bottom, rect.bottom)
      }
    }
    const raw = Array.from(element.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    )
    if (!raw.length) return []
    const rects = raw.flatMap((rect) => {
      const left = Math.max(bounds.left, rect.left)
      const top = Math.max(bounds.top, rect.top)
      const right = Math.min(bounds.right, rect.right)
      const bottom = Math.min(bounds.bottom, rect.bottom)
      return right > left && bottom > top
        ? [{ left, top, width: right - left, height: bottom - top }]
        : []
    })
    const label =
      element.getAttribute('aria-label')?.trim() ||
      element.textContent?.trim() ||
      element.querySelector('img')?.getAttribute('alt')?.trim() ||
      href
    return [{ element, href, label, rects }]
  })
}
