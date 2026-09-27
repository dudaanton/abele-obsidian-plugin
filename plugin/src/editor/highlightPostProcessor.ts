/**
 * `=={red} text==` everywhere the editor is not.
 *
 * The coloured highlight is a CodeMirror decoration (`HighlightPlugin.ts`), so it only ever
 * existed in live preview. Everything else — reading mode, an embedded note, a chat reply, a
 * script view — goes through Obsidian's markdown renderer, which reads `==…==` as a plain
 * `<mark>` and keeps `{red}` as the first words of it. This reads that `<mark>` back: the colour
 * comes off the text and onto the element, with the classes the editor gives the same span, so
 * the one stylesheet colours both.
 *
 * The rule is the editor's: a word in braces, then whitespace. Anything else in braces is text.
 */
const COLOUR_PREFIX = /^\{(\w+)\}\s+/

export function coloredHighlightPostProcessor(el: HTMLElement): void {
  for (const mark of Array.from(el.querySelectorAll('mark'))) {
    const first = mark.firstChild
    if (!first || first.nodeType !== Node.TEXT_NODE) continue
    const match = COLOUR_PREFIX.exec(first.textContent ?? '')
    if (!match) continue
    first.textContent = (first.textContent ?? '').slice(match[0].length)
    mark.classList.add('abele-highlight', `abele-highlight--${match[1]}`)
  }
}
