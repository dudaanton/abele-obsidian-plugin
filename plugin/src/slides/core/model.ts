/** Portable presentation data. Markdown is one codec, not the storage contract. */
export const LAYOUTS = ['title', 'section', 'content', 'split', 'grid', 'image', 'quote'] as const
export type Layout = (typeof LAYOUTS)[number]
export type Aspect = '16:9' | '4:3' | '9:16'
export type Attribute = string | boolean

export interface MarkdownBlock {
  type: 'markdown'
  source: string
}

export interface ScriptBlock {
  type: 'script'
  name: string
  params: Record<string, unknown>
  refresh: 'once' | 'enter' | number
}

export interface HtmlBlock {
  type: 'html'
  source: string
}

export type SlideBlock = MarkdownBlock | ScriptBlock | HtmlBlock

export interface SlideSettings {
  layout: Layout
  bg: string
  dim: number
  fit: 'cover' | 'contain'
  autoplay: boolean
  className: string
  /** Unknown directives survive a decode/encode, including those used by later stages. */
  attributes: Record<string, Attribute>
}

export interface Slide {
  settings: SlideSettings
  title: string
  regions: { name: 'body' | 'left' | 'right' | 'cell'; blocks: SlideBlock[] }[]
  notes: MarkdownBlock[]
  /** Codec locations for reading-mode dividers. Not part of the stored slide's identity. */
  sourceLine?: number
  markerLine?: number
}

export interface Deck {
  settings: {
    aspect: Aspect
    theme: string
    properties: Record<string, unknown>
  }
  slides: Slide[]
  css: string
}

/** Some embedded browsers delegate fullscreen to their native window instead of the DOM API. */
export interface FullscreenHost {
  enter(): Promise<void>
  exit(): Promise<void>
  watchExited?(exited: () => void): () => void
}

/** The adapter owns rendering lifetimes, including live markdown processors. */
export interface BlockRenderer {
  render(block: MarkdownBlock, target: HTMLElement): Promise<() => void>
  /** A named script, admitted by the host's script service; signal revokes the run on exit. */
  script?(block: ScriptBlock, target: HTMLElement, signal: AbortSignal): Promise<() => void>
  /** A remembered, per-deck network decision. Absent means no network. */
  allowNetwork?(deck: Deck): Promise<boolean>
}

export interface CssSource {
  css: string
  /** Canonical identity/base for relative imports and cycle detection, supplied by the host. */
  id: string
  assetUrl?(this: void, reference: string): string
}

export type CssImportLoader = (reference: string, relativeTo?: string) => Promise<CssSource>

export interface MediaResolver {
  resolve(reference: string): { url: string; video: boolean } | null
  readCss(reference: string): Promise<string>
  /** Imported rules must be loaded as text and scoped, never emitted as browser @imports. */
  cssImport?: CssImportLoader
}

export interface DeckSource {
  read(): Promise<Deck>
  watch(changed: () => void): () => void
}
