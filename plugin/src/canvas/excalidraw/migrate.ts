/**
 * Excalidraw drawings made into Abele canvases, one or all of them, over a vault this code only
 * knows through `ExcalidrawVault`. The drawing is only ever read: its canvas is a new file beside
 * it, under a name nothing has yet, and a picture kept inside the drawing is written beside that.
 * A drawing a canvas was already made from is skipped; the canvas says which drawing it came from.
 */
import { serializeCanvas } from '../core/model'
import { convertExcalidraw, type Loss } from './convert'
import { parseExcalidraw } from './source'

export interface ExcalidrawVault {
  rewriteReferences(source: string, target: string): Promise<ReferenceReport>
  /** Every drawing of the Excalidraw plugin in the vault, by path. */
  drawings(): Promise<string[]>
  read(path: string): Promise<string>
  /** Whether anything — file or folder — has this path. */
  exists(path: string): boolean
  createText(path: string, text: string): Promise<void>
  /** Create exclusively; return cleanup owned by that new file, never an existing/replacement file. */
  createBinary(path: string, data: ArrayBuffer): Promise<() => Promise<void>>
  /** A link target as written in `from` → the vault path it points at, or null. */
  resolve(link: string, from: string): string | null
  /** The canvases made from drawings so far: the drawing's path → the canvas's. */
  migrated(): Promise<Map<string, string>>
}

export interface ReferenceReport {
  rewritten: number
  files: { path: string; count: number; error?: string }[]
}

export interface FileReport {
  source: string
  status: 'migrated' | 'skipped' | 'failed'
  /** The canvas: the new one, or for a skipped drawing the one made before. */
  target?: string
  losses: Loss[]
  /** Why it failed or was skipped. */
  reason?: string
  counts?: { cards: number; connectors: number; lines: number; strokes: number }
  references?: ReferenceReport
}

export interface MigrationReport {
  files: FileReport[]
  migrated: number
  skipped: number
  failed: number
}

/** The drawing's name without what makes it a drawing: `Plan.excalidraw.md` → `Plan`. */
export function baseName(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1).replace(/(\.excalidraw)?(\.md)?$/i, '')
  return { dir: slash < 0 ? '' : path.slice(0, slash + 1), base: name || 'Drawing' }
}

/** A free path in `dir` for `base` with an extension: `Plan.canvas`, else `Plan 2.canvas`, … */
export function freePath(
  dir: string,
  base: string,
  extension: string,
  taken: (path: string) => boolean
): string {
  for (let n = 1; ; n++) {
    const path = `${dir}${base}${n > 1 ? ` ${n}` : ''}.${extension}`
    if (!taken(path)) return path
  }
}

function bytesOf(dataURL: string): ArrayBuffer {
  const comma = dataURL.indexOf(',')
  const head = dataURL.slice(0, comma)
  const body = dataURL.slice(comma + 1)
  if (!/;base64$/i.test(head)) return new TextEncoder().encode(decodeURIComponent(body)).buffer
  const bin = atob(body)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/**
 * One drawing made into a canvas beside it. Never throws: whatever goes wrong is the report's
 * `failed` with the reason. `force` makes a second canvas of a drawing migrated before.
 */
export async function migrateOne(
  vault: ExcalidrawVault,
  source: string,
  options: { force?: boolean; known?: Map<string, string> } = {}
): Promise<FileReport> {
  const picturesCreated: { path: string; remove: () => Promise<void> }[] = []
  try {
    const known = options.known ?? (await vault.migrated())
    const before = known.get(source)
    if (before && !options.force)
      return {
        source,
        status: 'skipped',
        target: before,
        losses: [],
        reason: 'A canvas was already made from it',
      }
    const scene = parseExcalidraw(await vault.read(source), source)
    const { dir, base } = baseName(source)
    const reserved = new Set<string>()
    const taken = (p: string) => reserved.has(p) || vault.exists(p)
    const target = freePath(dir, base, 'canvas', taken)
    reserved.add(target)
    const result = convertExcalidraw(scene, {
      source,
      resolve: (link) => vault.resolve(link, source),
      picturePath: (fileId, ext) => {
        // The id is the drawing's own text: only letters and digits of it reach a name.
        const tag = fileId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'picture'
        const path = freePath(dir, `${base} ${tag}`, ext, taken)
        reserved.add(path)
        return path
      },
    })
    for (const picture of result.pictures) {
      const remove = await vault.createBinary(picture.path, bytesOf(picture.dataURL))
      picturesCreated.push({ path: picture.path, remove })
    }
    await vault.createText(target, serializeCanvas(result.graph))
    known.set(source, target)
    // Publication succeeded. A backlink failure must never remove pictures used by this canvas.
    let references: ReferenceReport
    try {
      references = await vault.rewriteReferences(source, target)
    } catch (error) {
      references = { rewritten: 0, files: [{ path: source, count: 0, error: String(error) }] }
    }
    return {
      source,
      status: 'migrated',
      target,
      losses: result.losses,
      counts: result.counts,
      references,
    }
  } catch (e) {
    const cleanupErrors: string[] = []
    for (const picture of picturesCreated.reverse()) {
      try {
        await picture.remove()
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        cleanupErrors.push(`${picture.path}: ${reason}`)
      }
    }
    const reason = e instanceof Error ? e.message : String(e)
    return {
      source,
      status: 'failed',
      losses: [],
      reason:
        reason +
        (cleanupErrors.length ? `; Picture cleanup failed: ${cleanupErrors.join('; ')}` : ''),
    }
  }
}

/** Every drawing in the vault, one after another; the ones migrated before are skipped. */
export async function migrateAll(
  vault: ExcalidrawVault,
  options: {
    onProgress?: (done: number, total: number, path: string) => void
    signal?: AbortSignal
  } = {}
): Promise<MigrationReport> {
  const paths = await vault.drawings()
  const known = await vault.migrated()
  const files: FileReport[] = []
  for (const [i, path] of paths.entries()) {
    if (options.signal?.aborted) break
    options.onProgress?.(i, paths.length, path)
    files.push(await migrateOne(vault, path, { known }))
  }
  options.onProgress?.(files.length, paths.length, '')
  return summarize(files)
}

export function summarize(files: FileReport[]): MigrationReport {
  const count = (status: FileReport['status']) => files.filter((f) => f.status === status).length
  return {
    files,
    migrated: count('migrated'),
    skipped: count('skipped'),
    failed: count('failed'),
  }
}

/** A report as plain lines, for the agent and for a log. */
export function reportText(report: MigrationReport): string {
  const head = `${report.migrated} migrated, ${report.skipped} skipped, ${report.failed} failed.`
  const lines = report.files.map((f) => {
    if (f.status === 'failed') return `- ${f.source}: failed — ${f.reason}`
    if (f.status === 'skipped') return `- ${f.source}: skipped — ${f.reason} (${f.target})`
    const lost = f.losses.length
      ? ` Not carried over: ${f.losses.map((l) => `${l.what} ×${l.count}`).join('; ')}.`
      : ' Nothing lost.'
    const references = f.references
      ? ` ${f.references.rewritten} references rewritten.` +
        f.references.files
          .filter((file) => file.error)
          .map((file) => ` Reference update failed in ${file.path}: ${file.error}.`)
          .join('')
      : ''
    return `- ${f.source} → ${f.target}.${lost}${references}`
  })
  return [head, ...lines].join('\n')
}
