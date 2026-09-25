/**
 * The cryptography of the synced secret store, and nothing else: WebCrypto only, because it
 * is the one implementation present on the desktop, on iOS and on Android alike. No Node
 * `crypto`, no `Buffer` — neither exists in the mobile app.
 *
 * AES-GCM with a 256-bit key and a fresh 96-bit nonce on every seal. The key comes from a
 * passphrase through PBKDF2-SHA-256 with a random salt; what a device keeps is the derived key,
 * never the passphrase.
 */

/**
 * OWASP's figure for PBKDF2-SHA-256 as of 2023. Paid once per device when the passphrase is
 * typed, about half a second on a phone, and never again: the device keeps the derived key.
 */
export const KDF_ITERATIONS = 600_000

/** A file asking for more than this is not one of ours, and deriving from it would hang. */
export const MAX_KDF_ITERATIONS = 10_000_000

/** Below this a file is not one of ours either; tests use it as their floor. */
export const MIN_KDF_ITERATIONS = 1_000

const subtle = (): SubtleCrypto => window.crypto.subtle

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  window.crypto.getRandomValues(bytes)
  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  // Chunked: spreading a large array into one call overflows the argument limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** A copy backed by a plain `ArrayBuffer`, the only kind WebCrypto's types accept. */
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer

/**
 * The 256-bit key a passphrase stands for, under this salt.
 *
 * Normalised to NFC first: the same passphrase typed on a Mac and on a phone can arrive as
 * different code points for the same letter, and would derive two different keys.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const material = await subtle().importKey(
    'raw',
    buffer(new TextEncoder().encode(passphrase.normalize('NFC'))),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buffer(salt), iterations },
    material,
    256
  )
  return new Uint8Array(bits)
}

/** Ciphertext with its nonce, both base64 — the shape it takes in the settings file. */
export interface Sealed {
  iv: string
  data: string
}

const aesKey = (key: Uint8Array, use: KeyUsage): Promise<CryptoKey> =>
  subtle().importKey('raw', buffer(key), 'AES-GCM', false, [use])

/**
 * Encrypts and authenticates `text`. `context` is authenticated but not stored: a ciphertext
 * sealed for one purpose does not open for another, so the check value cannot be passed off
 * as the secrets or the other way round.
 */
export async function seal(key: Uint8Array, text: string, context: string): Promise<Sealed> {
  const iv = randomBytes(12)
  const data = await subtle().encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(new TextEncoder().encode(context)) },
    await aesKey(key, 'encrypt'),
    buffer(new TextEncoder().encode(text))
  )
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }
}

/** The text back, or a throw when the key is wrong or a single bit was changed. */
export async function open(key: Uint8Array, sealed: Sealed, context: string): Promise<string> {
  const plain = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: buffer(fromBase64(sealed.iv)),
      additionalData: buffer(new TextEncoder().encode(context)),
    },
    await aesKey(key, 'decrypt'),
    buffer(fromBase64(sealed.data))
  )
  return new TextDecoder().decode(plain)
}
