/**
 * What travels inside the frames: the settings, compressed, and encrypted when they carry a
 * credential.
 *
 * A QR on a screen is readable by anyone who can see the screen, and stays readable in
 * whatever photo library it lands in. So a transfer holding a key is unreadable without the
 * code shown beside it, and one that holds no key is not encrypted at all — there is nothing
 * there to steal, and a code to type would only be in the way.
 */
import { describe, it, expect } from 'vitest'
import {
  encodePayload,
  decodePayload,
  isEncrypted,
  newTransferCode,
  TRANSFER_CODE_ALPHABET,
} from '@/transfer/payload'
import type { TransferPayload } from '@/transfer/types'

const payload = (secrets: Record<string, string> = {}): TransferPayload => ({
  v: 1,
  at: '2026-08-29T12:00:00.000Z',
  entries: [
    {
      section: 'ai-providers',
      id: 'GCdYxmm7',
      label: 'openwebui',
      data: { id: 'GCdYxmm7', name: 'openwebui', baseUrl: 'https://example.dev/api' },
      secretIds: Object.keys(secrets),
    },
  ],
  secrets,
})

describe('a transfer with nothing secret in it', () => {
  it('comes back exactly as it went in', async () => {
    const blob = await encodePayload(payload())

    await expect(decodePayload(blob)).resolves.toEqual({ ok: true, payload: payload() })
  })

  it('is not encrypted, so the other side never asks for a code', async () => {
    expect(isEncrypted(await encodePayload(payload()))).toBe(false)
  })

  it('is smaller than the JSON it stands for', async () => {
    const big: TransferPayload = {
      ...payload(),
      entries: Array.from({ length: 40 }, (_, i) => ({
        section: 'ai-agents',
        id: `agent-${i}`,
        label: `Agent number ${i}`,
        data: { id: `agent-${i}`, prompt: 'You are a helpful assistant. '.repeat(10) },
      })),
    }

    const blob = await encodePayload(big)

    expect(blob.length).toBeLessThan(JSON.stringify(big).length / 2)
  })
})

describe('a transfer carrying a key', () => {
  const secret = { 'abele-openwebui': 'sk-super-secret-value' }

  it('comes back only for whoever has the code', async () => {
    const blob = await encodePayload(payload(secret), 'CODE1234')

    await expect(decodePayload(blob, 'CODE1234')).resolves.toEqual({
      ok: true,
      payload: payload(secret),
    })
  })

  it('says it needs a code rather than failing obscurely', async () => {
    const blob = await encodePayload(payload(secret), 'CODE1234')

    expect(isEncrypted(blob)).toBe(true)
    await expect(decodePayload(blob)).resolves.toEqual({ ok: false, reason: 'needs-code' })
  })

  it('tells a wrong code apart from a damaged transfer', async () => {
    const blob = await encodePayload(payload(secret), 'CODE1234')

    await expect(decodePayload(blob, 'NOPE5678')).resolves.toEqual({
      ok: false,
      reason: 'bad-code',
    })
  })

  it('keeps the key out of the bytes anyone can read off the screen', async () => {
    const blob = await encodePayload(payload(secret), 'CODE1234')

    expect(new TextDecoder().decode(blob)).not.toContain('sk-super-secret-value')
  })
})

describe('a transfer that did not arrive whole', () => {
  it('is reported as damaged rather than throwing', async () => {
    const blob = await encodePayload(payload())

    await expect(decodePayload(blob.slice(0, blob.length - 5))).resolves.toEqual({
      ok: false,
      reason: 'damaged',
    })
  })

  it('is damaged, not unreadable, when the bytes are nothing of ours', async () => {
    await expect(decodePayload(new Uint8Array([1, 2, 3]))).resolves.toEqual({
      ok: false,
      reason: 'damaged',
    })
  })
})

describe('the code shown beside the QR', () => {
  it('is typed on a phone, so it holds nothing that could be read two ways', () => {
    expect(TRANSFER_CODE_ALPHABET).not.toMatch(/[0O1IL]/)
  })

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newTransferCode()))

    expect(codes.size).toBe(50)
  })

  it('is drawn from the alphabet it promises', () => {
    const code = newTransferCode()

    expect(code).toMatch(new RegExp(`^[${TRANSFER_CODE_ALPHABET}]{8}$`))
  })
})
