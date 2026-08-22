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

// Structural placeholders — present so imports resolve; not behaviourally modelled.
export class App {}
export class Vault {}
export class MetadataCache {}
export class Editor {}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class Setting {}
export class Component {}
