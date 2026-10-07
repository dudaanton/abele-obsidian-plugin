/** Ordinary wikilinks: the path is a hint; only the address identifies the source. */
export interface AnchorAddress {
  readonly chatId: string
  readonly anchorId: string
}

const PREFIX = 'abele-selection='
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )

export function anchorAddress(address: AnchorAddress): string {
  if (!address.chatId || !address.anchorId)
    throw new Error('Selection identities must not be empty')
  return `${PREFIX}${encode(address.chatId)}/${encode(address.anchorId)}`
}

export function anchorBacklink(path: string, address: AnchorAddress): string {
  // Preserve path separators for Obsidian's link resolver, escape wikilink delimiters.
  const hint = path.replace(/[%#[\]|\r\n]/g, (c) => encode(c))
  return `[[${hint}#${anchorAddress(address)}|Return to selection]]`
}

export function parseAnchorLink(href: string): { pathHint: string; address: AnchorAddress } | null {
  const hash = href.lastIndexOf('#' + PREFIX)
  if (hash < 0 || !href.slice(hash + 1).startsWith(PREFIX)) return null
  const parts = href.slice(hash + 1 + PREFIX.length).split('/')
  if (parts.length !== 2) return null
  try {
    const [chatId, anchorId] = parts.map(decodeURIComponent)
    if (!chatId || !anchorId) return null
    let pathHint = href.slice(0, hash)
    try {
      pathHint = decodeURIComponent(pathHint)
    } catch {
      /* A raw path may contain a literal percent. */
    }
    return { pathHint, address: { chatId, anchorId } }
  } catch {
    return null
  }
}

export type AnchorPathResolution =
  | { status: 'found'; path: string }
  | { status: 'ambiguous'; paths: string[] }
  | { status: 'missing' }

/** Always validate identity, including when the hinted path still exists. */
export function resolveAnchorPath(
  chatId: string,
  _pathHint: string,
  index: readonly { path: string; chatId?: string }[]
): AnchorPathResolution {
  const paths = [
    ...new Set(index.filter((entry) => entry.chatId === chatId).map((entry) => entry.path)),
  ].sort()
  return paths.length > 1
    ? { status: 'ambiguous', paths }
    : paths.length
      ? { status: 'found', path: paths[0] }
      : { status: 'missing' }
}
