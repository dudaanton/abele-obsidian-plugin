import type { DeviceTokenSecrets, TokenConnectionRegistry } from '../tokenConnectionRegistry'
import { decodeAccessToken, V2Client, V2ClientError } from './client'

/** Paste and QR share this non-UI path; keys enter only the device secret port. */
export async function connectToken(
  registry: TokenConnectionRegistry,
  localId: string,
  text: string,
  secrets: DeviceTokenSecrets,
  transport: typeof fetch
): Promise<V2Client> {
  const token = decodeAccessToken(text)
  if (token.v !== 1) throw new V2ClientError('bad-token')
  if (typeof token.address !== 'string') throw new V2ClientError('bad-token')
  const client = new V2Client(token, transport)
  const authority = await client.connection()
  await registry.attachDurably(localId, { ...token, address: token.address }, authority, secrets)
  return client
}
