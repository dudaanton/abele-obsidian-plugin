/** Portable presentation data. Markdown is one codec, not the storage contract. */
export const LAYOUTS = ['title', 'section', 'content', 'split', 'grid', 'image', 'quote'] as const
export type Layout = (typeof LAYOUTS)[number]
export type Aspect = '16:9' | '4:3' | '9:16'
export type Attribute = string | boolean

export interface MarkdownBlock {
  type: 'markdown'
  source: string
}

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
  regions: { name: 'body' | 'left' | 'right' | 'cell'; blocks: MarkdownBlock[] }[]
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
}

export interface MediaResolver {
  resolve(reference: string): { url: string; video: boolean } | null
  readCss(reference: string): Promise<string>
}

export interface DeckSource {
  read(): Promise<Deck>
  watch(changed: () => void): () => void
}
