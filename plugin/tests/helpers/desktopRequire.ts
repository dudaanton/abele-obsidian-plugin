import { afterEach, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'

export function desktopFsPort(promises: object): void {
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: (name: string) => {
      if (name !== 'fs' && name !== 'original-fs') throw new Error('Unexpected desktop module')
      return { ...fs, promises }
    },
  })
}

// Real native filesystem tests model Obsidian's renderer module accessor explicitly.
let restore: (() => void) | undefined
beforeEach(() => {
  const win = typeof window === 'undefined' ? {} : window
  // Native tests supply the renderer's module accessor and its bound timer API.
  // Getters observe fake timers installed after this hook, rather than capturing real ones.
  if (typeof Reflect.get(win, 'setTimeout') !== 'function') {
    Object.defineProperties(win, {
      setTimeout: { configurable: true, get: () => globalThis.setTimeout.bind(globalThis) },
      clearTimeout: { configurable: true, get: () => globalThis.clearTimeout.bind(globalThis) },
    })
  }
  const prior = Object.getOwnPropertyDescriptor(win, 'require')
  Object.defineProperty(win, 'require', {
    configurable: true,
    value: (name: string) => {
      if (name !== 'fs' && name !== 'original-fs') throw new Error('Unexpected desktop module')
      return fs
    },
  })
  if (typeof window === 'undefined') vi.stubGlobal('window', win)
  restore = () => {
    if (prior) Object.defineProperty(win, 'require', prior)
    else Reflect.deleteProperty(win, 'require')
    vi.unstubAllGlobals()
  }
})
afterEach(() => restore?.())
