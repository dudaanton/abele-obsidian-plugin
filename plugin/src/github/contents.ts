/**
 * A file's contents as the contents API gives them back, whatever the server made of the media
 * type it was asked for.
 *
 * `application/vnd.github.raw` is the raw type every GitHub and every Enterprise Server knows;
 * the newer `raw+json` is not honoured by older servers. A server that does not honour the type
 * asked for answers with its default instead — the JSON object, the file inside it as base64, or
 * with no content at all past a megabyte. That object is recognised here and turned back into
 * the file, so nobody is ever shown it.
 */

/** The raw media type, known to github.com and to every Enterprise Server. */
export const RAW = 'application/vnd.github.raw'

export interface RepoOf {
  owner: string
  repo: string
}

/** The contents API's description of one file, when that is what came back instead of it. */
export interface ContentsObject {
  type: 'file'
  sha: string
  size?: number
  encoding: string
  content: string
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export const repoApiPath = (r: RepoOf) =>
  `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`

export const contentsPath = (r: RepoOf, path: string, ref?: string) =>
  `${repoApiPath(r)}/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`

/** The object, if `value` is one — a file's own JSON that merely looks alike has no `sha` etc. */
export function asContentsObject(value: unknown): ContentsObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.type !== 'file' || typeof v.sha !== 'string') return null
  if (typeof v.encoding !== 'string' || typeof v.content !== 'string') return null
  if (!('git_url' in v) && !('_links' in v) && !('download_url' in v)) return null
  return v as unknown as ContentsObject
}

/** The object, if `text` is one rather than the file itself. */
export function parseContentsObject(text: string): ContentsObject | null {
  if (!text.trimStart().startsWith('{') || !text.includes('"encoding"')) return null
  try {
    return asContentsObject(JSON.parse(text))
  } catch {
    return null
  }
}

export function base64Bytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const utf8 = (bytes: Uint8Array | ArrayBuffer): string => new TextDecoder().decode(bytes)

/** Whether the object carries the file, or only says where it is — a file past a megabyte. */
export const carriesContent = (o: Partial<ContentsObject>): o is ContentsObject =>
  o.encoding === 'base64' && typeof o.content === 'string' && (o.content !== '' || !o.size)
