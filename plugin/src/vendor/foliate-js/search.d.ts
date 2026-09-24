// ABELE addition: typings for the parts of the vendored module Abele calls.
export interface SearchExcerpt {
  pre: string
  match: string
  post: string
}
export function search(
  strs: string[],
  query: string,
  options: { locales?: string; granularity?: 'grapheme' | 'word'; sensitivity?: string }
): Generator<{ range: unknown; excerpt: SearchExcerpt }>
export function searchMatcher(
  textWalker: unknown,
  opts: Record<string, unknown>
): (doc: Document, query: string) => Generator<{ range: Range; excerpt: SearchExcerpt }>
