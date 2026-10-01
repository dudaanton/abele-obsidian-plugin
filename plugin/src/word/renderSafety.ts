/** Renderer receives a disposable package; the original package is never cleaned or rebuilt. */
import { saveParts, xmlBytes, type WordPackage } from './package'
import { parseXml, patchXml, descendants, REL } from './xml'

export async function safeRenderBytes(doc: WordPackage): Promise<Uint8Array> {
  const changed = new Map<string, Uint8Array | null>()
  for (const entry of doc.archive.entries) {
    if (/\.(?:html?|xhtml|js|mhtml)$/i.test(entry.filename)) changed.set(entry.filename, null)
    if (!entry.filename.endsWith('.rels')) continue
    const source = doc.archive.loadText(entry.filename)!
    const root = await parseXml(source)
    const external = descendants(root, REL, 'Relationship').filter(
      (n) => n.attrs.TargetMode === 'External' || /^(?:[a-z]+:|\/\/)/i.test(n.attrs.Target ?? '')
    )
    if (external.length)
      changed.set(
        entry.filename,
        xmlBytes(
          patchXml(
            source,
            external.map((n) => ({ start: n.start, end: n.end, text: '' }))
          )
        )
      )
  }
  return saveParts(doc, changed)
}
export const WORD_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"
export function cleanRendered(root: HTMLElement): void {
  for (const el of Array.from(
    root.querySelectorAll(
      'script,iframe,object,embed,form,input,button,link,meta,svg,math,video,audio'
    )
  ))
    el.remove()
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || ['srcdoc', 'srcset', 'action', 'formaction'].includes(a.name))
        el.removeAttribute(a.name)
      if (a.name === 'href') el.removeAttribute(a.name)
      if (a.name === 'src' && !/^(?:blob:|data:image\/(?:png|jpeg|gif|webp);)/i.test(a.value))
        el.removeAttribute(a.name)
    }
  }
}
