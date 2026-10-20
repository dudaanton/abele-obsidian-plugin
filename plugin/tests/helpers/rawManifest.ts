import { decodeAccessToken, V2ManifestSchema, type V2ManifestItem } from '@abele/sync-sdk/protocol'

/** Raw protocol inventory includes directories as well as downloadable files. */
export async function rawManifest(
  encoded: string,
  transport: typeof fetch
): Promise<V2ManifestItem[]> {
  const token = decodeAccessToken(encoded)
  const items: V2ManifestItem[] = []
  const seen = new Set<string>()
  let next: string | null = null
  do {
    if (next !== null && seen.has(next)) throw new Error('Manifest pagination did not advance')
    if (next !== null) seen.add(next)
    const url = new URL('/v2/manifest', token.address)
    if (next !== null) url.searchParams.set('next', next)
    const response = await transport(url, {
      headers: { authorization: 'Bearer ' + token.key },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Manifest request failed')
    const page = V2ManifestSchema.parse(await response.json())
    items.push(...page.items)
    next = page.next
  } while (next !== null)
  return items
}
