const MAX_HEADER = 16 * 1024
const hasControls = (value: string) =>
  [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
/** RFC 7617: first colon separates username; further colons belong to the exact password. */
export function basicCredentials(header: string): { username: string; password: string } | null {
  if (header.length > MAX_HEADER) return null
  const token = /^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i.exec(header)?.[1]
  if (!token || token.length % 4) return null
  try {
    const binary = atob(token)
    if (btoa(binary) !== token) return null
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0))
    )
    const colon = text.indexOf(':')
    if (colon < 0 || hasControls(text)) return null
    return { username: text.slice(0, colon), password: text.slice(colon + 1) }
  } catch {
    return null
  }
}

export function encodeBasicCredentials(username: string, password: string): string {
  if (typeof username !== 'string' || typeof password !== 'string')
    throw new Error('Basic authentication requires a username and password')
  if (username.length + password.length > MAX_HEADER)
    throw new Error('Basic authentication credentials are too long')
  if (username.includes(':') || hasControls(username + password))
    throw new Error(
      'Basic authentication requires a username without colons and credentials without control characters'
    )
  let binary = ''
  for (const byte of new TextEncoder().encode(`${username}:${password}`))
    binary += String.fromCharCode(byte)
  const header = `Basic ${btoa(binary)}`
  if (header.length > MAX_HEADER) throw new Error('Basic authentication credentials are too long')
  return header
}

/** Same explicit input for fetch and both downloads; values resolve only inside the request. */
export const BASIC_AUTH_PARAMETER = {
  type: 'object',
  description:
    'HTTP Basic authentication. Supply a plain username and password: ${abele_key:saved-password-name}. Do not Base64-encode the password or put credentials in the URL. Cannot be combined with an Authorization header.',
  properties: {
    username: { type: 'string', description: 'Plain username, without a colon' },
    password: { type: 'string', description: 'Saved password placeholder: ${abele_key:name}' },
  },
  required: ['username', 'password'],
  additionalProperties: false,
}
