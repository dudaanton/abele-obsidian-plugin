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
body { padding: 1px; }
a { color: var(--text-accent); text-decoration: none; }
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
  .card { flex-direction: row; }
  .card > img, .card .picture { flex: none; width: 5.5em; aspect-ratio: auto; align-self: stretch; }
  .card .body { padding: var(--size-4-2) var(--size-4-2) var(--size-4-2) var(--size-4-3); }
}
`

const DROPPED = 'script, iframe, frame, object, embed, form, base, meta, link, noscript'

/**
 * The agent's HTML with what could run or reach out taken away: scripts, frames, forms, event
 * attributes and links that are not to a web page, a note or the chat. The frame refuses all of
 * these anyway; taking them out keeps the source honest when it is shown.
 */
export function cleanViewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll(DROPPED).forEach((el) => el.remove())
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        !/^(https:|http:|data:image\/|abele:|#)/.test(value)
      )
        el.removeAttribute(attr.name)
      else if (name === 'srcset' || name === 'formaction') el.removeAttribute(attr.name)
    }
  }
  return doc.body.innerHTML
}

/** The whole document of the frame: no scripts by its own rule, the theme, the classes, the view. */
export function viewDocument(html: string, theme: string): string {
  const policy =
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:"
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    `<style>:root { ${theme} }${VIEW_BASE_CSS}</style></head>` +
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
  if (/^https?:\/\//i.test(value)) return { kind: 'web', url: value }
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
