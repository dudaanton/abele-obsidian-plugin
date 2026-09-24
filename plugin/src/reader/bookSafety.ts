/**
 * What keeps a book's own code from running.
 *
 * An EPUB may carry scripts, and a page of it is drawn in a frame that shares the app's origin
 * (`blob:` URLs are same-origin), so a script that ran would reach `window.top` — the vault on
 * every platform, and Node on the desktop. Nothing from a book is ever allowed to run. Three
 * layers, each enough on its own where the platform allows it:
 *
 * 1. **The book is cleaned before it is drawn.** Every (X)HTML and SVG resource is parsed and
 *    rebuilt: scripts, frames, objects, `base`, `meta http-equiv`, XSLT, event-handler
 *    attributes and `javascript:` URLs are taken out. Resources whose type could run as a page
 *    and is not one we clean are handed over as inert bytes. Script files are never loaded.
 * 2. **Every page carries a Content Security Policy** as the first thing in its head: no script
 *    of any kind, no network, no frames, no forms.
 * 3. **The frame is sandboxed without `allow-scripts`** wherever the engine lets the reader work
 *    that way (Chromium: the desktop app and Android). WebKit — the iPhone and iPad — does not
 *    deliver events into such a frame (WebKit bug 218086), so there the first two layers carry it.
 *
 * After a page loads, it is checked once more (`auditDocument`); a page that fails is emptied.
 *
 * A removed element is replaced by a hidden one of the same namespace rather than dropped, so the
 * element positions EPUB CFIs count stay the same as in the book's own file.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml'
export const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Put first in every page's head. `'unsafe-inline'` covers styles only: books and the reader both need them. */
export const BOOK_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "script-src-elem 'none'",
  "script-src-attr 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  'img-src blob: data:',
  'media-src blob: data:',
  'font-src blob: data:',
  "style-src blob: data: 'unsafe-inline'",
].join('; ')

/** The attribute marking the policy element Abele put in, so the audit can tell it from a book's own. */
export const CSP_MARK = 'data-abele-csp'
/** The attribute on a hidden stand-in, naming what stood there. */
export const REMOVED_MARK = 'data-abele-removed'

/** Elements that are taken out wherever they are, in any namespace. */
const REMOVED_ELEMENTS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'base',
  'template',
  'noscript',
  'handler',
  'listener',
  'discard',
])

/** SVG animation elements, removed when they animate a link or an event attribute. */
const ANIMATIONS = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor'])

/** Attributes that hold a URL something may be fetched, run or navigated to. */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'codebase',
  'cite',
  'longdesc',
  'usemap',
  'ping',
  'manifest',
  'lowsrc',
  'dynsrc',
  'srcset',
  'imagesrcset',
])

/** Attributes removed outright. */
const REMOVED_ATTRIBUTES = new Set(['srcdoc', 'formaction', 'action', 'ping', 'http-equiv'])

/** `link rel` values a page may keep: a stylesheet and nothing that fetches or runs ahead. */
const SAFE_LINK_RELS = new Set(['stylesheet', 'alternate'])

/** `data:` media types allowed in a URL attribute: pictures, sound, video, fonts, styles. */
const SAFE_DATA_URL =
  /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)|audio\/|video\/|font\/|application\/(font|x-font|vnd\.ms-opentype)|text\/css)[;,]/

/**
 * What an attribute's value looks like to a URL parser: without the whitespace and control
 * characters it skips, lower-cased. `java\tscript:` and `&#x0A;javascript:` both come out as
 * `javascript:`.
 */
const squash = (value: string): string => {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    const skipped =
      code <= 0x20 ||
      (code >= 0x7f && code <= 0xa0) ||
      code === 0x1680 ||
      code === 0x180e ||
      (code >= 0x2000 && code <= 0x2029) ||
      code === 0x205f ||
      code === 0x3000 ||
      code === 0xfeff
    if (!skipped) out += ch
  }
  return out.toLowerCase()
}

const RUNNABLE_SCHEME = /(^|[^a-z0-9+.-])(javascript|vbscript|livescript|mocha):/

