/** Preserve shell references in prose while keeping explicit code and math unchanged. */
export function chatMarkdown(text: string): string {
  return text
    .split(/(`+[^`]*`+)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /(?<!\\)\$(?=\()|(?<!\\)\$[A-Za-z_]\w*(?=['"])/g,
            (reference) => `\\${reference}`
          )
    )
    .join('')
}
