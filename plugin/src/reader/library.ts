/** Reader-file snapshots. The source is independent of vault/file APIs for other clients. */
import type { BookPlace, BookPlaces } from './positions'

export interface ReaderFile {
  path: string
  format: string
}
export interface ReaderBook {
  path: string
  format: string
  title: string | null
  author: string | null
  position: { cfi: string; fraction: number; at: number | null } | null
  progress: number | null
  pageCount: number | null
  currentPage: number | null
  pageUnit: 'locations' | 'pages' | null
  finished: boolean
  lastOpenedAt: number | null
  lastPositionAt: number | null
  /** Null unless a reader tab has already indexed its highlights. */
  highlightCount: number | null
}

export interface ReaderLibrarySource {
  files(): readonly ReaderFile[]
  places: Pick<BookPlaces, 'snapshot'>
  highlightCount?(path: string): number | null
}

const formats = new Set(['epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'cbz', 'pdf'])
const timestamp = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
const fraction = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null
const name = (n: unknown): string | null => (typeof n === 'string' && n.trim() ? n.trim() : null)

function describe(
  file: ReaderFile,
  place: BookPlace | undefined,
  highlights: number | null
): ReaderBook {
  const saved = place?.cfi ? fraction(place.fraction) : null
  const measure = place?.measure
  const count =
    measure &&
    (measure.kind === 'pages' || measure.kind === 'locations') &&
    Number.isSafeInteger(measure.count) &&
    measure.count > 0
      ? measure.count
      : null
  const lastPositionAt = timestamp(place?.at)
  return {
    path: file.path,
    format: file.format.toLowerCase(),
    title: name(place?.title),
    author: name(place?.author),
    position: saved === null ? null : { cfi: place!.cfi, fraction: saved, at: lastPositionAt },
    progress: saved,
    pageCount: count,
    currentPage:
      count !== null && saved !== null
        ? Math.max(1, Math.min(count, Math.ceil(saved * count)))
        : null,
    pageUnit: count === null ? null : measure!.kind,
    finished: saved === 1,
    lastOpenedAt: timestamp(place?.openedAt),
    lastPositionAt,
    highlightCount: highlights,
  }
}

export class ReaderLibrary {
  constructor(private readonly source: ReaderLibrarySource) {}

  async list(): Promise<ReaderBook[]> {
    const positions = await this.source.places.snapshot()
    return this.source
      .files()
      .filter((f) => formats.has(f.format.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) =>
        describe(
          file,
          positions.get(file.path)?.place,
          this.source.highlightCount?.(file.path) ?? null
        )
      )
  }

  async get(path: string): Promise<ReaderBook | null> {
    const file = this.source
      .files()
      .find((f) => f.path === path && formats.has(f.format.toLowerCase()))
    if (!file) return null
    const place = (await this.source.places.snapshot()).get(path)?.place
    return describe(file, place, this.source.highlightCount?.(path) ?? null)
  }
}