/** Whether a value could run code when used as a URL, wherever in the value the scheme sits. */
export function isRunnableUrl(value: string): boolean {
  return RUNNABLE_SCHEME.test(squash(value))
}

function isUnsafeDataUrl(value: string): boolean {
  const v = squash(value)
  if (!v.startsWith('data:')) return false
  return !SAFE_DATA_URL.test(v)
}

/** A hidden element of the same namespace, standing where a removed one was. */
function standIn(doc: Document, el: Element): Element {
  const ns = el.namespaceURI === SVG_NS ? SVG_NS : XHTML_NS
  const stand = doc.createElementNS(ns, ns === SVG_NS ? 'g' : 'span')
  if (ns === SVG_NS) stand.setAttribute('display', 'none')
  else stand.setAttribute('hidden', '')
  stand.setAttribute(REMOVED_MARK, el.localName)
  const id = el.getAttribute('id')
  if (id) stand.setAttribute('id', id)
  return stand
}

/**
 * The first element of the head that came from the page itself. The engine puts a `style` of its
 * own before everything once the page has loaded; nothing it adds there can run.
 */
function firstOwnHeadElement(head: Element | null | undefined): Element | null {
  let el = head?.firstElementChild ?? null
  while (el && el.localName === 'style' && el.attributes.length === 0) el = el.nextElementSibling
  return el
}

/** The policy element Abele put first in the head — and only that one. */
function isOurPolicy(el: Element): boolean {
  return (
    el.localName === 'meta' &&
    el.hasAttribute(CSP_MARK) &&
    el.parentElement?.localName === 'head' &&
    firstOwnHeadElement(el.parentElement) === el &&
    el.getAttribute('content') === BOOK_CSP
  )
}

function shouldRemove(el: Element): boolean {
  const name = el.localName.toLowerCase()
  if (REMOVED_ELEMENTS.has(name)) return true
  if (name === 'meta' && el.hasAttribute('http-equiv') && !isOurPolicy(el)) return true
  if (name === 'link') {
    const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!rels.length || rels.some((rel) => !SAFE_LINK_RELS.has(rel))) return true
  }
  if (ANIMATIONS.has(name)) {
    const target = squash(el.getAttribute('attributeName') ?? '')
    if (target.endsWith('href') || target.startsWith('on') || target === 'src') return true
    for (const attr of ['to', 'from', 'values', 'by'])
      if (isRunnableUrl(el.getAttribute(attr) ?? '')) return true
  }
  return false
}

/** Cleans one element's attributes in place. */
function cleanAttributes(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const local = attr.localName.toLowerCase()
    const drop =
      // The book cannot carry the marks Abele uses for its own elements.
      attr.name === CSP_MARK ||
      attr.name === REMOVED_MARK ||
      local.startsWith('on') ||
      REMOVED_ATTRIBUTES.has(local) ||
      // `xml:base` and `xlink:base` would move where relative links point.
      local === 'base' ||
      isRunnableUrl(attr.value) ||
      ((URL_ATTRIBUTES.has(local) || attr.namespaceURI === XLINK_NS) && isUnsafeDataUrl(attr.value))
    if (drop) el.removeAttributeNode(attr)
  }
}

/** Drops processing instructions that could transform the page (XSLT) and the doctype. */
function cleanProlog(doc: Document): void {
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 10 /* DOCUMENT_TYPE_NODE */) {
      node.parentNode?.removeChild(node)
    } else if (node.nodeType === 7 /* PROCESSING_INSTRUCTION_NODE */) {
      const pi = node as ProcessingInstruction
      const isCss = /type\s*=\s*["']text\/css["']/i.test(pi.data)
      if (pi.target !== 'xml-stylesheet' || !isCss) pi.parentNode?.removeChild(pi)
    }
  }
}

/**
 * Cleans a parsed document in place: see the file comment. Works on any namespace, so an HTML
 * page, an XHTML page and an SVG image all go through the same walk. Comments inside the
 * document stay; they never run.
 */
