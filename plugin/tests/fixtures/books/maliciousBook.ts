/**
 * A book built to run code: every way a page of an EPUB could carry a script that we know of,
 * each one reporting itself if it ever runs.
 *
 * A payload that runs records its id on the app's window (`top.__abelePwned`) and, in case it
 * runs somewhere that cannot reach the app's window, posts it there as a message. The e2e tier
 * opens the book, walks every chapter, clicks everything clickable, and then asks whether
 * anything was recorded. The unit tier cleans the same pages and checks nothing survives.
 */
import { strToU8, zipSync } from 'fflate'

/** The JavaScript a vector runs: single quotes only, so it fits in a double-quoted attribute. */
export const payload = (id: string): string =>
  `try{top.__abelePwned=(top.__abelePwned||[]).concat('${id}')}catch(e){};` +
  `try{top.postMessage('abele-pwned:${id}','*')}catch(e){}`

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const js = (id: string) => escapeAttr(payload(id))

/** Vectors that fire by themselves as the page loads. */
export const AUTO_VECTORS = [
  'inline-script',
  'module-script',
  'external-script',
  'img-onerror',
  'body-onload',
  'svg-onload',
  'svg-script',
  'iframe-srcdoc',
  'iframe-src',
  'iframe-data',
  'object-data',
  'embed-src',
  'meta-refresh',
  'details-ontoggle',
  'input-onfocus',
  'source-onerror',
  'foreign-object-script',
  'svg-set-onload',
  'spoofed-policy',
  'noscript-mxss',
  'xslt',
  'svg-chapter-script',
  'svg-chapter-onload',
  'xml-chapter-script',
  'html-chapter-script',
  'html-chapter-onerror',
] as const

/** Vectors that need a click; the e2e tier clicks every element carrying `data-vector`. */
export const CLICK_VECTORS = [
  'a-javascript',
  'a-javascript-obfuscated',
  'a-onclick',
  'svg-a-xlink',
  'svg-animate-href',
  'form-action',
  'button-formaction',
  'area-href',
  'math-href',
] as const

export const ALL_VECTORS = [...AUTO_VECTORS, ...CLICK_VECTORS]

const XHTML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>`

const chapter1 = `${XHTML_HEAD}
<?xml-stylesheet type="text/xsl" href="evil.xsl"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink">
<head>
<meta charset="utf-8"/>
<meta data-abele-csp="" http-equiv="Content-Security-Policy" content="script-src * 'unsafe-inline'"/>
<meta http-equiv="refresh" content="0;url=javascript:${js('meta-refresh')}"/>
<title>Chapter one</title>
<link rel="modulepreload" href="evil.js"/>
<script type="text/javascript">${payload('inline-script').replace(/&/g, '&amp;')}</script>
<script type="module">${payload('module-script').replace(/&/g, '&amp;')}</script>
<script src="evil.js"></script>
<base href="javascript:${js('base')}//"/>
</head>
<body onload="${js('body-onload')}">
<h1 id="start">Chapter one</h1>
<p>Nothing on this page may ever run.</p>
<script>${payload('spoofed-policy').replace(/&/g, '&amp;')}</script>
<img src="missing.png" onerror="${js('img-onerror')}" alt="broken"/>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="${js('svg-onload')}">
  <script>${payload('svg-script').replace(/&/g, '&amp;')}</script>
  <set attributeName="onload" to="${js('svg-set-onload')}"/>
  <foreignObject width="10" height="10">
    <div xmlns="http://www.w3.org/1999/xhtml"><script>${payload('foreign-object-script').replace(/&/g, '&amp;')}</script></div>
  </foreignObject>
  <a xlink:href="javascript:${js('svg-a-xlink')}" data-vector="svg-a-xlink"><rect width="10" height="10"/></a>
  <a data-vector="svg-animate-href"><animate attributeName="href" to="javascript:${js('svg-animate-href')}" dur="0.01s" fill="freeze"/><rect width="10" height="10"/></a>
