/**
 * LZ-String's `decompressFromBase64`, the one thing needed from it: the Excalidraw plugin keeps a
 * drawing's JSON in its note compressed that way (```` ```compressed-json ````). Written out here
 * rather than taken as a dependency for twenty lines of reading. Returns null for text that is not
 * a valid stream.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
/** More than any drawing holds: a stream that grows past it is refused rather than followed. */
const MAX_LENGTH = 64 * 1024 * 1024
const VALUE = new Map(Array.from(ALPHABET, (c, i) => [c, i]))

export function decompressFromBase64(input: string): string | null {
  const text = input.replace(/\s+/g, '')
  if (!text) return null
  for (const c of text) if (!VALUE.has(c)) return null
  const length = text.length
  const next = (i: number) => VALUE.get(text.charAt(i)) ?? 0
  const data = { val: next(0), position: 32, index: 1 }
  const read = (count: number): number => {
    let bits = 0
    for (let power = 1, max = 2 ** count; power !== max; power <<= 1) {
      const bit = data.val & data.position
      data.position >>= 1
      if (data.position === 0) {
        data.position = 32
        data.val = next(data.index++)
      }
      if (bit > 0) bits |= power
    }
    return bits
  }
  const dictionary: string[] = ['', '', '']
  let enlargeIn = 4
  let dictSize = 4
  let numBits = 3
  const first = read(2)
  if (first === 2) return ''
  if (first > 2) return null
  const c = String.fromCharCode(read(first === 0 ? 8 : 16))
  dictionary[3] = c
  let w = c
  const result = [c]
  let size = 1
  for (;;) {
    if (data.index > length) return null
    let code = read(numBits)
    if (code === 0 || code === 1) {
      dictionary[dictSize++] = String.fromCharCode(read(code === 0 ? 8 : 16))
      code = dictSize - 1
      enlargeIn--
    } else if (code === 2) return result.join('')
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
    let entry: string
    if (code < dictSize && dictionary[code] !== undefined && code > 2) entry = dictionary[code]
    else if (code === dictSize) entry = w + w.charAt(0)
    else return null
    result.push(entry)
    size += entry.length
    if (size > MAX_LENGTH) return null
    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--
    w = entry
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }
}
