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
    doc: {
      get(this: HTMLElement) {
        return this.ownerDocument
      },
    },
  })
}

/** Draws a Lucide glyph into an element. Recorded as an attribute so tests can assert it. */
export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute('data-icon', icon)
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
