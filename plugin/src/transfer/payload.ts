/**
 * The bytes a transfer is made of: the settings as JSON, compressed, and encrypted when they
 * carry a credential.
 *
 * Compression is not an optimisation here, it is the difference between one code and three —
 * settings are JSON full of repeated keys, and gzip takes a realistic selection down by
 * around two thirds.
 *
 * Encryption answers what a QR actually is: a picture of your API key that anyone in the room
 * can photograph and keep. A transfer holding a key is therefore locked behind a code shown
 * beside it and typed on the other phone; one holding no key is left alone, because a code to
 * type would be friction guarding nothing.
 */
import { gzipSync, gunzipSync } from 'fflate'
import type { TransferPayload } from './types'

/** Byte one says how to read the rest, so the reader knows to ask for a code before trying. */
const PLAIN = 1
const ENCRYPTED = 2

const SALT_BYTES = 16
const IV_BYTES = 12

/**
 * PBKDF2 rounds.
 *
 * The code is eight characters of a 27-letter alphabet — around 38 bits, which is not much
 * against someone who photographed the screen and has the ciphertext for good. The rounds are
 * what buys the difference: at 600k a guess costs milliseconds even on a machine built for
 * guessing, which puts the search well past the hours this transfer is worth. It costs the
 * phone doing the reading about a second, once.
 */
const PBKDF2_ROUNDS = 600_000

/** No O/0, no I/1/L: the code is read off one screen and typed into another phone. */
export const TRANSFER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const TRANSFER_CODE_LENGTH = 8

export function newTransferCode(): string {
  const random = new Uint32Array(TRANSFER_CODE_LENGTH)
  crypto.getRandomValues(random)

  return Array.from(
    random,
    (value) => TRANSFER_CODE_ALPHABET[value % TRANSFER_CODE_ALPHABET.length]
  ).join('')
}

export function isEncrypted(blob: Uint8Array): boolean {
  return blob[0] === ENCRYPTED
}

/**
 * WebCrypto wants buffers it knows are not shared, and a slice of an incoming array does not
 * carry that in its type. Copying is a few kilobytes and settles it.
 */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes)

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: owned(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encodePayload(payload: TransferPayload, code?: string): Promise<Uint8Array> {
  const compressed = gzipSync(new TextEncoder().encode(JSON.stringify(payload)), { level: 9 })

  if (!code) return concat([PLAIN], compressed)

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(code, salt)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, owned(compressed))

  return concat([ENCRYPTED], salt, iv, new Uint8Array(sealed))
}

export type DecodeResult =
  | { ok: true; payload: TransferPayload }
  | { ok: false; reason: 'needs-code' | 'bad-code' | 'damaged' }

export async function decodePayload(blob: Uint8Array, code?: string): Promise<DecodeResult> {
  if (blob[0] === PLAIN) return unpack(blob.slice(1))

  if (blob[0] !== ENCRYPTED) return { ok: false, reason: 'damaged' }
  if (!code) return { ok: false, reason: 'needs-code' }

  const salt = blob.slice(1, 1 + SALT_BYTES)
  const iv = blob.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES)
  const sealed = blob.slice(1 + SALT_BYTES + IV_BYTES)

  try {
    const key = await deriveKey(code, salt)
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, owned(sealed))
    return unpack(new Uint8Array(opened))
  } catch {
    // AES-GCM refuses a wrong key and a tampered ciphertext in exactly the same way, and the
    // wrong key is what actually happens: a code mistyped on a phone.
    return { ok: false, reason: 'bad-code' }
  }
}

function unpack(compressed: Uint8Array): DecodeResult {
  try {
    const payload = JSON.parse(new TextDecoder().decode(gunzipSync(compressed))) as TransferPayload
    if (payload?.v !== 1 || !Array.isArray(payload.entries)) return { ok: false, reason: 'damaged' }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: 'damaged' }
  }
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
