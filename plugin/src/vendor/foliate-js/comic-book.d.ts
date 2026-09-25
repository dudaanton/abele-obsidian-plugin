// ABELE addition: typings for the parts of the vendored module Abele calls.
import type { FoliateBook } from './view'
export function makeComicBook(
  loader: {
    entries: { filename: string }[]
    loadBlob(name: string): Blob | null | Promise<Blob | null>
    getSize(name: string): number
  },
  file: { name: string }
): FoliateBook