export function cleanDocument(doc: Document): void {
  cleanProlog(doc)
  const root = doc.documentElement
  if (!root) return
  // Walk from the root, taking out whole subtrees, so nothing inside a removed element is left.
  const stack: Element[] = [root]
  while (stack.length) {
    const el = stack.pop()
    if (!el) break
    if (el !== root && shouldRemove(el)) {
      el.replaceWith(standIn(doc, el))
      continue
    }
    cleanAttributes(el)
    // Processing instructions inside the tree could be XSLT too.
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 7) el.removeChild(child)
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i])
  }
}

/** The policy element, first in the head; the head is made if the page has none. */
export function injectPolicy(doc: Document): void {
  const root = doc.documentElement
  if (!root || root.namespaceURI !== XHTML_NS) return
  let head = Array.from(root.children).find(
    (el) => el.localName === 'head' && el.namespaceURI === XHTML_NS
  )
  if (!head) {
    head = doc.createElementNS(XHTML_NS, 'head')
    root.insertBefore(head, root.firstChild)
  }
  for (const old of Array.from(head.querySelectorAll(`[${CSP_MARK}]`))) old.remove()
  const meta = doc.createElementNS(XHTML_NS, 'meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', BOOK_CSP)
  meta.setAttribute(CSP_MARK, '')
  head.insertBefore(meta, head.firstChild)
}

/** An XML name an XHTML page can carry: HTML parsing accepts attribute names XML does not. */
const XML_NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/

function dropNonXmlAttributes(doc: Document): void {
  for (const el of Array.from(doc.getElementsByTagName('*')))
    for (const attr of Array.from(el.attributes))
      if (!XML_NAME.test(attr.name)) el.removeAttributeNode(attr)
}

export const MIME = {
  XHTML: 'application/xhtml+xml',
  HTML: 'text/html',
  SVG: 'image/svg+xml',
  CSS: 'text/css',
  INERT: 'application/octet-stream',
  TEXT: 'text/plain',
} as const

/** How a resource of the book is treated, by its declared media type. */
export type ResourcePolicy = 'page' | 'svg' | 'style' | 'passive' | 'script' | 'inert'

export function resourcePolicy(type: string | null | undefined): ResourcePolicy {
  const t = (type ?? '').toLowerCase().split(';')[0].trim()
  if (t === MIME.XHTML || t === MIME.HTML || t === 'application/html') return 'page'
  if (t === MIME.SVG) return 'svg'
  if (t === MIME.CSS) return 'style'
  if (/(java|ecma)script|\/(x-)?js$|wasm/.test(t)) return 'script'
  if (/^(image|audio|video|font)\//.test(t)) return 'passive'
  if (
    /^application\/(font|x-font|vnd\.ms-(opentype|fontobject)|x-truetype-font|x-font-ttf)/.test(t)
  )
    return 'passive'
  if (t === 'application/smil+xml' || t === 'application/pls+xml') return 'passive'
  return 'inert'
}

/**
 * A page of the book, cleaned and serialised as XHTML with the policy in its head.
 *
 * Always XHTML, whatever came in: an XML parse of what `XMLSerializer` wrote reads back exactly,
 * where an HTML re-parse of cleaned markup can rearrange it into something that was not cleaned.
 * A page that is not well-formed after that shows a parse error — never a script.
 */
export function sanitizePage(source: string, type: string): { data: string; type: string } {
  const html = resourcePolicy(type) === 'page' && type.toLowerCase().startsWith(MIME.HTML)
  let doc = new DOMParser().parseFromString(source, html ? MIME.HTML : MIME.XHTML)
  if (!html && (doc.querySelector('parsererror') || !doc.documentElement?.namespaceURI))
    doc = new DOMParser().parseFromString(source, MIME.HTML)
  cleanDocument(doc)
  dropNonXmlAttributes(doc)
  injectPolicy(doc)
  return { data: new XMLSerializer().serializeToString(doc), type: MIME.XHTML }
}

/** An SVG resource, cleaned. A page cannot carry a policy element in SVG, so cleaning is all it gets. */
export function sanitizeSvg(source: string): { data: string; type: string } {
  const doc = new DOMParser().parseFromString(source, MIME.SVG)
  if (doc.querySelector('parsererror') || doc.documentElement?.namespaceURI !== SVG_NS)
    return { data: '', type: MIME.INERT }
  cleanDocument(doc)
  return { data: new XMLSerializer().serializeToString(doc), type: MIME.SVG }
}

/** Strips runnable URLs from a stylesheet. Modern engines run nothing from CSS; this is belt and braces. */
export function sanitizeStyle(source: string): string {
  return source.replace(/(javascript|vbscript)\s*:/gi, 'blocked:')
}

/**
 * What is wrong with a loaded page, if anything: the audit run on every page as it arrives in
 * its frame. An empty list means it is as the cleaning left it.
 */
export function auditDocument(doc: Document): string[] {
  const findings: string[] = []
  const root = doc.documentElement
  if (!root) return findings
  if (root.namespaceURI === XHTML_NS) {
    const first = firstOwnHeadElement(doc.head)
    if (!first || !isOurPolicy(first)) findings.push('policy is not first in the head')
  }
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (shouldRemove(el)) findings.push(`element <${el.localName}>`)
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName.toLowerCase().startsWith('on')) findings.push(`attribute ${attr.name}`)
      else if (isRunnableUrl(attr.value)) findings.push(`runnable URL in ${attr.name}`)
    }
  }
  return findings
}

