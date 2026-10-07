/** A read-only projection of a conversation. Links own membership; messages only supply evidence.
 * No storage or UI dependencies: adapters resolve resource identities and classify scripts.
 * Sources remain a list so additional explicitly linked producers can be added later.
 */
export type ArtifactOrigin =
  | 'Uploaded'
  | 'Generated'
  | 'Edited'
  | 'Screenshot'
  | 'Downloaded'
  | 'Viewed'
  | 'Drawing'
  | 'Created'
  | 'Changed'
export interface ArtifactSource {
  messageId?: string
  timestamp?: number
  origin: ArtifactOrigin
}
export interface ChatArtifact {
  path: string
  at?: string
  sources: ArtifactSource[]
}
export interface ChatArtifacts {
  notes: ChatArtifact[]
  images: ChatArtifact[]
  scripts: ChatArtifact[]
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
export const isArtifactImage = (path: string): boolean =>
  /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)

/** Parse only the exact result format of its tool, never an arbitrary sentence mentioning a file. */
export function toolImage(value: unknown): { path: string; origin: ArtifactOrigin } | undefined {
  const message = record(value)
  if (!message || message.toolStatus !== 'approved' || !text(message.toolResult)) return
  const params = record(message.toolParams)
  const formats: Record<string, [string, ArtifactOrigin]> = {
    generate_image: ['Image saved', 'Generated'],
    edit_image: ['Edited image saved', 'Edited'],
    screenshot: ['Screenshot saved', 'Screenshot'],
    download_image: ['Saved', 'Downloaded'],
    download_file: ['Saved', 'Downloaded'],
  }
  let path: string | undefined
  let origin: ArtifactOrigin
  if (message.toolName === 'read_image' || message.toolName === 'look_at_drawing') {
    path = text(params?.path)
    origin = message.toolName === 'read_image' ? 'Viewed' : 'Drawing'
  } else {
    const format = typeof message.toolName === 'string' ? formats[message.toolName] : undefined
    if (!format) return
    const match = (message.toolResult as string).match(
      new RegExp(`(?:^|\\n)${format[0]}: ([^\\r\\n]+)\\r?$`)
    )
    path = text(match?.[1])
    origin = format[1]
    // A no-pixels model response can contain this same line and still be approved.
    // Only the tool's persisted save result proves generation/editing; old text alone cannot.
    if (
      (message.toolName === 'generate_image' || message.toolName === 'edit_image') &&
      (!path || text(message.toolImagePath) !== path)
    )
      return
  }
  if (path && isArtifactImage(path)) return { path, origin }
}

export function chatArtifacts(input: {
  touched?: readonly unknown[]
  messages?: readonly unknown[]
  resolvePath: (path: string) => string
  isScript: (path: string) => boolean
}): ChatArtifacts {
  const links = new Map<string, ChatArtifact>()
  const images = new Map<string, ChatArtifact>()
  const resolve = (path: string) => input.resolvePath(path) || path
  for (const raw of input.touched ?? []) {
    const link = record(raw)
    const original = text(link?.path)
    if (!original) continue
    const path = resolve(original)
    const artifact = links.get(path) ?? { path, sources: [] }
    const at = text(link?.at)
    if (at && (!artifact.at || at > artifact.at)) artifact.at = at
    links.set(path, artifact)
  }
  const add = (map: Map<string, ChatArtifact>, original: string, source: ArtifactSource) => {
    const path = resolve(original)
    const artifact = map.get(path) ?? { path, sources: [] }
    if (
      !artifact.sources.some(
        (s) =>
          s.messageId === source.messageId &&
          s.origin === source.origin &&
          s.timestamp === source.timestamp
      )
    )
      artifact.sources.push(source)
    map.set(path, artifact)
  }
  for (const raw of input.messages ?? []) {
    const message = record(raw)
    if (!message || message.draft) continue
    const source = {
      messageId: text(message.id),
      timestamp:
        typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
          ? message.timestamp
          : undefined,
    }
    for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
      const path = text(attachment)
      if (path && isArtifactImage(path)) add(images, path, { ...source, origin: 'Uploaded' })
    }
    const image = toolImage(message)
    if (image) add(images, image.path, { ...source, origin: image.origin })
    if (message.toolStatus !== 'approved' || !text(message.toolResult)) continue
    const result = message.toolResult as string
    const params = record(message.toolParams)
    let path = text(params?.path)
    let origin: ArtifactOrigin | undefined
    if (message.toolName === 'create_script') {
      path = text(
        result.match(
          /^Script created: (.+)\. It will be available as a command after auto-discovery\.$/m
        )?.[1]
      )
      if (path) origin = 'Created'
    } else if (message.toolName === 'create' || message.toolName === 'apply_template') {
      path = text(result.match(/^Created: ([^\r\n]+)$/m)?.[1])
      if (path) origin = 'Created'
    } else if (
      typeof message.toolName === 'string' &&
      ['edit', 'replace', 'write'].includes(message.toolName)
    ) {
      const diff = record(message.toolDiff)
      if (typeof diff?.old === 'string' && typeof diff.new === 'string' && diff.old !== diff.new)
        origin = 'Changed'
    }
    if (path && origin && links.has(resolve(path))) add(links, path, { ...source, origin })
  }
  const notes: ChatArtifact[] = []
  const scripts: ChatArtifact[] = []
  for (const artifact of links.values())
    (input.isScript(artifact.path) ? scripts : notes).push(artifact)
  return { notes, images: [...images.values()], scripts }
}
