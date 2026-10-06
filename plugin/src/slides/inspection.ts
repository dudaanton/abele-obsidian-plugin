import { Component, type App } from 'obsidian'
import domtoimage from 'dom-to-image-more'
import { renderUntrustedMarkdown } from '@/markdown/renderUntrusted'
import { DeckViewer } from './core/DeckViewer'
import { fitSlide } from './core/navigation'
import { checkSlideFit, type SlideFit } from './core/fit'
import type { Deck } from './core/model'
import { noteMedia } from './adapter'
import { checkDeckCss, checkSlideDensity, type DensityWarning } from './core/density'

export interface DeckInspection extends SlideFit {
  slide: number
  title: string
  layout: string
  unverified: string[]
  warnings: DensityWarning[]
  generated?: 'sources'
}

/** The same fixed canvas and theme as the audience, without activating scripts, frames,
 * autoplay or consent. Agent previews use the existing untrusted Markdown policy. */
export async function inspectDeckSlide<T>(
  app: App,
  path: string,
  deck: Deck,
  index: number,
  use: (root: HTMLElement, report: DeckInspection) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const doc = activeDocument
  const host = doc.win.createDiv({ cls: 'abele-deck-inspection-host' })
  const { width, height } = fitSlide(1280, 1280, deck.settings.aspect)
  host.setCssProps({ width: `${width}px`, height: `${height}px` })
  host.setAttribute('aria-hidden', 'true')
  doc.body.append(host)
  const original = deck.slides[index]
  const unverified: string[] = []
  const slide = {
    ...original,
    settings: {
      ...original.settings,
      attributes: { ...original.settings.attributes, transition: 'none' },
    },
    regions: original.regions.map((region) => ({
      ...region,
      blocks: region.blocks.map((block) => {
        if (block.type === 'markdown') return block
        const label = block.type === 'script' ? `Script: ${block.name}` : 'Slide HTML'
        unverified.push(
          `${label}: not executed in agent preview; live content and fit must be checked during a user-started show`
        )
        return {
          type: 'markdown' as const,
          source: `> ${label.replace(/[\r\n]/g, ' ')} — not executed in agent preview.`,
        }
      }),
    })),
  }
  const viewer = new DeckViewer(
    host,
    {
      async render(block, target) {
        const owner = new Component()
        owner.load()
        try {
          await renderUntrustedMarkdown(target, block.source, owner, path)
          return () => owner.unload()
        } catch (error) {
          owner.unload()
          throw error
        }
      },
    },
    noteMedia(app, () => path),
    { preview: true, revealAll: true, slideOffset: index }
  )
  try {
    viewer.toolbar.hidden = true
    viewer.root.classList.add('abele-deck-inspection')
    await viewer.setDeck({ ...deck, slides: [slide] })
    signal?.throwIfAborted()
    await doc.fonts?.ready
    const canvas = viewer.viewport.querySelector<HTMLElement>('.abele-slide')!
    // Await images and video metadata, never playback. A broken/slow resource becomes a fit
    // finding after a bounded wait; charts and other async blocks get a short settling window.
    await Promise.all(
      Array.from(canvas.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')).map(
        (image) => {
          const event = 'complete' in image ? 'load' : 'loadedmetadata'
          if ('complete' in image ? image.complete : image.readyState >= 1 || image.error)
            return Promise.resolve()
          if ('preload' in image) image.preload = 'metadata'
          return new Promise<void>((resolve) => {
            const finish = () => {
              doc.win.clearTimeout(timer)
              image.removeEventListener(event, finish)
              image.removeEventListener('error', finish)
              resolve()
            }
            const timer = doc.win.setTimeout(finish, 1500)
            image.addEventListener(event, finish, { once: true })
            image.addEventListener('error', finish, { once: true })
          })
        }
      )
    )
    await new Promise((resolve) => doc.win.setTimeout(resolve, 250))
    signal?.throwIfAborted()
    const report: DeckInspection = {
      slide: index + 1,
      title: original.title,
      layout: original.settings.layout,
      ...checkSlideFit(canvas),
      warnings: [
        ...(original.generated ? [] : checkSlideDensity(canvas)),
        ...checkDeckCss(deck.css),
      ],
      ...(original.generated ? { generated: original.generated } : {}),
      unverified,
    }
    return await use(viewer.root, report)
  } finally {
    viewer.destroy()
    host.remove()
  }
}

export function slidePicture(
  root: HTMLElement,
  aspect: Deck['settings']['aspect']
): Promise<string> {
  const { width, height } = fitSlide(1280, 1280, aspect)
  // Keep the deck root and its scoped stylesheet in the clone, not just the slide section.
  return domtoimage.toPng(root, { width, height })
}
