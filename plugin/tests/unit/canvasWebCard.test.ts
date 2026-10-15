import { describe, expect, it, vi } from 'vitest'
import { hostCanvasViewer } from '@/canvas/adapter'
import * as painter from '@/canvas/core/painter'
import {
  WebCard,
  addressLabel,
  framingRefused,
  pageTitle,
  type WebCardPorts,
} from '@/canvas/webCard'
import { useVault } from '../helpers/testEnv'

// The cards' frames are given addresses; the test page never loads them.
const dom = (
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM
if (dom) dom.settings.disableIframePageLoading = true
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const ports = (over: Partial<WebCardPorts> = {}): WebCardPorts => ({
  desktop: false,
  probe: async () => ({ headers: {}, text: '<title>Sample page</title>' }),
  open: vi.fn(),
  ...over,
})
const card = (port: WebCardPorts, url = 'https://sample.example/page') => {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new WebCard(parent, url, port)
}
const shown = (web: WebCard) => ({
  state: web.el.dataset.webState,
  frame: web.el.querySelector('iframe,webview')?.tagName.toLowerCase() ?? null,
  title: web.el.querySelector('.abele-canvas-web__title')?.textContent,
  open: !!web.el.querySelector('[aria-label="Open web page"]'),
  live: web.el.dataset.webLive,
})

describe('what a page allows', () => {
  it('reads framing refusals from either header, in any case', () => {
    expect(framingRefused({})).toBe(false)
    expect(framingRefused({ 'X-Frame-Options': 'DENY' })).toBe(true)
    expect(framingRefused({ 'x-frame-options': 'sameorigin' })).toBe(true)
    expect(framingRefused({ 'content-security-policy': "default-src 'self'" })).toBe(false)
    expect(framingRefused({ 'content-security-policy': "frame-ancestors 'none'" })).toBe(true)
    expect(
      framingRefused({ 'Content-Security-Policy': "script-src 'self'; frame-ancestors 'self'" })
    ).toBe(true)
    expect(framingRefused({ 'content-security-policy': 'frame-ancestors *' })).toBe(false)
  })
  it('takes the title from the markup and names an address without its scheme', () => {
    expect(pageTitle('<html><head><title>\n Sample &amp; page </title>')).toBe('Sample & page')
    expect(pageTitle('<html><body>none</body>')).toBeNull()
    expect(addressLabel('https://sample.example/')).toBe('sample.example')
    expect(addressLabel('http://127.0.0.1:9/sample?q=1')).toBe('127.0.0.1:9/sample?q=1')
  })
})

describe('a web card on a phone', () => {
  it('frames a page that allows it, under its title, and lets it take input only when live', async () => {
    const web = card(ports())
    expect(shown(web).state).toBe('loading')
    await settle()
    expect(shown(web)).toMatchObject({ state: 'page', frame: 'iframe', title: 'Sample page' })
    const frame = web.el.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.src).toBe('https://sample.example/page')
    expect(shown(web).live).toBe('false')
    web.setLive(true)
    expect(shown(web).live).toBe('true')
    web.setLive(false)
    expect(shown(web).live).toBe('false')
  })
  it('shows a refusing site as a card with its title, address and Open, never an empty frame', async () => {
    const open = vi.fn()
    const web = card(
      ports({
        open,
        probe: async () => ({
          headers: { 'x-frame-options': 'DENY' },
          text: '<title>Sample refused</title>',
        }),
      })
    )
    await settle()
    expect(shown(web)).toMatchObject({ state: 'card', frame: null, title: 'Sample refused' })
    expect(web.el.textContent).toContain('sample.example/page')
    web.setLive(true)
    expect(shown(web).live).toBe('false')
    const button = web.el.querySelector<HTMLButtonElement>('[aria-label="Open web page"]')!
    const down = new Event('pointerdown', { bubbles: true })
    const below = vi.fn()
    web.el.addEventListener('pointerdown', below)
    button.dispatchEvent(down)
    button.click()
    expect(below).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('https://sample.example/page')
  })
  it('shows an address that does not answer as a card named by its address', async () => {
    const web = card(
      ports({
        probe: () => Promise.reject(new Error('Sample offline')),
      })
    )
    await settle()
    expect(shown(web)).toMatchObject({ state: 'card', title: 'sample.example/page', open: true })
  })
  it('does not load an address that is not a web one', () => {
    const probe = vi.fn()
    const web = card(ports({ probe }), 'file:///sample')
    expect(probe).not.toHaveBeenCalled()
    expect(shown(web)).toMatchObject({ state: 'card', open: true })
  })
})

describe('a web card on the desktop', () => {
  it('shows the page in a page of its own in the vault session, titled by the page, failing to a card', () => {
    const web = card(ports({ desktop: true, partition: 'persist:vault-sample' }))
    const view = web.el.querySelector('webview') as HTMLElement & {
      partition: string
      src: string
      getTitle(): string
    }
    expect(view.partition).toBe('persist:vault-sample')
    expect(view.src).toBe('https://sample.example/page')
    expect(shown(web).title).toBe('sample.example/page')
    view.getTitle = () => 'Sample desktop page'
    view.dispatchEvent(new Event('page-title-updated'))
    expect(shown(web)).toMatchObject({ state: 'page', title: 'Sample desktop page', open: true })
    // A load given up for the next one is not a failure.
    view.dispatchEvent(
      Object.assign(new Event('did-fail-load'), { errorCode: -3, isMainFrame: true })
    )
    expect(shown(web).state).toBe('page')
    view.dispatchEvent(
      Object.assign(new Event('did-fail-load'), { errorCode: -105, isMainFrame: true })
    )
    expect(shown(web)).toMatchObject({ state: 'card', frame: null, open: true })
  })
})

it('puts a web card on a canvas link node and lets only the one picked card take input', () => {
  const app = useVault([]),
    el = document.createElement('div')
  document.body.append(el)
  const viewer = hostCanvasViewer(app as never, el, () => 'sample.canvas')
  viewer.load({
    nodes: [
      {
        id: 'page',
        type: 'link',
        url: 'https://sample.example/',
        x: 0,
        y: 0,
        width: 400,
        height: 280,
      },
      { id: 'words', type: 'text', text: 'Sample', x: 450, y: 0, width: 200, height: 100 },
    ],
    edges: [],
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 900 },
    clientHeight: { value: 600 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  const draw = () => (viewer as unknown as { paint(): void }).paint()
  const web = () => el.querySelector<HTMLElement>('[data-card-id="page"] .abele-canvas-web')
  try {
    draw()
    expect(web()).not.toBeNull()
    // Its address is not also painted under the page.
    expect(paint.mock.calls.at(-1)?.[4]?.contents?.get('page')).toBe('')
    const card = web()
    const live = vi.spyOn(WebCard.prototype, 'setLive')
    // The card is the same element across repaints: the page is not loaded again.
    viewer.selection = new Set(['page'])
    draw()
    expect(web()).toBe(card)
    expect(live).toHaveBeenLastCalledWith(true)
    viewer.selection = new Set(['page', 'words'])
    draw()
    expect(live).toHaveBeenLastCalledWith(false)
    viewer.selection = new Set(['page'])
    ;(viewer as unknown as { gesture: object | null }).gesture = { x: 0, y: 0 }
    draw()
    expect(live).toHaveBeenLastCalledWith(false)
    ;(viewer as unknown as { gesture: object | null }).gesture = null
    live.mockRestore()
  } finally {
    viewer.destroy()
    el.remove()
    paint.mockRestore()
    context.mockRestore()
  }
})
