/**
 * A web page on the canvas, shown the way Obsidian Canvas shows its link nodes: on the desktop in
 * a page of its own (a `webview` in the vault's browsing session, which a site cannot refuse), on
 * a phone in a sandboxed frame. Where the page cannot be shown — the site forbids framing, the
 * address does not answer — the card says what it is, with its title, its address and Open, so a
 * web card is never an empty box.
 *
 * The page takes input only while its card is the one picked, as Obsidian's does once its node is
 * focused: until then a press anywhere on it is the canvas's, so picking, moving and the tools
 * keep working over it.
 */
import { Platform, requestUrl, setIcon } from 'obsidian'
import { openExternal } from '../helpers/openExternal'

export type WebCardState = 'loading' | 'page' | 'card'

/** Whether a response's headers forbid showing the page inside another page. */
export function framingRefused(headers: Record<string, string>): boolean {
  const header = (name: string) =>
    Object.entries(headers)
      .filter(([key]) => key.toLowerCase() === name)
      .map(([, value]) => String(value))
      .join(',')
  if (/\b(deny|sameorigin)\b/i.test(header('x-frame-options'))) return true
  for (const policy of header('content-security-policy').split(',')) {
    const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(policy)?.[1]?.trim()
    // Only a policy letting any page frame it lets this one: the canvas's own page is the app's.
    if (ancestors !== undefined && !/(^|\s)\*(\s|$)/.test(ancestors)) return true
  }
  return false
}

/** The page's own title from its markup, when it has one. */
export function pageTitle(html: string): string | null {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  if (!raw) return null
  const text = new DOMParser()
    .parseFromString(`<p>${raw}</p>`, 'text/html')
    .body.textContent?.replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** How an address reads on its card: the site and the page, without the scheme. */
export function addressLabel(url: string): string {
  try {
    const parsed = new URL(url),
      rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
    return `${parsed.host}${rest}`
  } catch {
    return url
  }
}

export interface WebCardPorts {
  /** Whether pages are shown in a page of their own (the desktop app) rather than a frame. */
  desktop: boolean
  /** The vault's browsing session, as Obsidian's own web pages use. */
  partition?: string
  /** Reads the address once, for its title and whether it may be framed (the phone's frame). */
  probe(url: string): Promise<{ headers: Record<string, string>; text: string }>
  open(url: string): void
}

const PROBE_TIMEOUT = 10_000

export function obsidianWebCardPorts(app: unknown): WebCardPorts {
  const partition = (app as { getWebviewPartition?: () => string }).getWebviewPartition?.()
  return {
    desktop: Platform.isDesktopApp,
    partition,
    probe: async (url) => {
      const response = await Promise.race([
        requestUrl({ url, method: 'GET', throw: false }),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('The page did not answer')), PROBE_TIMEOUT)
        ),
      ])
      let text = ''
      try {
        text = response.text
      } catch {
        /* Not text: no title to read. */
      }
      return { headers: response.headers, text }
    },
    open: (url) => void openExternal(url, '_blank'),
  }
}

interface Webview extends HTMLElement {
  src: string
  partition: string
  allowpopups: boolean
  getTitle(): string
}

export class WebCard {
  readonly el: HTMLElement
  private readonly page: HTMLElement
  private readonly face: HTMLElement
  private frame: HTMLElement | null = null
  private title: string | null = null
  private reason = ''
  private destroyed = false
  state: WebCardState = 'loading'

