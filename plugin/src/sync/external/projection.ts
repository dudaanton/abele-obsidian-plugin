import { caseKey, validatePath } from '@abele/sync-protocol'
import { z } from 'zod'

export const MAX_PROJECTION_BYTES = 16 * 1024
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
const encoder = new TextEncoder()
const mimeTypes = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/epub+zip',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'text/plain',
])
const wirePath = z
  .string()
  .transform((path) => path.normalize('NFC'))
  .superRefine((path, ctx) => {
    try {
      validatePath(path)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid protocol path' })
    }
  })
const identity = z.string().min(1).max(256)
export const ProjectionSchema = z
  .object({
    format: z.literal('abele.external'),
    schema: z.literal(1),
    vaultId: identity,
    fileId: identity,
    path: wirePath,
    observedVersionId: identity,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
    mime: z
      .string()
      .max(256)
      .transform((mime) => (mimeTypes.has(mime) ? mime : 'application/octet-stream')),
    mtime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    duration: z.number().nonnegative().optional(),
  })
  .strict()
export type Projection = z.infer<typeof ProjectionSchema>

/** Content marker only. The extension never establishes identity or ownership. */
export function recognizeProjection(bytes: Uint8Array): boolean {
  // Size limits belong to schema validation, not recognition. An oversized moved marker
  // must not become an ordinary upload merely because its format field appears late.
  const text = new TextDecoder().decode(bytes)
  // A projection is a root JSON object, not an example quoted inside an ordinary note.
  // Known owned paths remain protected independently, even with a destroyed prefix.
  if (!text.trimStart().startsWith('{')) return false
  if (bytes.byteLength > MAX_PROJECTION_BYTES) return /"format"\s*:\s*"abele\.external"/.test(text)
  try {
    const value: unknown = JSON.parse(text)
    return (
      value !== null &&
      typeof value === 'object' &&
      'format' in value &&
      value.format === 'abele.external'
    )
  } catch {
    return /"format"\s*:\s*"abele\.external"/.test(text)
  }
}

export function parseProjection(bytes: Uint8Array): Projection {
  if (bytes.byteLength > MAX_PROJECTION_BYTES) throw new Error('Projection exceeds 16 KiB UTF-8')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return ProjectionSchema.parse(JSON.parse(text))
}

export function serializeProjection(input: unknown): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(ProjectionSchema.parse(input)) + '\n')
  if (bytes.byteLength > MAX_PROJECTION_BYTES) throw new Error('Projection exceeds 16 KiB UTF-8')
  return bytes
}

/** Preflight only: no file effects, name substitution or ownership inferred from absence. */
export function projectionPath(
  originalPhysicalPath: string,
  occupiedPaths: readonly string[] = []
): string {
  validatePath(originalPhysicalPath.normalize('NFC'))
  const physical = originalPhysicalPath + '.abele-ref'
  validatePath(physical.normalize('NFC'))
  // Wire normalization must not hide an overlong physical sidecar filename.
  if (
    encoder.encode(physical).byteLength > 1024 ||
    physical.split('/').some((segment) => encoder.encode(segment).byteLength > 255)
  )
    throw new Error('Projection physical path too long')
  for (const occupied of occupiedPaths) {
    if (
      caseKey(occupied) === caseKey(physical) ||
      (occupied !== originalPhysicalPath && caseKey(occupied) === caseKey(originalPhysicalPath))
    )
      throw new Error('Projection collision')
  }
  return physical
}

/** Placement is checked independently of schema and ownership; preserve physical spelling. */
export function validateProjectionPlacement(projection: Projection, physicalPath: string): boolean {
  try {
    validatePath(physicalPath.normalize('NFC'))
    return physicalPath.normalize('NFC') === projectionPath(projection.path).normalize('NFC')
  } catch {
    return false
  }
}

export interface ProjectionOwner {
  fileId: string
  projectionPath: string | null
  projectionSha: string | null
}
export type ProjectionInspection =
  | { kind: 'ordinary' }
  | { kind: 'owned'; projection: Projection }
  | { kind: 'hold'; reason: 'malformed' | 'foreign' | 'unowned' | 'moved' | 'changed' }

/** A known path stays protected even after the marker is destroyed. No account adoption. */
export function inspectProjection(
  bytes: Uint8Array,
  physicalPath: string,
  context: { vaultId: string; owned: readonly ProjectionOwner[]; sha?: string }
): ProjectionInspection {
  const atPath = context.owned.find(
    (owner) =>
      owner.projectionPath !== null && caseKey(owner.projectionPath) === caseKey(physicalPath)
  )
  if (!atPath && !recognizeProjection(bytes)) return { kind: 'ordinary' }
  let projection: Projection
  try {
    projection = parseProjection(bytes)
  } catch {
    return { kind: 'hold', reason: 'malformed' }
  }
  if (projection.vaultId !== context.vaultId || (atPath && atPath.fileId !== projection.fileId))
    return { kind: 'hold', reason: 'foreign' }
  const owner = atPath ?? context.owned.find((item) => item.fileId === projection.fileId)
  if (!owner) return { kind: 'hold', reason: 'unowned' }
  if (
    owner.projectionPath !== physicalPath ||
    !validateProjectionPlacement(projection, physicalPath)
  )
    return { kind: 'hold', reason: 'moved' }
  if (!owner.projectionSha || context.sha !== owner.projectionSha)
    return { kind: 'hold', reason: 'changed' }
  return { kind: 'owned', projection }
}
