/** Git quotes non-ASCII path bytes and control characters using its C-style syntax. */
function gitPath(value: string): string | null {
  if (!value.startsWith('"')) return value
  if (!value.endsWith('"')) return null
  const bytes: number[] = [],
    encoder = new TextEncoder()
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  }
  for (let at = 1; at < value.length - 1; at++) {
    if (value[at] === '\\') {
      const octal = /^[0-7]{1,3}/.exec(value.slice(at + 1))
      if (octal) {
        bytes.push(parseInt(octal[0], 8))
        at += octal[0].length
      } else {
        const escaped = escapes[value[++at]]
        if (escaped === undefined) return null
        bytes.push(escaped)
      }
    } else {
      const character = String.fromCodePoint(value.codePointAt(at))
      bytes.push(...encoder.encode(character))
      at += character.length - 1
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return null
  }
}

/** A missing or non-text patch stays unknown; never invent a patch from aggregate counts. */
export function forgejoPatch(diff: string, path: string, deleted: boolean): string | undefined {
  for (const block of diff.split(/(?=^diff --git )/m)) {
    const header = block.split('\n').find((line) => line.startsWith(deleted ? '--- ' : '+++ '))
    if (!header || gitPath(header.slice(4)) !== `${deleted ? 'a' : 'b'}/${path}`) continue
    const at = block.search(/^@@ /m)
    if (at >= 0) return block.slice(at)
  }
  return undefined
}
