/** URL-level address classification. No policy is imposed on ordinary agent requests. */
export function isLoopback(host: string): boolean {
  return /^(localhost|.+\.localhost|127(?:\.\d+){3}|\[::1\])$/i.test(host.replace(/\.$/, ''))
}

/** Private, special-use and local-search addresses must not be treated as public map hosts. */
export function isLocalAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (isLoopback(h)) return true
  if (h.startsWith('[')) {
    const ip = h.slice(1, -1)
    if (ip === '::' || /^(fc|fd|fe[89ab]|fec|fed|fee|fef|ff)/.test(ip)) return true
    // Classify the embedded IPv4, not the whole transition range: public addresses stay public.
    const halves = ip.split('::')
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const parts =
      halves.length === 2
        ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        : left
    const groups = parts.map((part) => parseInt(part, 16))
    const embedded = (hi: number, lo: number) =>
      isLocalAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0 || groups[5] === 0xffff))
      return embedded(groups[6], groups[7])
    if (groups[0] === 0x64 && groups[1] === 0xff9b) return embedded(groups[6], groups[7])
    if (groups[0] === 0x2002) return embedded(groups[1], groups[2])
    return false
  }
  if (/^\d+(\.\d+){3}$/.test(h)) {
    const [a, b, c] = h.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c <= 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  return (
    !h.includes('.') ||
    /\.(localhost|local|lan|internal|intranet|home|corp|private|home\.arpa)$/.test(h)
  )
}

export function publicHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || isLocalAddress(url.hostname))
      return null
    return url.href
  } catch {
    return null
  }
}
