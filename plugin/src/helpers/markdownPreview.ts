/**
 * Markdown as one line of prose, for the places that show a message without rendering it.
 *
 * A folded comment card is two clamped lines in a 300 px margin: rendering Markdown there
 * would run Obsidian's renderer once per card on a note that can hold dozens, and a heading or
 * a list arriving as block elements inside a two-line clamp is not a preview of anything. But
 * the raw text is not a preview either — an answer that starts with a link showed up as
 * `[[Some note]]`, brackets and all, which is what prompted this.
 *
 * So the syntax comes off and the words stay. Deliberately not a parser: this is a preview, and
 * the worst case of getting it wrong is a stray asterisk in a line nobody clicks.
 */

/** Everything a line of Markdown can be wearing, taken off in the order that keeps it readable. */
export function previewText(markdown: string): string {
  return (
    markdown
      // Fenced code, whole: the fence's language line and its body are not prose.
      .replace(/```[\s\S]*?```/g, ' ')
      // An embed is its own thing on the page and nothing at all in a line of text.
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // A wikilink shows what it would show rendered: the alias, or the note's name.
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      // A Markdown link keeps its text and loses its target.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Inline code, emphasis and strikethrough: the marks go, the words stay.
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
      // What a line can begin with: a heading, a quote, a bullet, a number, a task box.
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
      .replace(/^\s*\[[ xX]\]\s+/gm, '')
      // A horizontal rule is a line with no words in it.
      .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, ' ')
      // Whatever is left is one line: the card clamps it, and a newline inside a clamp is a
      // line spent on nothing.
      .replace(/\s+/g, ' ')
      .trim()
  )
}
