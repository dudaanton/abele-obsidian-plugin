/** A human-readable source and excerpt, shared by chat composers. No routing metadata. */
export function sourceQuote(source: string, text: string): string {
  return `${source}\n\n${text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}`
}
