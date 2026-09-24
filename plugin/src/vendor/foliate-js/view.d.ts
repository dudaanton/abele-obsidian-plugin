// ABELE addition: typings for the parts of the vendored module Abele calls.
export interface FoliateTocItem {
  label: string
  href: string
  subitems?: FoliateTocItem[]
}

export interface FoliateSection {
  id: unknown
  load(): string | Promise<string>
  unload?(): void
  createDocument?(): Document | Promise<Document>
  size: number
  linear?: string
  cfi?: string
}

export interface FoliateBook {
  sections: FoliateSection[]
  toc?: FoliateTocItem[]
  metadata?: Record<string, unknown> & { title?: unknown; author?: unknown; language?: unknown }
  rendition?: { layout?: string; [key: string]: unknown }
  dir?: string
  transformTarget?: EventTarget
  [key: string]: unknown
}

export interface FoliateLocation {
  fraction?: number
  cfi?: string
  tocItem?: { label?: string; href?: string } | null
  location?: { current: number; next: number; total: number }
  section?: { current: number; total: number }
  range?: Range
}

export interface FoliateRenderer extends HTMLElement {
  getContents(): { doc: Document; index: number; overlayer?: unknown }[]
  destroy?(): void
  next(): Promise<void>
  prev(): Promise<void>
}

export class View extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  lastLocation: FoliateLocation | null
  isFixedLayout: boolean
  open(book: FoliateBook): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number | { fraction: number }): Promise<unknown>
  goToFraction(fraction: number): Promise<void>
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
}

export class UnsupportedTypeError extends Error {}
export class NotFoundError extends Error {}
export function makeBook(file: Blob): Promise<FoliateBook>

declare global {
  interface HTMLElementTagNameMap {
    'foliate-view': View
  }
}
