/**
 * A transfer cut into QR-sized frames, and put back together on the other side.
 *
 * The reader points a camera at a series that loops, so frames arrive out of order, twice
 * over, and with gaps. Every frame therefore stands alone: it names its transfer, says where
 * it sits in the series, and carries a checksum, because a QR read off a screen at an angle
 * is decoded confidently or not at all — but a frame damaged in transit must not be assembled
 * into a payload that then fails to parse for reasons nobody can see.
 */
export const FRAME_PREFIX = 'ABL1'

/**
 * Base32, RFC 4648 without padding.
 *
 * Not base64: QR has a mode for the 45 characters of uppercase, digits and nine punctuation
 * marks that packs them at 5.5 bits each, where anything else costs 8. Base32 expands a
 * payload by 8/5 and then rides at 5.5 bits a character — 8.8 bits per byte, against 10.67
 * for base64 in byte mode. The three separators below are inside that alphabet too.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function toBase32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]

  return out
}

export function fromBase32(text: string): Uint8Array | null {
  const out: number[] = []
  let bits = 0
  let value = 0

  for (const char of text) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Uint8Array.from(out)
}

/**
 * How much payload one frame carries, in bytes.
 *
 * A version 40 code holds far more, but reading one off a phone screen means resolving 177
 * modules across a few centimetres of camera. This lands each frame around version 13, which
 * a phone picks up at arm's length without being held still.
 *
 * The blob is cut before it is encoded, not after: base32 turns five bytes into eight
 * characters, and a frame holding part of a group would decode to a byte short of what went
 * in, silently, in the middle of a payload.
 */
export const FRAME_PAYLOAD_BYTES = 375

export interface Frame {
  id: string
  index: number
  total: number
  data: Uint8Array
}

/**
 * FNV-1a, in base 36.
 *
 * A QR is decoded exactly or not at all — Reed-Solomon sees to that — so this is not guarding
 * against a misread camera. It guards against a frame that arrives by another road: pasted by
 * hand and truncated, or copied out of a chat that wrapped it. Detecting that needs a hash,
 * not a strong one, and fflate ships no CRC to borrow.
 */
function checksum(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** A transfer's name, four characters from the same alphabet the frames are written in. */
export function newTransferId(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('')
}

export function toFrames(blob: Uint8Array, id: string): string[] {
  const total = Math.max(1, Math.ceil(blob.length / FRAME_PAYLOAD_BYTES))

  return Array.from({ length: total }, (_, i) => {
    const data = toBase32(blob.slice(i * FRAME_PAYLOAD_BYTES, (i + 1) * FRAME_PAYLOAD_BYTES))
    const body = `${FRAME_PREFIX}:${id}:${i + 1}/${total}:${data}`
    return `${body}:${checksum(body).toUpperCase()}`
  })
}

const FRAME_RE = new RegExp(`^${FRAME_PREFIX}:([A-Z2-7]{4}):(\\d+)/(\\d+):([A-Z2-7]*):([0-9A-Z]+)$`)

export function parseFrame(text: string): Frame | null {
  const match = FRAME_RE.exec(text.trim())
  if (!match) return null

  const [, id, index, total, data, crc] = match
  const body = text.trim().slice(0, text.trim().length - crc.length - 1)
  if (checksum(body).toUpperCase() !== crc) return null

  const bytes = fromBase32(data)
  if (!bytes) return null

  const parsed = { id, index: Number(index), total: Number(total), data: bytes }
  if (parsed.index < 1 || parsed.index > parsed.total) return null

  return parsed
}

export interface Receiver {
  readonly id: string | null
  readonly total: number
  readonly received: number
  readonly missing: number[]
  readonly done: boolean
  /** True when the frame belonged to the transfer being collected and was new. */
  accept(text: string): boolean
  assemble(): Uint8Array | null
  reset(): void
}

export function createReceiver(): Receiver {
  let id: string | null = null
  let total = 0
  const frames = new Map<number, Uint8Array>()

  return {
    get id() {
      return id
    },
    get total() {
      return total
    },
    get received() {
      return frames.size
    },
    get missing() {
      return Array.from({ length: total }, (_, i) => i + 1).filter((i) => !frames.has(i))
    },
    get done() {
      return total > 0 && frames.size === total
    },
    accept(text: string) {
      const frame = parseFrame(text)
      if (!frame) return false

      // A frame from elsewhere is not an error — the camera sees whatever is in front of it.
      // Collecting it would mix two transfers into one unparseable blob.
      if (id !== null && frame.id !== id) return false

      id = frame.id
      total = frame.total
      if (frames.has(frame.index)) return false

      frames.set(frame.index, frame.data)
      return true
    },
    assemble() {
      if (total === 0 || frames.size !== total) return null

      const parts = Array.from({ length: total }, (_, i) => frames.get(i + 1))
      const size = parts.reduce((sum, part) => sum + part.length, 0)
      const blob = new Uint8Array(size)
      let offset = 0
      for (const part of parts) {
        blob.set(part, offset)
        offset += part.length
      }

      return blob
    },
    reset() {
      id = null
      total = 0
      frames.clear()
    },
  }
}
