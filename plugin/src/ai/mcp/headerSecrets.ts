import { nanoid } from 'nanoid'
import { keychainId, isKeychainId } from '@/secrets/keychainId'
import { isCredentialHeader } from '@/secrets/credentialHeaders'

type HeaderSettings = { headers?: Record<string, string>; keyId?: string }

/** A server-local key reference, independent of the separate list of named keys. */
export function mcpHeaderKey(value: string): string | undefined {
  const id = /^\$\{abele_mcp_key:(abele-mcp-header-[a-z0-9-]+)\}$/.exec(value)?.[1]
  return id && isKeychainId(id) ? id : undefined
}

/** Named-key placeholders already contain no credential. Mixed literal values still move. */
export function isLiteralMcpCredential(name: string, value: string): boolean {
  return (
    isCredentialHeader(name) &&
    !!value &&
    !mcpHeaderKey(value) &&
    !/^(?:(?:Bearer|Basic)\s+)?\$\{abele_key:[^}]+\}$/i.test(value)
  )
}

/** Every key owned by this server, also used by transfer's secretsOf and destination checks. */
export function mcpSecretIds(server: HeaderSettings): string[] {
  return [
    ...new Set([
      ...(server.keyId ? [server.keyId] : []),
      ...Object.values(server.headers ?? {}).flatMap((value) => {
        const id = mcpHeaderKey(value)
        return id ? [id] : []
      }),
    ]),
  ]
}

/** Replace only after the keychain accepts all values. Export supplies an in-memory writer. */
export function protectMcpHeaders<T extends HeaderSettings>(
  server: T,
  write: (id: string, value: string) => void
): T {
  let headers: Record<string, string> | undefined
  for (const [name, value] of Object.entries(server.headers ?? {})) {
    if (!isLiteralMcpCredential(name, value)) continue
    const id = keychainId('abele-mcp-header', nanoid(16))
    write(id, value)
    headers ??= { ...server.headers }
    headers[name] = '${abele_mcp_key:' + id + '}'
  }
  return headers ? { ...server, headers } : server
}
