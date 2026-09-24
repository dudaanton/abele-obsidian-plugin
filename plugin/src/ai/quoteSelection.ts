/**
 * Text taken from a note into a chat's input, quoted: every line behind `> `.
 *
 * "Use in AI agent" and "Chat about this" both put a passage in front of the person this way, so
 * a passage looks the same whichever of the two brought it.
 */

/** The passage as a markdown quote, line by line. */
export function quoteLines(text: string): string {
  return `> ${text.replace(/\n/g, '\n> ')}`
}

/** What "Use in AI agent" puts in the input: where the passage is from, then the passage. */
export function useInAgentText(selection: string, noteName?: string): string {
  const head = noteName ? `> From [[${noteName}]]:\n` : ''
  return `${head}${quoteLines(selection)}\n\n`
}