</svg>
<iframe srcdoc="&lt;script&gt;${js('iframe-srcdoc')}&lt;/script&gt;"></iframe>
<iframe src="page2.xhtml"></iframe>
<iframe src="data:text/html,&lt;script&gt;${js('iframe-data')}&lt;/script&gt;"></iframe>
<object data="page3.xhtml" type="application/xhtml+xml"></object>
<embed src="page4.xhtml" type="application/xhtml+xml"/>
<details open="open" ontoggle="${js('details-ontoggle')}"><summary>s</summary>d</details>
<input autofocus="autofocus" onfocus="${js('input-onfocus')}"/>
<video><source src="missing.mp4" onerror="${js('source-onerror')}"/></video>
<noscript><p title="&lt;/noscript&gt;&lt;img src=x onerror=${js('noscript-mxss')}&gt;">n</p></noscript>
<p><a href="javascript:${js('a-javascript')}" data-vector="a-javascript">javascript link</a></p>
<p><a href=" java&#x09;script&#x0A;:${js('a-javascript-obfuscated')}" data-vector="a-javascript-obfuscated">obfuscated link</a></p>
<p><a href="#start" onclick="${js('a-onclick')}" data-vector="a-onclick">onclick link</a></p>
<form action="javascript:${js('form-action')}"><button type="submit" data-vector="form-action">form</button></form>
<form><button type="submit" formaction="javascript:${js('button-formaction')}" data-vector="button-formaction">formaction</button></form>
<img src="missing.png" usemap="#m" alt="map" width="10" height="10"/>
<map name="m"><area shape="rect" coords="0,0,10,10" href="javascript:${js('area-href')}" data-vector="area-href"/></map>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext href="javascript:${js('math-href')}" data-vector="math-href">math</mtext></math>
<p style="background:url(javascript:${js('css-url')})">styled</p>
</body>
</html>`

const scriptedPage = (id: string) => `${XHTML_HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${id}</title></head>
<body><script>${payload(id).replace(/&/g, '&amp;')}</script><p>${id}</p></body></html>`

const svgChapter = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="${js('svg-chapter-onload')}">
<script>${payload('svg-chapter-script').replace(/&/g, '&amp;')}</script>
<text x="10" y="50">An SVG chapter</text>
</svg>`

const xmlChapter = `<?xml version="1.0" encoding="UTF-8"?>
<doc xmlns:h="http://www.w3.org/1999/xhtml"><h:script>${payload('xml-chapter-script').replace(/&/g, '&amp;')}</h:script><h:p>xml</h:p></doc>`

const htmlChapter = `<!DOCTYPE html>
<html><head><title>html</title><script>${payload('html-chapter-script')}</script></head>
<body><p>An HTML chapter that is not valid XML<br>
<img src=missing.png onerror="${js('html-chapter-onerror')}"></p></body></html>`

const xsl = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:template match="/"><html xmlns="http://www.w3.org/1999/xhtml"><body>
<script>${payload('xslt').replace(/&/g, '&amp;')}</script></body></html></xsl:template>
</xsl:stylesheet>`

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">abele-malicious-book</dc:identifier>
<dc:title>Malicious test book</dc:title>
<dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml" properties="scripted svg"/>
<item id="c2" href="chapter2.svg" media-type="image/svg+xml"/>
<item id="c3" href="chapter3.xml" media-type="application/xml"/>
<item id="c4" href="chapter4.html" media-type="application/xhtml+xml"/>
<item id="p2" href="page2.xhtml" media-type="application/xhtml+xml"/>
<item id="p3" href="page3.xhtml" media-type="application/xhtml+xml"/>
<item id="p4" href="page4.xhtml" media-type="application/xhtml+xml"/>
<item id="js" href="evil.js" media-type="application/javascript"/>
<item id="xsl" href="evil.xsl" media-type="application/xslt+xml"/>
</manifest>
<spine>
<itemref idref="c1"/>
<itemref idref="c2"/>
<itemref idref="c3"/>
<itemref idref="c4"/>
</spine>
</package>`

const nav = `${XHTML_HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="chapter1.xhtml">One</a></li>
<li><a href="chapter2.svg">Two</a></li>
<li><a href="chapter3.xml">Three</a></li>
<li><a href="chapter4.html">Four</a></li>
</ol></nav></body></html>`

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

/** The files of the book, by path inside the archive. */
export function maliciousBookFiles(): Record<string, string> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/chapter1.xhtml': chapter1,
    'OEBPS/chapter2.svg': svgChapter,
    'OEBPS/chapter3.xml': xmlChapter,
    'OEBPS/chapter4.html': htmlChapter,
    'OEBPS/page2.xhtml': scriptedPage('iframe-src'),
    'OEBPS/page3.xhtml': scriptedPage('object-data'),
    'OEBPS/page4.xhtml': scriptedPage('embed-src'),
    'OEBPS/evil.js': payload('external-script'),
    'OEBPS/evil.xsl': xsl,
  }
}

export function buildMaliciousEpub(): Uint8Array {
  const files = maliciousBookFiles()
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}

/** A small, harmless book: a table of contents and three chapters. */
export function buildPlainEpub(chapters = 3): Uint8Array {
  const items = Array.from({ length: chapters }, (_, i) => i + 1)
  const page = (n: number) => `${XHTML_HEAD}
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>
<body><h1 id="c${n}">Chapter ${n}</h1>${'<p>Plain text of the chapter, long enough to wrap onto several lines of a page.</p>'.repeat(40)}</body></html>`
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">abele-plain-book</dc:identifier><dc:title>Plain test book</dc:title><dc:language>en</dc:language>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${items.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest><spine>${items.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`,
    'OEBPS/nav.xhtml': `${XHTML_HEAD}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>${items.map((n) => `<li><a href="c${n}.xhtml">Chapter ${n}</a></li>`).join('')}</ol></nav></body></html>`,
  }
  for (const n of items) files[`OEBPS/c${n}.xhtml`] = page(n)
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(files))
    entries[path] = [strToU8(text), { level: path === 'mimetype' ? 0 : 6 }]
  return zipSync(entries)
}
