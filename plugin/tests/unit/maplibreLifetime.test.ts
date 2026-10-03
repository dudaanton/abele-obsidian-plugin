import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/deferred'

const state = vi.hoisted(() => ({
  config: { plugin: null as null | { register: ReturnType<typeof vi.fn> } },
  runtime: { load: vi.fn(), dispose: vi.fn() },
}))
vi.mock('@/services/AbeleConfig', () => ({ AbeleConfig: { getInstance: () => state.config } }))
vi.mock('@/helpers/maplibreRuntime', () => ({ createMaplibreRuntime: () => state.runtime }))
import { loadMaplibre } from '@/helpers/loadMaplibre'

beforeEach(() => {
  state.config.plugin = { register: vi.fn() }
  state.runtime.load.mockReset().mockResolvedValue({ Map: 'sample' })
  state.runtime.dispose.mockReset()
})

describe('map import belongs to plugin lifetime', () => {
  it('registers one disposer even when several maps share the import', async () => {
    await Promise.all([loadMaplibre(), loadMaplibre()])
    const register = state.config.plugin!.register
    expect(register).toHaveBeenCalledOnce()
    register.mock.calls[0][0]()
    expect(state.runtime.dispose).toHaveBeenCalledOnce()
  })

  it('does not return a library imported after plugin unload', async () => {
    const importing = deferred<unknown>()
    state.runtime.load.mockReturnValueOnce(importing.promise)
    const pending = loadMaplibre()
    state.config.plugin!.register.mock.calls[0][0]()
    state.config.plugin = null
    importing.resolve({ Map: 'sample' })
    await expect(pending).rejects.toThrow('Map runtime was disposed')
  })
})