/** Empties a page that failed its audit, leaving a line that says why nothing is shown. */
export function blankDocument(doc: Document): void {
  const root = doc.documentElement
  if (!root) return
  root.replaceChildren()
  const body = doc.createElementNS(XHTML_NS, 'body')
  body.textContent =
    'This page was not shown: it contains active content that could not be removed.'
  root.appendChild(body)
}

/** The frame sandbox for this platform: see the file comment. */
export function frameSandbox(platform: { isIosApp?: boolean; isSafari?: boolean }): string {
  return platform.isIosApp || platform.isSafari
    ? 'allow-same-origin allow-scripts'
    : 'allow-same-origin'
}

/** The link schemes a click in a book may open outside it. */
export function isOpenableExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim())
}

interface LoadDetail {
  type?: string
  isScript?: boolean
  allow?: boolean | Promise<boolean>
}

interface DataDetail {
  data: string | Blob | Promise<string | Blob>
  type: string | Promise<string>
  readonly name?: string
}

async function asText(data: string | Blob): Promise<string> {
  return typeof data === 'string' ? data : await data.text()
}

/** Cleans one resource by the policy of its declared type. */
export async function sanitizeResource(
  data: string | Blob,
  type: string
): Promise<{ data: string | Blob; type: string }> {
  switch (resourcePolicy(type)) {
    case 'page':
      return sanitizePage(await asText(data), type)
    case 'svg':
      return sanitizeSvg(await asText(data))
    case 'style':
      return { data: sanitizeStyle(await asText(data)), type: MIME.CSS }
    case 'passive':
      return { data, type }
    case 'script':
      return { data: '', type: MIME.INERT }
    default:
      // A type we do not clean and could run as a page (XML with XHTML elements in it, say)
      // is handed over as bytes nothing will render.
      return { data, type: MIME.INERT }
  }
}

/**
 * Hooks the cleaning into a foliate book: script resources are refused before they load, and
 * every resource is cleaned by its type before it becomes a URL a frame can open.
 */
export function guardBook(book: { transformTarget?: EventTarget }): void {
  const target = book.transformTarget
  if (!target) throw new Error('This book cannot be opened safely: its resources cannot be checked')
  target.addEventListener('load', (e) => {
    const detail = (e as CustomEvent<LoadDetail>).detail
    if (detail.isScript || resourcePolicy(detail.type) === 'script') detail.allow = false
  })
  target.addEventListener('data', (e) => {
    const detail = (e as CustomEvent<DataDetail>).detail
    const cleaned = Promise.all([detail.data, detail.type]).then(([data, type]) =>
      sanitizeResource(data, type)
    )
    detail.data = cleaned.then((c) => c.data)
    detail.type = cleaned.then((c) => c.type)
  })
}
