import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { parseDeck } from '@/slides/core/markdown'
import type { BlockRenderer, MediaResolver } from '@/slides/core/model'

const viewers: DeckViewer[] = []
afterEach(() => {
  viewers.splice(0).forEach((v) => v.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const media: MediaResolver = {
  resolve: (ref) => ({ url: ref, video: ref.endsWith('.mp4]]') }),
  readCss: async () => 'body { --sample-style: 1; } h1 { opacity: .9; }',
}
const made = (source: string, renderer?: BlockRenderer) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = vi.fn()
  const render = vi.fn(async (block, target) => {
    target.textContent = block.source
    return dispose
  })
  const viewer = new DeckViewer(host, renderer ?? { render }, media)
  viewers.push(viewer)
  return { viewer, host, dispose, render, load: () => viewer.setDeck(parseDeck(source)) }
}

describe('bounded deck rendering', () => {
  it('renders only current slide and neighbours and releases their processors when paging or closing', async () => {
    const { viewer, host, render, dispose, load } = made(
      Array.from({ length: 60 }, (_, i) => `# Slide ${i + 1}`).join('\n---\n')
    )
    await load()
    expect(render).toHaveBeenCalledTimes(2)
    expect(host.querySelectorAll('.abele-slide')).toHaveLength(2)
    expect(host.querySelectorAll('.abele-slide:not([hidden])')).toHaveLength(1)
    await viewer.go(30)
    expect(host.querySelectorAll('.abele-slide')).toHaveLength(3)
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.abele-deck-count')?.textContent).toBe('31 / 60')
    viewer.destroy()
    expect(dispose).toHaveBeenCalledTimes(5)
  })

  it('never renders speaker notes, scopes both CSS sources and keeps custom classes on the slide', async () => {
    const { host, load } = made(
      '---\ntype: presentation\ntheme: "[[sample.css]]"\n---\n::slide{layout=split class="sample-class"}::\n## Heading\n::left::\nLeft\n::right::\nRight\n\n> [!notes]\n> Private text\n\n```css\nbody { --inline: 1; }\n```'
    )
    await load()
    expect(host.textContent).not.toContain('Private text')
    expect(host.querySelector('.sample-class')).not.toBeNull()
    expect(host.querySelectorAll('.abele-slide-region')).toHaveLength(3)
    const style = host.querySelector('style')!.textContent!
    expect(style).toContain('--sample-style: 1')
    expect(style).toContain('--inline: 1')
    expect(style).not.toMatch(/(^|\})\s*body\s*\{/)
    expect(style).toContain('.abele-slide h1')
  })

  it('loads imported styles before scoping instead of exposing raw global imports', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const loader = vi.fn(async (reference: string, from = '') => {
      const id = new URL(reference, from || 'https://styles.example.test/').href
      return {
        id,
        css: id.endsWith('sample-child.css')
          ? 'body { --sample-import: 1 } .sample-accent h1 { opacity: .7 }'
          : '@import "./sample-child.css"; .sample-workspace { display: none !important }',
      }
    })
    const viewer = new DeckViewer(
      host,
      { render: async () => () => {} },
      { ...media, cssImport: loader }
    )
    viewers.push(viewer)
    await viewer.setDeck(
      parseDeck(
        '::slide{class=sample-accent}::\n# Sample\n\n```css\n@import url("https://styles.example.test/sample-parent.css") screen;\n```'
      )
    )
    const css = host.querySelector('style')!.textContent!
    expect(loader).toHaveBeenCalledTimes(2)
    expect(css).not.toMatch(/@import/i)
    expect(css).toContain('--sample-import: 1')
    expect(css).toContain('@media screen')
    expect(css).toContain('.abele-slide .sample-workspace')
    expect(css).not.toMatch(/(^|\})\s*\.sample-workspace\s*\{/)
  })

  it('pauses inactive videos, autoplays only on entry with muted inline playback, and offers manual playback on rejection', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new Error('not allowed'))
    const { viewer, host, load } = made(
      '::slide{bg="[[sample-video.mp4]]" autoplay}::\n# Video\n---\n# Next'
    )
    await load()
    await Promise.resolve()
    const video = host.querySelector('video')!
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)
    expect(play).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.abele-slide-play')?.textContent).toBe('Play video')
    await viewer.go('next')
    expect(pause).toHaveBeenCalled()
    expect(host.querySelectorAll('.abele-slide:not([hidden]) video')).toHaveLength(0)
  })

  it('pauses a pending playback attempt that finishes after its slide leaves', async () => {
    let finish!: () => void
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
      paused = true
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            paused = false
            resolve()
          }
        })
    )
    const { viewer, load } = made(
      '::slide{bg="[[sample-video.mp4]]" autoplay}::\n# Video\n---\n# Next'
    )
    await load()
    await viewer.go('next')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(paused).toBe(true)
  })

  it('cancels fullscreen that finishes after the presentation was exited', async () => {
    let finish!: () => void
    const { viewer, load } = made('# Example')
    await load()
    const exit = vi.fn(async () => {})
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    Object.defineProperty(viewer.root, 'requestFullscreen', {
      value: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            Object.defineProperty(document, 'fullscreenElement', {
              configurable: true,
              value: viewer.root,
            })
            resolve()
          }
        }),
    })
    const pending = viewer.present(true)
    viewer.exitPresenting()
    finish()
    await pending
    expect(exit).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  it('uses a host fullscreen controller and releases it when the view closes', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const native = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
      watchExited: vi.fn(() => vi.fn()),
    }
    const viewer = new DeckViewer(host, { render: async () => () => {} }, media, {
      fullscreenHost: native,
    })
    viewers.push(viewer)
    await viewer.setDeck(parseDeck('# Example'))
    await viewer.present(true)
    expect(native.enter).toHaveBeenCalledTimes(1)
    viewer.destroy()
    expect(native.exit).toHaveBeenCalledTimes(1)
    expect(native.watchExited.mock.results[0].value).toHaveBeenCalledTimes(1)
  })

  it('disposes late asynchronous renders even when the viewer has already closed', async () => {
    let finish!: (value: () => void) => void
    const disposed = vi.fn()
    const { viewer, load } = made('# Delayed', {
      render: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const pending = load()
    await Promise.resolve()
    await Promise.resolve()
    viewer.destroy()
    finish(disposed)
    await pending
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('does not steal keyboard or gestures from editable fields, links, media or live controls', async () => {
    const { viewer, host, load } = made('# One\n---\n# Two\n---\n# Three')
    await load()
    const input = document.createElement('input')
    host.querySelector('.abele-slide:not([hidden])')!.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(viewer.index).toBe(0)
    viewer.root.focus()
    viewer.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await viewer.ready
    expect(viewer.index).toBe(1)
    viewer.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true })
    )
    expect(viewer.index).toBe(1)
  })

  it('keeps foreign-window input keys and video controls independent of ambient constructors', async () => {
    // Happy DOM shares constructors across windows. Substitute a different realm's constructors
    // here while the document factory continues to produce its own native element instances.
    vi.stubGlobal('Element', class OtherRealmElement extends Element {})
    vi.stubGlobal('HTMLVideoElement', class OtherRealmVideo extends HTMLVideoElement {})
    const { viewer, host, load } = made(
      '::slide{bg="[[sample-window-video.mp4]]"}::\n# Window\n---\n# Next'
    )
    await load()
    const input = document.createElement('input')
    host.querySelector('.abele-slide:not([hidden])')!.append(input)
    expect(input instanceof Element).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(viewer.index).toBe(0)
    const video = host.querySelector('video')!
    expect(video instanceof HTMLVideoElement).toBe(false)
    expect(video.controls).toBe(true)
    expect(video.loop).toBe(true)
  })

  it('moves the same viewer into a window overlay and restores it on escape or destroy', async () => {
    const { viewer, host, load } = made('# One')
    await load()
    await viewer.present(false)
    expect(viewer.root.parentElement).toBe(document.body)
    expect(viewer.root.classList.contains('abele-deck-presenting')).toBe(true)
    viewer.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(viewer.root.parentElement).toBe(host)
    await viewer.present(false)
    viewer.destroy()
    expect(document.querySelector('.abele-deck-presenting')).toBeNull()
  })
})
