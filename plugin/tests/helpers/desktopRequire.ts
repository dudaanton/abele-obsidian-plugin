import { afterEach, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
const nativeModule = { ...fs }

export function desktopFsPort(promises: object): void {
  // Node caches required modules. Materialize Vitest's namespace once as well;
  // spreading it at every native call repeatedly resolves instrumented exports.
  const module = { ...nativeModule, promises }
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: (name: string) => {
      if (name !== 'fs' && name !== 'original-fs') throw new Error('Unexpected desktop module')
      return module
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
    let timeout: typeof globalThis.setTimeout | undefined
    let clear: typeof globalThis.clearTimeout | undefined
    Object.defineProperties(win, {
      setTimeout: {
        configurable: true,
        get: () => timeout ?? globalThis.setTimeout.bind(globalThis),
        set: (value: typeof globalThis.setTimeout) => {
          timeout = value
        },
      },
      clearTimeout: {
        configurable: true,
        get: () => clear ?? globalThis.clearTimeout.bind(globalThis),
        set: (value: typeof globalThis.clearTimeout) => {
          clear = value
        },
      },
    })
  }
  const prior = Object.getOwnPropertyDescriptor(win, 'require')
  Object.defineProperty(win, 'require', {
    configurable: true,
    value: (name: string) => {
      if (name !== 'fs' && name !== 'original-fs') throw new Error('Unexpected desktop module')
      return nativeModule
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
