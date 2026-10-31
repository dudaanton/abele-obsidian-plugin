import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

/** Flat optional provider capability, like apiMode. Unknown gateways opt in explicitly. */
export function acceptsPromptCacheKey(provider: {
  baseUrl: string
  promptCacheKey?: boolean
}): boolean {
  if (provider.promptCacheKey != null) return provider.promptCacheKey
  try {
    const url = new URL(provider.baseUrl)
    return url.origin === 'https://api.openai.com' && /^\/v1\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

/** Keep routing hints opaque: neither a chat title nor a vault path reaches the provider. */
export function chatPromptCacheKey(id: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(id)))
}
