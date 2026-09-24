// ABELE addition: typings for the parts of the vendored module Abele calls.
import type { FoliateBook } from './view'

export interface EpubLoader {
  loadText(name: string): string | null | Promise<string | null>
  loadBlob(name: string, type?: string): Blob | null | Promise<Blob | null>
  getSize(name: string): number
  sha1?: (data: Uint8Array) => Promise<Uint8Array>
}

export class EPUB implements FoliateBook {
  constructor(loader: EpubLoader)
  init(): Promise<this>
  sections: FoliateBook['sections']
  toc?: FoliateBook['toc']
  metadata?: FoliateBook['metadata']
  rendition?: FoliateBook['rendition']
  dir?: string
  transformTarget?: EventTarget
  resolveHref(href: string): { index: number; anchor: (doc: Document) => Element | Range | number | null } | null
  loadDocument(item: unknown): Promise<Document>
  [key: string]: unknown
}
