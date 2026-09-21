import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian'
import { parseMapBlock } from '@/helpers/mapConfig'
import { renderMap, type MapHandle } from '@/helpers/mapRender'

/**
 * ```abele-map``` — a map in a note.
 *
 * The block is the one way a map is written down, whether a person typed it or an agent put
 * it in a note it was filling in. The chat draws its own maps from tool results, but through
 * the same renderer, so there is one map in the plugin rather than two that drift.
 */
class MapRenderChild extends MarkdownRenderChild {
  constructor(
    el: HTMLElement,
    private readonly dispose: () => void
  ) {
    super(el)
  }

  onunload(): void {
    this.dispose()
  }
}

export function registerMapCodeblock(
  registerFn: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  registerFn('abele-map', (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const parsed = parseMapBlock(source)

    if ('error' in parsed) {
      el.createDiv({ cls: 'abele-map-error', text: parsed.error })
      return
    }

    const container = el.createDiv({ cls: 'abele-map' })
    container.style.height = `${parsed.height}px`

    let handle: MapHandle | null = null
    let gone = false

    // The renderer loads MapLibre on demand, so the block can be scrolled out of the note —
    // and unloaded — before the map ever exists. Whichever finishes first wins.
    void renderMap(container, parsed)
      .then((made) => {
        if (gone) made.destroy()
        else handle = made
      })
      .catch((error: unknown) => {
        container.remove()
        const message = error instanceof Error ? error.message : 'Unknown error'
        el.createDiv({ cls: 'abele-map-error', text: `Map error: ${message}` })
      })

    ctx.addChild(
      new MapRenderChild(container, () => {
        gone = true
        handle?.destroy()
      })
    )
  })
}
