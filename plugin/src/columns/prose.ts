/** The native prose stream excludes controls and generated renderer text. No text search is used. */
export function proseText(range: Range, listItem = false): string {
  const fragment = range.cloneContents()
  for (const opaque of Array.from(
    fragment.querySelectorAll('a,.math,.footnote-ref,.internal-embed,img,svg,button,input,ul,ol')
  ))
    opaque.remove()
  const text = fragment.textContent ?? ''
  return listItem ? text.trimStart() : text
}
