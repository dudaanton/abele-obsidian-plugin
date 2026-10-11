// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import { BINDING_DIR, BINDING_SETUP, BINDING_CLEANUP } from '../e2e/helpers/chatBindings'

function fixture(failAt: 'folder' | 'open' | undefined) {
  const files = new Map<string, { path: string; source?: string }>()
  const local = new Map<string, unknown>()
  const settings = new Map<string, unknown>([['nativeMenus', true]])
  const ai = { scriptsEnabled: false, scriptsFolder: 'Sample original scripts' }
  const config = { ai, version: { value: 0 }, saveSettings: vi.fn(async () => {}) }
  const load = vi.fn(async () => {})
  const app = {
    loadLocalStorage: (key: string) => local.get(key),
    saveLocalStorage: (key: string, value: unknown) => local.set(key, value),
    vault: {
      getConfig: (key: string) => settings.get(key),
      setConfig: (key: string, value: unknown) => settings.set(key, value),
      saveConfig: async () => {},
      getAbstractFileByPath: (path: string) => files.get(path),
      createFolder: async (path: string) => {
        if (path.endsWith('/Cards') && failAt === 'folder') throw Error('Sample folder failure')
        files.set(path, { path })
      },
      create: async (path: string, source: string) => files.set(path, { path, source }),
      delete: async (file: { path: string }) => {
        for (const path of files.keys())
          if (path === file.path || path.startsWith(file.path + '/')) files.delete(path)
      },
      adapter: { exists: async () => false },
    },
  }
  const scripts = {
    discover: async () => {},
    get: (path: string) => files.get(path),
    confirm: vi.fn(),
  }
  const chats = {
    getSessionByFile: () => undefined,
    openChatFile: async () => {
      if (failAt === 'open') throw Error('Sample chat failure')
    },
    revealSidebar: async () => {},
  }
  const context: any = {
    app,
    console: { info: () => {} },
    KeyboardEvent: class {},
    document: { getSelection: () => null, body: { dispatchEvent: () => {} } },
    crypto: webcrypto,
    window: {
      __abeleTest: {
        AbeleConfig: { getInstance: () => config },
        ChatService: { getInstance: () => chats },
        ScriptService: { getInstance: () => scripts },
        ScriptTrust: { getInstance: () => ({ arm: () => {} }), reset: () => {} },
        scriptTrust: { load },
      },
    },
  }
  return {
    files,
    config,
    ai,
    settings,
    context,
    load,
    run: (code: string) => runInNewContext(`(async()=>{${code}})()`, context),
  }
}

describe('owned binding fixture', () => {
  it('allocates a distinct directory for a new test module run', async () => {
    vi.resetModules()
    const next = await import('../e2e/helpers/chatBindings')
    expect(next.BINDING_DIR).not.toBe(BINDING_DIR)
    expect(next.BINDING_DIR).toMatch(/^Sample binding probe-[\da-f-]+$/u)
  })

  it.each(['folder', 'open'] as const)(
    'restores partial setup after %s failure before returning a snapshot',
    async (failAt) => {
      const f = fixture(failAt)
      await expect(f.run(BINDING_SETUP)).rejects.toThrow(/Sample .* failure/u)
      expect([...f.files.keys()]).toEqual([])
      expect(f.config.ai).toEqual(f.ai)
      expect(f.settings.get('nativeMenus')).toBe(true)
      expect(f.context.window.__bindingOld).toBeUndefined()
    }
  )

  it('never removes an existing directory it did not create', async () => {
    const f = fixture(undefined)
    f.files.set(BINDING_DIR, { path: BINDING_DIR })
    await expect(f.run(BINDING_SETUP)).rejects.toThrow('Binding fixture already exists')
    expect(f.files.has(BINDING_DIR)).toBe(true)
    expect(f.settings.get('nativeMenus')).toBe(true)
  })

  it('enrolls exact script provenance and restores its owned fixture', async () => {
    const f = fixture(undefined)
    await f.run(BINDING_SETUP)
    expect(f.load).toHaveBeenCalledTimes(2)
    await f.run(BINDING_CLEANUP)
    expect([...f.files.keys()]).toEqual([])
    expect(f.config.ai).toEqual(f.ai)
    expect(f.settings.get('nativeMenus')).toBe(true)
  })
})
