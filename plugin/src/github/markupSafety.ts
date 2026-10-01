/** GitHub HTML is prose, not another application embedded in the vault. */
const REMOVE =
  'iframe,frame,frameset,object,embed,applet,portal,fencedframe,script,noscript,style,link,meta,base,map,area,textarea,select,option,param'
const STYLE = ['color', 'background-color', 'text-align', 'vertical-align']
const ATTRS = new Set([
  'srcdoc',
  'action',
  'formaction',
  'form',
  'ping',
  'background',
  'lowsrc',
  'dynsrc',
  'manifest',
  'codebase',
  'archive',
  'classid',
  'profile',
  'xml:base',
  'xlink:base',
  'attributionsrc',
])
const safeUrl = (value: string) => /^(https?:|mailto:|#)/i.test(value.trim())

export function guardGithubMarkup(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(REMOVE))) el.remove()
  for (const form of Array.from(root.querySelectorAll('form')))
    form.replaceWith(...Array.from(form.childNodes))
  for (const input of Array.from(root.querySelectorAll('input,button'))) {
    // Obsidian's task-list checkboxes are inert; its own code-copy buttons are added later.
    if (input.localName === 'input' && input.getAttribute('type') === 'checkbox') {
      input.setAttribute('disabled', '')
    } else input.remove()
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || ATTRS.has(name)) el.removeAttributeNode(attr)
      else if (attr.localName === 'href' && name !== 'href') {
        // SVG links have the same policy as HTML links; normalise before link rewriting.
        if (el.localName === 'a' && safeUrl(attr.value)) el.setAttribute('href', attr.value)
        el.removeAttributeNode(attr)
      } else if (
        attr.localName === 'href' &&
        el.localName !== 'a' &&
        el.localName !== 'image' &&
        !attr.value.startsWith('#')
      ) {
        el.removeAttributeNode(attr)
      } else if (
        ['src', 'poster', 'data'].includes(name) &&
        /^[a-z][a-z0-9+.-]*:/i.test(attr.value.trim()) &&
        !/^(https?:|data:image\/|blob:)/i.test(attr.value.trim())
      ) {
        el.removeAttributeNode(attr)
      }
    }
    if (!el.hasAttribute('style')) continue
    const style = (el as HTMLElement).style
    const kept = STYLE.map((name) => [name, style?.getPropertyValue(name) ?? '']).filter(
      ([, value]) => value && !/url\s*\(|expression|image-set/i.test(value)
    )
    el.removeAttribute('style')
    if (kept.length)
      el.setAttribute('style', kept.map(([name, value]) => `${name}: ${value}`).join('; '))
  }
}
