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
  // Interactive frames require explicit network consent; the separate offline test pins refusal.
  const renderer: BlockRenderer = {
    render: async () => () => {},
    script: run,
    allowNetwork: async () => true,
  }
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

it('renders offline HTML as labelled static content with no script or navigation capability', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const viewer = new DeckViewer(host, { render: async () => () => {} }, media)
  viewers.push(viewer)
  await viewer.setDeck(
    parseDeck(
      '```slide-html\n<h2>Static sample</h2><script>location.replace("https://sample.example.test/leak")</script><meta http-equiv="refresh" content="0;url=https://sample.example.test/leak"><a href="https://sample.example.test/leak" ping="https://sample.example.test/ping">Link</a><svg><a href="https://sample.example.test/leak"><text>Go</text></a></svg><iframe src="https://sample.example.test/leak"></iframe><form action="https://sample.example.test/leak"><input type="submit"></form><img src="https://sample.example.test/image.png">\n```'
    )
  )
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(host.textContent).toContain('Offline HTML — static only; scripts disabled')
  const source = new DOMParser().parseFromString(frame.srcdoc, 'text/html')
  expect(source.querySelector('h2')?.textContent).toBe('Static sample')
  expect(
    source.querySelector(
      'script, a[href], a[ping], svg, iframe, form, img[src], meta[http-equiv="refresh"]'
    )
  ).toBeNull()
  expect(frame.srcdoc).toContain("script-src 'none'")
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

it('rejects late script activations after leave and return without leaking refresh timers', async () => {
  vi.useFakeTimers()
  try {
    const host = document.createElement('div')
    document.body.append(host)
    const pending: (() => void)[] = []
    const stops: ReturnType<typeof vi.fn>[] = []
    const script = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          const stop = vi.fn()
          stops.push(stop)
          pending.push(() => resolve(stop))
        })
    )
    const viewer = new DeckViewer(host, { render: async () => () => {}, script }, media)
    viewers.push(viewer)
    const load = viewer.setDeck(
      parseDeck('```slide-script\nscript: Sample report\nrefresh: 2s\n```\n---\n# Other')
    )
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await viewer.go(1)
    const returned = viewer.go(0)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(script).toHaveBeenCalledTimes(2)
    pending.splice(0).forEach((resolve) => resolve())
    await Promise.all([load, returned])
    await vi.advanceTimersByTimeAsync(0)
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    viewer.destroy()
    await vi.advanceTimersByTimeAsync(6000)
    expect(script).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('rejects late HTML consent continuations after leave and return', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const pending: ((allowed: boolean) => void)[] = []
  const allowNetwork = vi.fn(() => new Promise<boolean>((resolve) => pending.push(resolve)))
  const viewer = new DeckViewer(host, { render: async () => () => {}, allowNetwork }, media)
  viewers.push(viewer)
  const load = viewer.setDeck(parseDeck('```slide-html\n<script>1</script>\n```\n---\n# Other'))
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await viewer.go(1)
  const returned = viewer.go(0)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(allowNetwork).toHaveBeenCalledTimes(2)
  pending.splice(0).forEach((resolve) => resolve(true))
  await Promise.all([load, returned])
  await Promise.resolve()
  expect(host.querySelectorAll('iframe')).toHaveLength(1)
  await viewer.go(1)
  expect(host.querySelectorAll('iframe')).toHaveLength(0)
  viewer.destroy()
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
