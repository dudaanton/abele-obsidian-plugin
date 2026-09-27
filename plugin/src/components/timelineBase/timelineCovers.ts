/**
 * The covers the timeline draws, each loaded once and kept while it is drawn. The cache is
 * bounded — the least recently drawn picture goes past the limit — and loses what the base no
 * longer holds whenever its notes change, so a view left open over a changing base does not
 * collect every picture it ever showed.
 */
export const MAX_COVERS = 300

export class CoverCache {
  /** In the order last drawn, the newest last; null for a picture that failed. */
  private readonly images = new Map<string, HTMLImageElement | null>()

  constructor(
    private readonly make: (url: string) => HTMLImageElement,
    private readonly loaded: () => void,
    private readonly limit = MAX_COVERS
  ) {}

  /** The picture at `url` when it has loaded; null while it loads, or when it cannot. */
  get(url: string): HTMLImageElement | null {
    const known = this.images.get(url)
    if (known !== undefined) {
      this.images.delete(url)
      this.images.set(url, known)
      return known && known.complete && known.naturalWidth ? known : null
    }
    const img = this.make(url)
    img.addEventListener?.('load', () => this.loaded())
    img.addEventListener?.('error', () => {
      if (this.images.has(url)) this.images.set(url, null)
    })
    this.images.set(url, img)
    for (const old of this.images.keys()) {
      if (this.images.size <= this.limit) break
      this.forget(old)
    }
    return null
  }

  /** Lets go of every picture not among `urls`. */
  keepOnly(urls: ReadonlySet<string>): void {
    for (const url of [...this.images.keys()]) if (!urls.has(url)) this.forget(url)
  }

  urls(): string[] {
    return [...this.images.keys()]
  }

  clear(): void {
    for (const url of [...this.images.keys()]) this.forget(url)
  }

  private forget(url: string): void {
    const img = this.images.get(url)
    // A picture still loading stops: its request is dropped with its address.
    if (img && !img.complete) img.src = ''
    this.images.delete(url)
  }
}
