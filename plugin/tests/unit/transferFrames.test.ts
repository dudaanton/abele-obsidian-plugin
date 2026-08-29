/**
 * The wire format of a settings transfer: what one QR code carries.
 *
 * A transfer is a blob cut into frames, each of which has to survive on its own — the reader
 * points a camera at a looping series and catches them in whatever order they happen to land,
 * misses some, and sees the same ones again on the next pass. So a frame says which transfer
 * it belongs to, where it sits, and whether it arrived intact.
 */
import { describe, it, expect } from 'vitest'
import { toFrames, parseFrame, createReceiver, FRAME_PREFIX } from '@/transfer/frames'

const blob = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * 7 + 11) % 256)

describe('cutting a blob into frames', () => {
  it('fits a small one into a single frame', () => {
    const frames = toFrames(blob(30), 'ABCD')

    expect(frames).toHaveLength(1)
    expect(frames[0].startsWith(`${FRAME_PREFIX}:ABCD:1/1:`)).toBe(true)
  })

  it('numbers the frames of a longer one from one', () => {
    const frames = toFrames(blob(4000), 'ABCD')

    expect(frames.length).toBeGreaterThan(1)
    expect(frames.map((f) => parseFrame(f)?.index)).toEqual(frames.map((_, i) => i + 1))
    expect(new Set(frames.map((f) => parseFrame(f)?.total))).toEqual(new Set([frames.length]))
  })

  /**
   * QR packs the 45 characters of its alphanumeric mode into 5.5 bits each, against 8 for
   * anything else — so a frame written in that alphabet is about a sixth shorter, which is a
   * whole code saved on a transfer of six. Base32 and the three separators are all inside it.
   */
  it('writes them in the alphabet QR encodes most densely', () => {
    const frames = toFrames(blob(2000), 'ABCD')

    for (const frame of frames) expect(frame).toMatch(/^[0-9A-Z$%*+\-./: ]+$/)
  })
})

describe('reading a frame', () => {
  it('rejects anything that is not one of ours', () => {
    expect(parseFrame('https://example.com')).toBeNull()
    expect(parseFrame('')).toBeNull()
    expect(parseFrame('ABL9:ABCD:1/1:AAAA')).toBeNull()
  })

  it('rejects one whose contents do not match its checksum', () => {
    const [frame] = toFrames(blob(50), 'ABCD')
    const damaged = frame.slice(0, -2) + (frame.endsWith('A') ? 'BB' : 'AA')

    expect(parseFrame(damaged)).toBeNull()
  })
})

describe('collecting a series', () => {
  it('puts the blob back together whatever order the frames arrive in', () => {
    const original = blob(3000)
    const frames = toFrames(original, 'ABCD')
    const receiver = createReceiver()

    for (const frame of [...frames].reverse()) receiver.accept(frame)

    expect(receiver.done).toBe(true)
    expect(receiver.assemble()).toEqual(original)
  })

  it('says what it is still waiting for', () => {
    const frames = toFrames(blob(3000), 'ABCD')
    const receiver = createReceiver()

    receiver.accept(frames[0])

    expect(receiver.done).toBe(false)
    expect(receiver.received).toBe(1)
    expect(receiver.total).toBe(frames.length)
    expect(receiver.missing).toEqual(frames.map((_, i) => i + 1).slice(1))
  })

  it('is unmoved by the same frame coming round again', () => {
    const frames = toFrames(blob(3000), 'ABCD')
    const receiver = createReceiver()

    receiver.accept(frames[0])
    receiver.accept(frames[0])

    expect(receiver.received).toBe(1)
  })

  it('ignores a frame from a different transfer rather than mixing the two', () => {
    const first = toFrames(blob(3000), 'ABCD')
    const second = toFrames(blob(3000), 'WXYZ')
    const receiver = createReceiver()

    receiver.accept(first[0])
    const taken = receiver.accept(second[1])

    expect(taken).toBe(false)
    expect(receiver.received).toBe(1)
  })

  /** Pointing the camera at a second transfer is how you correct a mistake, not an error. */
  it('starts over when a different transfer arrives with nothing of the first collected', () => {
    const first = toFrames(blob(3000), 'ABCD')
    const second = toFrames(blob(3000), 'WXYZ')
    const receiver = createReceiver()

    receiver.accept(first[0])
    receiver.reset()
    receiver.accept(second[0])

    expect(receiver.id).toBe('WXYZ')
    expect(receiver.received).toBe(1)
  })
})
