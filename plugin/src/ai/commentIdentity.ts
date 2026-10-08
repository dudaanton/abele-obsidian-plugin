/** Storage-independent discussion identity policy. Local indexes never decide ownership. */
export interface DiscussionIdentityData {
  kind?: string
  anchor?: unknown
  commentId?: string
  commentLocation?: string
}
export class DiscussionIdentityConflict extends Error {
  constructor(
    message: string,
    readonly ownerId?: string
  ) {
    super(message)
    this.name = 'DiscussionIdentityConflict'
  }
}

export const isDiscussion = (data: DiscussionIdentityData | null | undefined): boolean =>
  !!data && (data.kind === 'comment' || !!data.anchor || !!data.commentId)

/** Vault-relative exact paths: no basename, case-folding or Unicode aliases. */
export function canonicalDiscussionPath(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
  if (path.startsWith('/') || parts.some((part) => part === '..'))
    throw new Error('A discussion location must be a vault-relative path.')
  return parts.join('/')
}

/** Versioned domain + JSON tuple is an unambiguous UTF-8 encoding, identical on every device. */
export async function forkId(sourceId: string, path: string): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(['abele.discussion.fork', 1, sourceId, canonicalDiscussionPath(path)])
  )
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return `fork-v1-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function discussionIdentity(
  data: DiscussionIdentityData,
  logicalPath: string,
  markerPath: (id: string) => string,
  legacyOwnerEstablished = false
): Promise<string | undefined> {
  if (!isDiscussion(data)) return undefined
  const path = canonicalDiscussionPath(logicalPath)
  if (data.commentLocation) {
    if (!data.commentId)
      throw new DiscussionIdentityConflict('The discussion has a location but no identity.')
    return canonicalDiscussionPath(data.commentLocation) === path
      ? data.commentId
      : forkId(data.commentId, path)
  }
  const historical =
    data.commentId ??
    path
      .split('/')
      .pop()!
      .replace(/\.abchat$/, '')
  if (canonicalDiscussionPath(markerPath(historical)) !== path) {
    if (data.commentId && legacyOwnerEstablished) return forkId(historical, path)
    throw new DiscussionIdentityConflict(
      'Ambiguous legacy discussion. Resolve its identity explicitly before opening it.',
      data.commentId
    )
  }
  return historical
}
