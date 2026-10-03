/** Host cache values are already interpreted. Do not coerce timestamps or copy by default. */
export function cachedFrontmatter(
  cache: { frontmatter?: Record<string, any> } | null | undefined
): Record<string, any> | null {
  return cache?.frontmatter ?? null
}

/** A public property snapshot, excluding only the host's position metadata. */
export function frontmatterProperties(
  frontmatter: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const { position: _position, ...properties } = frontmatter ?? {}
  return properties
}
