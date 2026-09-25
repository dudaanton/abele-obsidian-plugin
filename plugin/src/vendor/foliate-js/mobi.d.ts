// ABELE addition: typings for the parts of the vendored module Abele calls.
import type { FoliateBook } from './view'
export function isMOBI(file: Blob): Promise<boolean>
export class MOBI {
  constructor(opts: { unzlib: (data: Uint8Array) => Uint8Array })
  open(file: Blob): Promise<FoliateBook>
}
