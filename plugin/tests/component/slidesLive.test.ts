import { afterEach, expect, it, vi } from 'vitest'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { parseDeck } from '@/slides/core/markdown'
import type { BlockRenderer, MediaResolver, ScriptBlock } from '@/slides/core/model'

const media: MediaResolver = { resolve: () => null, readCss: async () => '' }
const viewers: DeckViewer[] = []
afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy())
  document.body.replaceChildren()
})

it('decodes live blocks only at top level, preserving fenced examples', () => {
  const deck = parseDeck(
    '```slide-script\nscript: Sample report\nrefresh: enter\n```\n\n```slide-html\n<script>document.write(1)</script>\n```\n---\n    ```slide-html\n    inert\n    ```'
  )
  expect(deck.slides[0].regions[0].blocks.map((b) => b.type)).toEqual(['script', 'html'])
  expect(deck.slides[1].regions[0].blocks[0].type).toBe('markdown')
  expect(deck.slides[0].regions[0].blocks[0]).toMatchObject({
    name: 'Sample report',
    refresh: 'enter',
  })
})

it('starts only the active slide, stops its scripts and destroys its frame on navigation and close', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const stops: ReturnType<typeof vi.fn>[] = []
  const run = vi.fn(
    async (_name: string, _params: Record<string, unknown>, target: HTMLElement) => {
      target.textContent = 'Live data'
      const stop = vi.fn()
      stops.push(stop)
      return stop
    }
  )
  const renderer: BlockRenderer = { render: async () => () => {}, script: run }
  const viewer = new DeckViewer(host, renderer, media)
  viewers.push(viewer)
  await viewer.setDeck(
    parseDeck(
      '```slide-script\nscript: Sample report\nrefresh: enter\n```\n---\n```slide-html\n<button>Click</button><script>setInterval(() => {}, 100)</script>\n```'
    )
  )
  expect(run).toHaveBeenCalledTimes(1)
  await viewer.go('next')
  expect(stops[0]).toHaveBeenCalledTimes(1)
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!
  expect(frame.sandbox.contains('allow-scripts')).toBe(true)
  expect(frame.sandbox.contains('allow-same-origin')).toBe(false)
  expect(frame.srcdoc).toContain("default-src 'none'")
  await viewer.go('previous')
  expect(frame.isConnected).toBe(false)
  expect(run).toHaveBeenCalledTimes(2)
  viewer.destroy()
  expect(stops[1]).toHaveBeenCalledTimes(1)
})

it('keeps a static once result but rebuilds an interactive once view after leaving', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const staticRun = vi.fn(async (_block: ScriptBlock, target: HTMLElement) => {
    target.textContent = 'Snapshot'
    return () => {}
  })
  const viewRun = vi.fn(async (_block: ScriptBlock, target: HTMLElement) => {
    target.textContent = 'Button'
    return Object.assign(() => {}, { interactive: true })
  })
  const viewer = new DeckViewer(host, { render: async () => () => {}, script: staticRun }, media)
  viewers.push(viewer)
  await viewer.setDeck(parseDeck('```slide-script\nscript: Sample report\n```\n---\n# Other'))
  await viewer.go('next')
  await viewer.go('previous')
  expect(staticRun).toHaveBeenCalledTimes(1)
  viewer.destroy()
  const second = new DeckViewer(host, { render: async () => () => {}, script: viewRun }, media)
  viewers.push(second)
  await second.setDeck(parseDeck('```slide-script\nscript: Sample report\n```\n---\n# Other'))
  await second.go('next')
  await second.go('previous')
  expect(viewRun).toHaveBeenCalledTimes(2)
})

it('refreshes on a timer only while active and restarts the frame on reentry', async () => {
  vi.useFakeTimers()
  try {
    const host = document.createElement('div')
    document.body.append(host)
    const run = vi.fn(async () => () => {})
    const viewer = new DeckViewer(
      host,
      { render: async () => () => {}, script: run, allowNetwork: async () => true },
      media
    )
    viewers.push(viewer)
    await viewer.setDeck(
      parseDeck(
        '```slide-script\nscript: Sample report\nrefresh: 2s\n```\n---\n```slide-html\n<script>1</script>\n```'
      )
    )
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(2)
    await viewer.go('next')
    const first = host.querySelector<HTMLIFrameElement>('iframe')!
    expect(first.srcdoc).toContain('connect-src https:')
    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(2)
    await viewer.go('previous')
    await viewer.go('next')
    expect(first.isConnected).toBe(false)
    expect(host.querySelector('iframe')).not.toBe(first)
  } finally {
    vi.useRealTimers()
  }
})

it('does not run live blocks in presenter previews', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const script = vi.fn(async () => () => {})
  const viewer = new DeckViewer(host, { render: async () => () => {}, script }, media, {
    preview: true,
  })
  viewers.push(viewer)
  await viewer.setDeck(
    parseDeck(
      '```slide-script\nscript: Sample report\n```\n\n```slide-html\n<script>1</script>\n```'
    )
  )
  expect(script).not.toHaveBeenCalled()
  expect(host.querySelector('iframe')).toBeNull()
})
