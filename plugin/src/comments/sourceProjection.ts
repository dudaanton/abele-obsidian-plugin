/**
 * A conservative inline Markdown projection with source identity for every visible character.
 * Whitespace is omitted from the comparison because Markdown joins lines and DOM blocks do
 * not necessarily contain separator text nodes. Consumers MUST compare the entire projection
 * to the rendered section before using any offsets. Unsupported syntax therefore becomes a
 * point marker, never a highlight attached to a guessed occurrence of the same words.
 */
export interface SourceCharacter {
  char: string
  source: number
}
export function sourceCharacters(source: string, base = 0): SourceCharacter[] {
  const result: SourceCharacter[] = []
  const emit = (text: string, from: number) => {
    for (let j = 0; j < text.length; j++)
      if (!/\s/.test(text[j])) result.push({ char: text[j], source: base + from + j })
  }
  for (let i = 0; i < source.length; ) {
    const rest = source.slice(i)
    // Block prefixes are syntax, not words. Repeating handles nested blockquotes/list items.
    if (i === 0 || source[i - 1] === '\n') {
      const prefix = /^(?:[ \t]*(?:>[ \t]*|#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+))+/.exec(rest)
      if (prefix) {
        i += prefix[0].length
        continue
      }
    }
    const comment = /^%%[\s\S]*?%%/.exec(rest)
    if (comment) {
      i += comment[0].length
      continue
    }
    const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest)
    if (code) {
      emit(code[2], i + code[1].length)
      i += code[0].length
      continue
    }
    const wiki = /^(!?)\[\[([^\]\n]+)\]\]/.exec(rest)
    if (wiki) {
      if (!wiki[1]) {
        const pipe = wiki[2].lastIndexOf('|')
        const label = pipe >= 0 ? wiki[2].slice(pipe + 1) : wiki[2]
        emit(label, i + 2 + (pipe >= 0 ? pipe + 1 : 0))
      }
      i += wiki[0].length
      continue
    }
    const link = /^(!?)\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/.exec(rest)
    if (link) {
      if (!link[1]) result.push(...sourceCharacters(link[2], base + i + 1))
      i += link[0].length
      continue
    }
    if (source[i] === '\\' && i + 1 < source.length) {
      emit(source[i + 1], i + 1)
      i += 2
      continue
    }
    const tag = /^<\/?[a-z][^>]*>/i.exec(rest)
    if (tag) {
      i += tag[0].length
      continue
    }
    const colour = /^==\{\w+\}\s/.exec(rest)
    if (colour) {
      i += colour[0].length
      continue
    }
    const format = /^(?:\*\*|__|~~|==|\*|_)/.exec(rest)
    if (format) {
      i += format[0].length
      continue
    }
    const entity = /^&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/i.exec(rest)
    if (entity) {
      const names: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      }
      const value = entity[1].startsWith('#')
        ? String.fromCodePoint(
            parseInt(
              entity[1].slice(entity[1][1].toLowerCase() === 'x' ? 2 : 1),
              entity[1][1].toLowerCase() === 'x' ? 16 : 10
            )
          )
        : names[entity[1].toLowerCase()]
      emit(value, i)
      i += entity[0].length
      continue
    }
    emit(source[i], i)
    i++
  }
  return result
}
