export function requireLargeUploadSource(
  stat: { type: string; size: number } | null,
  size: number,
  path: string
): void {
  if (!stat || stat.type !== 'file')
    throw new Error(`Large upload source is missing on disk: ${path}`)
  if (stat.size !== size)
    throw new Error(`Large upload source ${path}: expected ${size} bytes; disk has ${stat.size}`)
}

export function requireLargeUploadHead(
  head: V2ManifestItem | undefined,
  path: string,
  evidence: unknown
) {
  if (head === undefined)
    throw new Error(
      `No server manifest entry after syncing ${path}; local evidence: ${JSON.stringify(evidence)}`
    )
  if (head.kind === 'directory')
    throw new Error(`Expected an uploaded file at ${path}; server manifest contains a directory`)
  return head
}
import type { V2ManifestItem } from '@abele/sync-sdk/protocol'
