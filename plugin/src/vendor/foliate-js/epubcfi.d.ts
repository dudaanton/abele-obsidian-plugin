// ABELE addition: typings for the parts of the vendored module Abele calls.
export const isCFI: RegExp
export function compare(a: string, b: string): number
export function parse(cfi: string): unknown
export function fromRange(range: Range, filter?: (node: Node) => number): string
export function toRange(doc: Document, parts: unknown, filter?: (node: Node) => number): Range
export function collapse(cfi: string, toEnd?: boolean): string
export const fake: { fromIndex(index: number): string; toIndex(parts: unknown): number }
