import { strToU8, zlibSync } from 'fflate'

/** Invented checkerboard, generated locally: fixtures never contain a real photograph. */
export function samplePng(): Uint8Array {
  const u32 = (n: number) => Uint8Array.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
  const crc = (data: Uint8Array) => {
    let n = 0xffffffff
    for (const byte of data) {
      n ^= byte
      for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
    }
    return (n ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const payload = join(strToU8(type), data)
    return join(u32(data.length), payload, u32(crc(payload)))
  }
  const pixels = new Uint8Array(16 * (1 + 16 * 4))
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const at = y * 65 + 1 + x * 4
      const bright = ((x >>> 2) + (y >>> 2)) % 2 === 0
      pixels.set(bright ? [80, 150, 210, 255] : [220, 230, 240, 255], at)
    }
  return join(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', join(u32(16), u32(16), Uint8Array.from([8, 6, 0, 0, 0]))),
    chunk('IDAT', zlibSync(pixels)),
    chunk('IEND', new Uint8Array())
  )
}
