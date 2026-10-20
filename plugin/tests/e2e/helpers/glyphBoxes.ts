/** Runs in the host document; compare visible glyphs with its native clickable-icon inset. */
export function measureGlyphBoxes(root: Element) {
  // A whole row can contain a decorative chevron without being a glyph action itself.
  return [
    ...root.querySelectorAll<HTMLElement>(
      '.abele-obsidian-icon.clickable-icon, .abele-obsidian-button.clickable-icon'
    ),
  ].flatMap((button) => {
    const box = button.getBoundingClientRect()
    const style = getComputedStyle(button)
    if (!box.width || !box.height || style.visibility === 'hidden') return []
    const padding = [
      style.paddingTop,
      style.paddingRight,
      style.paddingBottom,
      style.paddingLeft,
    ].map(parseFloat)
    const glyph = button.querySelector('svg')?.getBoundingClientRect()
    if (!glyph) return []
    // Native settings controls have their own inset. Compare with the host in the same
    // context, without the component classes that may override its button geometry.
    const reference = root.ownerDocument.createElement(button.tagName.toLowerCase())
    reference.className = 'clickable-icon'
    button.after(reference)
    const native = getComputedStyle(reference)
    const inset = [
      native.paddingTop,
      native.paddingRight,
      native.paddingBottom,
      native.paddingLeft,
    ].map(parseFloat)
    reference.remove()
    return [
      {
        name: button.getAttribute('aria-label') || button.className,
        width: box.width,
        height: box.height,
        padding,
        squashed:
          padding.some((value, index) => value + 0.5 < inset[index]) ||
          (!!glyph &&
            (box.height + 0.5 < glyph.height + inset[0] + inset[2] ||
              box.width + 0.5 < glyph.width + inset[1] + inset[3])),
      },
    ]
  })
}
