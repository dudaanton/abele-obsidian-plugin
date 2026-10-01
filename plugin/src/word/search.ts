/** Case conversion may expand a scalar; tool offsets must still refer to the original UTF-16 text. */
export function foldedWordText(source: string) {
  const text = source.toLowerCase()
  let offsets: Uint32Array | null = null
  return {
    text,
    range(start: number, end: number): { offset: number; length: number } {
      if (text.length === source.length) return { offset: start, length: end - start }
      if (!offsets) {
        offsets = new Uint32Array(text.length)
        let foldedAt = 0
        let sourceAt = 0
        for (const scalar of source) {
          const count = scalar.toLowerCase().length
          for (let unit = 0; unit < count; unit++) offsets[foldedAt++] = sourceAt
          sourceAt += scalar.length
        }
      }
      const offset = offsets[start]
      const last = offsets[end - 1]
      const sourceEnd = last + (source.codePointAt(last)! > 0xffff ? 2 : 1)
      return { offset, length: sourceEnd - offset }
    },
  }
}
