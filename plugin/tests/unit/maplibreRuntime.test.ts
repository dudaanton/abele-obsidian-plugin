import { describe, expect, it, vi } from 'vitest'
import { createMaplibreRuntime } from '@/helpers/maplibreRuntime'
import { deferred } from '../helpers/deferred'

const sources = {
  shared: 'export const sample = 7',
  main: 'import {sample} from "abele-maplibre-shared"; export {sample}',
  worker: 'import {sample} from "abele-maplibre-shared"; self.sample=sample',
}

function host() {
  const scripts = new Map<string, string>()
  const module = { setWorkerUrl: vi.fn() }
  const createUrl = vi.fn((source: string) => {
    const url = `blob:sample-${scripts.size}`
    scripts.set(url, source)
    return url
  })
  const revokeUrl = vi.fn((_url: string) => {})
  const importModule = vi.fn(async (_url: string) => module)
  return { scripts, module, createUrl, revokeUrl, importModule }
}

describe('single-copy MapLibre runtime assets', () => {
  it('shares one source blob between main and worker and one load between maps', async () => {
    const h = host()
    const runtime = createMaplibreRuntime(sources, h)
    const [first, second] = await Promise.all([runtime.load(), runtime.load()])
    expect(first).toBe(second)
    expect(h.createUrl).toHaveBeenCalledTimes(3)
    expect(h.importModule).toHaveBeenCalledOnce()
    expect(h.scripts.get('blob:sample-0')).toBe(sources.shared)
    expect(h.scripts.get('blob:sample-1')).toContain('from "blob:sample-0"')
    expect(h.scripts.get('blob:sample-2')).toContain('from "blob:sample-0"')
    expect(h.module.setWorkerUrl).toHaveBeenCalledWith('blob:sample-2')
    runtime.dispose()
    expect(h.revokeUrl).toHaveBeenCalledTimes(3)
    runtime.dispose()
    expect(h.revokeUrl).toHaveBeenCalledTimes(3)
  })

  it('releases failed imports and lets another map retry', async () => {
    const h = host()
    h.importModule.mockRejectedValueOnce(new Error('sample import failure'))
    const runtime = createMaplibreRuntime(sources, h)
    await expect(runtime.load()).rejects.toThrow('sample import failure')
    expect(h.revokeUrl).toHaveBeenCalledTimes(3)
    expect(await runtime.load()).toBe(h.module)
    expect(h.importModule).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('refuses a late import after disposal without clearing a newer generation', async () => {
    const h = host()
    const loading = deferred<typeof h.module>()
    h.importModule.mockImplementationOnce(() => loading.promise)
    const runtime = createMaplibreRuntime(sources, h)
    const first = runtime.load().catch((error) => error)
    runtime.dispose()
    const second = runtime.load()
    loading.resolve(h.module)
    expect(await first).toMatchObject({ message: 'Map runtime was disposed' })
    expect(await second).toBe(h.module)
    expect(await runtime.load()).toBe(h.module)
    expect(h.importModule).toHaveBeenCalledTimes(2)
    expect(h.revokeUrl).toHaveBeenCalledTimes(3)
    runtime.dispose()
  })
})