  constructor(
    parent: HTMLElement,
    readonly url: string,
    private readonly ports: WebCardPorts
  ) {
    this.el = parent.createDiv({ cls: 'abele-canvas-web' })
    this.el.dataset.webLive = 'false'
    this.face = this.el.createDiv({ cls: 'abele-canvas-web__face' })
    this.page = this.el.createDiv({ cls: 'abele-canvas-web__page' })
    if (!/^https?:\/\//i.test(url)) this.fail('Only web addresses can be shown here')
    else if (ports.desktop) this.webview()
    else void this.framed()
    this.render()
  }

  /** The page takes input: its card is the one picked and nothing is being dragged. */
  setLive(live: boolean): void {
    const value = String(live && this.state === 'page')
    if (this.el.dataset.webLive !== value) this.el.dataset.webLive = value
  }

  destroy(): void {
    this.destroyed = true
    this.frame?.remove()
    this.el.remove()
  }

  private webview(): void {
    // Its session is set before it is given an address, which is when it starts loading.
    const view = this.page.createEl('webview' as 'div') as unknown as Webview
    if (this.ports.partition) {
      view.partition = this.ports.partition
      // As Obsidian prepares its own web pages' session before the first one opens.
      try {
        ;(
          window.require?.('electron') as
            | { ipcRenderer?: { send(channel: string, ...args: unknown[]): void } }
            | undefined
        )?.ipcRenderer?.send('create-browser-session', this.ports.partition, null)
      } catch (error) {
        console.debug('[canvas-web] no browser session', error)
      }
    }
    view.allowpopups = true
    view.addClass('abele-canvas-web__frame')
    const shown = () => {
      if (this.state !== 'loading') return
      this.state = 'page'
      this.render()
    }
    view.addEventListener('page-title-updated', () => {
      this.title = view.getTitle() || null
      shown()
      this.render()
    })
    view.addEventListener('dom-ready', shown)
    view.addEventListener('did-finish-load', shown)
    view.addEventListener('did-fail-load', (event) => {
      const { errorCode, isMainFrame, errorDescription } = event as unknown as {
        errorCode: number
        isMainFrame: boolean
        errorDescription: string
      }
      // -3 is a load given up for the next one (a redirect, a link followed), not a failure.
      if (!isMainFrame || errorCode === -3) return
      console.debug('[canvas-web] page failed', { errorCode, errorDescription })
      this.fail("Couldn't load the page")
    })
    view.src = this.url
    this.frame = view
  }

  private async framed(): Promise<void> {
    let probe: { headers: Record<string, string>; text: string }
    try {
      probe = await this.ports.probe(this.url)
    } catch (error) {
      console.debug('[canvas-web] page did not answer', error)
      if (!this.destroyed) this.fail("Couldn't reach the page")
      return
    }
    if (this.destroyed) return
    this.title = pageTitle(probe.text)
    if (framingRefused(probe.headers)) {
      this.fail("This site doesn't allow being shown inside the canvas")
      return
    }
    const frame = this.page.createEl('iframe', { cls: 'abele-canvas-web__frame' })
    frame.setAttribute(
      'sandbox',
      'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals'
    )
    frame.setAttribute('allow', 'fullscreen')
    frame.src = this.url
    this.frame = frame
    this.state = 'page'
    this.render()
  }

  private fail(reason: string): void {
    this.frame?.remove()
    this.frame = null
    this.reason = reason
    this.state = 'card'
    this.setLive(false)
    this.render()
  }

  private openButton(parent: HTMLElement, text?: string): void {
    const button = parent.createEl('button', {
      cls: text ? 'abele-canvas-web__open' : 'clickable-icon abele-canvas-web__open',
      attr: { 'aria-label': 'Open web page', type: 'button' },
    })
    if (text) button.setText(text)
    else setIcon(button, 'external-link')
    // The canvas underneath would take the press as a pick or a drag of the card.
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      this.ports.open(this.url)
    })
  }

  private render(): void {
    if (this.destroyed) return
    this.el.dataset.webState = this.state
    this.face.empty()
    const name = this.title ?? addressLabel(this.url)
    if (this.state === 'card') {
      this.face.addClass('abele-canvas-web__face_card')
      const icon = this.face.createDiv({ cls: 'abele-canvas-web__icon' })
      setIcon(icon, 'globe')
      this.face.createDiv({ cls: 'abele-canvas-web__title', text: name })
      if (this.title)
        this.face.createDiv({ cls: 'abele-canvas-web__address', text: addressLabel(this.url) })
      if (this.reason) this.face.createDiv({ cls: 'abele-canvas-web__reason', text: this.reason })
      this.openButton(this.face, 'Open')
      this.page.toggle(false)
      return
    }
    this.face.removeClass('abele-canvas-web__face_card')
    const icon = this.face.createSpan({ cls: 'abele-canvas-web__icon' })
    setIcon(icon, 'globe')
    this.face.createSpan({ cls: 'abele-canvas-web__title', text: name })
    this.openButton(this.face)
    this.page.toggle(true)
  }
}
