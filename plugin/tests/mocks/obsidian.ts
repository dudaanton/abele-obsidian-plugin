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
    setText: {
      value(this: HTMLElement, text: string) {
        this.textContent = text
      },
    },
    /** Obsidian's `el.trigger(type)` — dispatches a bubbling event of that name. */
    trigger: {
      value(this: HTMLElement, type: string) {
        this.dispatchEvent(new Event(type, { bubbles: true }))
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
 * Obsidian augments `String` with `contains`, and plugin code uses it in place of `includes`.
 */
if (typeof String !== 'undefined' && !('contains' in String.prototype)) {
  Object.defineProperty(String.prototype, 'contains', {
    value(this: string, needle: string) {
      return this.includes(needle)
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

  /**
   * Every document Obsidian owns belongs to a window that carries the element factories, and
   * `doc.win.createDiv()` is how code builds an element in *that* window rather than the main
   * one. A document a test conjures up to stand in for a second window has no `defaultView`,
   * so one is synthesised here with the factories bound to it — otherwise the double would
   * report `null` for something the real app always provides.
   */
  // happy-dom's documents inherit from `HTMLDocument.prototype`, and `Document.prototype` is
  // not on their chain — so the property goes on the prototype the live document actually has.
  const documentPrototype = Object.getPrototypeOf(window.document) as object

  if (!('win' in documentPrototype)) {
    const synthesised = new WeakMap<Document, Record<string, unknown>>()

    const windowFor = (doc: Document): Record<string, unknown> => {
      let win = synthesised.get(doc)
      if (!win) {
        win = {
          document: doc,
          createEl: (tag: keyof HTMLElementTagNameMap, info?: ElInfo | string) =>
            buildEl(doc, tag, info),
          createDiv: (info?: ElInfo | string) => buildEl(doc, 'div', info),
          createSpan: (info?: ElInfo | string) => buildEl(doc, 'span', info),
        }
        synthesised.set(doc, win)
      }
      return win
    }

    Object.defineProperty(documentPrototype, 'win', {
      get(this: Document) {
        return this.defaultView ?? windowFor(this)
      },
    })
  }
}

/**
 * Obsidian's type-ahead base for a text field. The real one owns the popup, its placement and
 * the keyboard; none of that is modelled here because none of it is the plugin's code any more.
 * What the plugin still owns — which values match, how one is drawn, what selecting does — is
 * driven directly by the tests.
 */
export abstract class AbstractInputSuggest<T> {
  limit = 100

  constructor(
    public app: unknown,
    protected textInputEl: HTMLInputElement
  ) {}

  setValue(value: string): void {
    this.textInputEl.value = value
  }

  getValue(): string {
    return this.textInputEl.value
  }

  close(): void {
    this.closed = true
  }

  /** Not part of Obsidian's API — lets a test assert that selecting dismissed the list. */
  closed = false

  abstract renderSuggestion(value: T, el: HTMLElement): void
  abstract selectSuggestion(value: T, evt?: MouseEvent | KeyboardEvent): void
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
/**
 * A component is a lifecycle handle: things that render into the DOM take one so their
 * children can be unloaded with them. Nothing here has children to unload, so the methods
 * only have to exist — but they do have to exist, or mounting anything that renders markdown
 * dies in `onMounted`.
 */
export class Component {
  load(): void {}
  unload(): void {}
  onload(): void {}
  onunload(): void {}
  addChild<T>(child: T): T {
    return child
  }
  removeChild<T>(child: T): T {
    return child
  }
  register(): void {}
  registerEvent(): void {}
}

/**
 * Markdown is rendered by Obsidian itself, so there is nothing here to reproduce — the text
 * is written in as text. That is enough for tests that ask what a component put on screen
 * and around it; how the markdown itself comes out is Obsidian's business.
 */
export const MarkdownRenderer = {
  render: async (
    _app: unknown,
    markdown: string,
    el: HTMLElement,
    _sourcePath: string,
    _component: unknown
  ): Promise<void> => {
    el.setText(markdown)
  },
}
