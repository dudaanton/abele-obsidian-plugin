import type { english as en } from './catalogs'
export type MessageKey = keyof typeof en
type Slots<S extends string> = S extends `${string}{${infer P}}${infer Tail}`
  ? P | Slots<Tail>
  : never
type Entry<K extends MessageKey> = (typeof en)[K]
type Names<K extends MessageKey> =
  Entry<K> extends string
    ? Slots<Entry<K>>
    : Entry<K> extends Record<string, string>
      ? Slots<Entry<K>[keyof Entry<K>]> | 'count'
      : never
export type Params<K extends MessageKey> = {
  [P in Names<K>]: P extends 'count' ? number : string | number
}
export type TranslationArgs<K extends MessageKey> = [Names<K>] extends [never]
  ? []
  : [params: Params<K>]
