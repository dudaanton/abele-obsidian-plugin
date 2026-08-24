/**
 * Minimal stand-in for the `obsidian` module.
 *
 * Vitest aliases `obsidian` to this file, so production code that does
 * `import { TFile } from 'obsidian'` gets these classes — which means `instanceof`
 * checks in the code under test work against fixtures built by `tests/helpers/fakeVault.ts`.
 *
 * Only the surface actually touched by the code under test is implemented. Anything
 * else is deliberately absent so that a test reaching for an unmodelled API fails loudly
 * instead of silently passing against a stub.
 */

export abstract class TAbstractFile {
  path = ''
  name = ''
  parent: TFolder | null = null
}

export class TFile extends TAbstractFile {
  basename = ''
  extension = ''
  stat = { ctime: 0, mtime: 0, size: 0 }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []

  isRoot(): boolean {
    return this.path === '/' || this.path === ''
  }
}

export class Notice {
  constructor(public message: string) {}
  hide(): void {}
}

export type EventRef = { id: string }

/** Mirrors Obsidian's own `normalizePath` closely enough for path handling tests. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '')
}

export function stringifyYaml(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Obsidian's debounce. Tests never exercise the timing behaviour — they call the units that
 * do the work directly — so this passes calls straight through rather than deferring them,
 * which would leave timers dangling after a test finishes.
 */
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn
}

export function parseYaml(raw: string): unknown {
  return JSON.parse(raw)
}

/**
 * Desktop by default. Components that adapt to a narrow screen measure their own element
 * rather than trusting this, so tests drive the layout through a ResizeObserver stub instead
 * of flipping a global flag.
 */
export const Platform = {
  isMobile: false,
  isDesktop: true,
}

/**
 * Obsidian adds these to `HTMLElement` itself rather than shipping them as helpers, and
 * components call them directly. happy-dom has no such thing, so they are installed here —
 * on import of this module, exactly as the real plugin API does it.
 */
if (typeof HTMLElement !== 'undefined' && !('empty' in HTMLElement.prototype)) {
  Object.defineProperties(HTMLElement.prototype, {
    empty: {
      value(this: HTMLElement) {
        while (this.firstChild) this.removeChild(this.firstChild)
      },
    },
    addClass: {
      value(this: HTMLElement, ...classes: string[]) {
        this.classList.add(...classes)
      },
    },
    removeClass: {
      value(this: HTMLElement, ...classes: string[]) {
        this.classList.remove(...classes)
      },
    },
    createDiv: {
      value(this: HTMLElement, cls?: string) {
        const el = this.ownerDocument.createElement('div')
        if (cls) el.classList.add(...cls.split(' '))
        this.appendChild(el)
        return el
      },
    },
    detach: {
      value(this: HTMLElement) {
        this.parentElement?.removeChild(this)
      },
    },
    /** Obsidian's delegated listener: `el.on(event, selector, handler)`. */
    on: {
      value(
        this: HTMLElement,
        event: string,
        selector: string,
        handler: (ev: Event, target: HTMLElement) => void
      ) {
        this.addEventListener(event, (ev: Event) => {
          const target = (ev.target as HTMLElement | null)?.closest(selector)
          if (target instanceof HTMLElement && this.contains(target)) handler(ev, target)
        })
      },
    },
    doc: {
      get(this: HTMLElement) {
        return this.ownerDocument
      },
    },
  })
}

/**
 * Obsidian's element factories, which it installs as globals rather than exporting. Verified
 * against the running app: the bare `createEl`/`createDiv` build in the **main** document and
 * return the element detached unless `parent` is given, while `doc.win.createDiv()` builds in
 * that window's own document — which is why code that must land in a popout reaches through
 * `ownerDocument.win` instead of calling the global.
 */
type ElInfo = { cls?: string; text?: string; attr?: Record<string, string>; parent?: Node }

function buildEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  info?: ElInfo | string
): HTMLElementTagNameMap[K] {
  const o: ElInfo = typeof info === 'string' ? { cls: info } : (info ?? {})
  const el = doc.createElement(tag)
  if (o.cls) el.classList.add(...o.cls.split(' '))
  if (o.text) el.textContent = o.text
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v)
  if (o.parent) o.parent.appendChild(el)
  return el
}

function installElementFactories(win: Window & typeof globalThis): void {
  const doc = win.document
  const g = win as unknown as Record<string, unknown>
  g.createEl = (tag: keyof HTMLElementTagNameMap, info?: ElInfo | string) => buildEl(doc, tag, info)
  g.createDiv = (info?: ElInfo | string) => buildEl(doc, 'div', info)
  g.createSpan = (info?: ElInfo | string) => buildEl(doc, 'span', info)
  g.createFragment = () => doc.createDocumentFragment()
}

/**
 * Obsidian's cross-window type check. A popout window has its own `HTMLElement`, so a plain
 * `instanceof` against the main window's constructor is false there; `instanceOf` compares
 * against the constructor of the node's own window instead.
 */
if (typeof Node !== 'undefined' && !('instanceOf' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'instanceOf', {
    value(this: Node, type: { new (...args: never[]): unknown }) {
      const win = (this.ownerDocument ?? (this as unknown as Document)).defaultView
      const ctor = win ? (win as unknown as Record<string, unknown>)[type.name] : undefined
      return this instanceof type || (typeof ctor === 'function' && this instanceof ctor)
    },
  })
}

if (typeof window !== 'undefined') {
  installElementFactories(window)

  const g = globalThis as unknown as Record<string, unknown>
  g.activeWindow = window
  g.activeDocument = window.document

  if (typeof Document !== 'undefined' && !('win' in Document.prototype)) {
    Object.defineProperty(Document.prototype, 'win', {
      get(this: Document) {
        return this.defaultView
      },
    })
  }
}

/** Draws a Lucide glyph into an element. Recorded as an attribute so tests can assert it. */
export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute('data-icon', icon)
}

/**
 * Obsidian's themed tooltip. The real one shows on hover and puts the text on `aria-label`,
 * which is what tests assert against — so this mirrors that rather than inventing an attribute.
 */
export function setTooltip(el: HTMLElement, tooltip: string): void {
  if (tooltip) el.setAttribute('aria-label', tooltip)
  else el.removeAttribute('aria-label')
}

/**
 * Enough of Obsidian's modal for components that mount one: a title, the two elements they
 * reach for, and open/close. `onClose` is overridden by callers, so `close()` calls it.
 */
export class Modal {
  containerEl: HTMLElement = document.createElement('div')
  modalEl: HTMLElement = document.createElement('div')
  contentEl: HTMLElement = document.createElement('div')
  titleText = ''
  isOpen = false

  constructor(public app?: unknown) {
    this.modalEl.appendChild(this.contentEl)
    this.containerEl.appendChild(this.modalEl)
  }

  setTitle(title: string): this {
    this.titleText = title
    return this
  }

  open(): void {
    this.isOpen = true
    document.body.appendChild(this.containerEl)
  }

  close(): void {
    this.isOpen = false
    this.containerEl.remove()
    this.onClose()
  }

  onClose(): void {}
}

/** A keymap scope. Only registration is modelled; nothing here dispatches a key. */
export class Scope {
  readonly bindings: Array<{ modifiers: string[]; key: string }> = []

  register(modifiers: string[], key: string, _handler: unknown): void {
    this.bindings.push({ modifiers, key })
  }
}

// Structural placeholders — present so imports resolve; not behaviourally modelled.
export class App {}
export class Vault {}
export class MetadataCache {}
export class Editor {}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Component {}
