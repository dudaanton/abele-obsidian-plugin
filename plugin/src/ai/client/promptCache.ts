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
export async function chatPromptCacheKey(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return (
    'abele-' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  )
}
