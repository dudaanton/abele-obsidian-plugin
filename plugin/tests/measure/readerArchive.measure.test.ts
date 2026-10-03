/** Diagnostic measurements only: no timing thresholds and no automatic engine rewrite. */
import { describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { openZip } from '@/reader/zipLoader'

const operations = vi.hoisted(() => ({ visited: 0 }))
vi.mock('fflate', async (original) => {
  const actual = await original<typeof import('fflate')>()
  return {
    ...actual,
    unzipSync: (data: Uint8Array, options: Parameters<typeof actual.unzipSync>[1]) =>
      actual.unzipSync(data, { ...options, filter: (entry) => {
        operations.visited++
        return options?.filter?.(entry) ?? true
      } }),
  }
})

describe('reader diagnostics', () => {
  it.each([
    { kind: 'short-text', entries: 50, bytes: 1024 },
    { kind: 'long-text', entries: 500, bytes: 4096 },
    { kind: 'picture-heavy', entries: 500, bytes: 32768 },
  ])('measures directory visits and resource load time for $kind', ({ kind, entries, bytes }) => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < entries; i++) {
      const data = new Uint8Array(bytes)
      for (let j = 0; j < bytes; j++) data[j] = (j * 17 + i) % 256
      files[`resources/sample-${i}.dat`] = data
    }
    const archive = zipSync(files)
    operations.visited = 0
    const started = performance.now()
    const loader = openZip(archive)
    const openMs = performance.now() - started
    const loading = performance.now()
    let decoded = 0
    const loads = 100
    for (let i = 0; i < loads; i++) decoded += loader.loadBytes(`resources/sample-${i % entries}.dat`)!.length
    console.log(JSON.stringify({ kind, entries, archiveBytes: archive.length, loads,
      directoryVisits: operations.visited, decodedBytes: decoded,
      openMs: +openMs.toFixed(2), loadMs: +(performance.now() - loading).toFixed(2),
      heapUsed: process.memoryUsage().heapUsed }))
    expect(decoded).toBe(loads * bytes)
    expect(operations.visited).toBe(entries * (loads + 1))
  })

  it('records the constructors retained by the platform after repeated plugin module loads', async () => {
    const names: string[] = []
    for (let i = 0; i < 3; i++) {
      vi.resetModules()
      const elements = await import('@/vendor/foliate-js/elements.js')
      await import('@/vendor/foliate-js/view.js')
      names.push(elements.tagName('foliate-view'))
    }
    console.log(JSON.stringify({ moduleLoads: names.length,
      registeredViewsStillPresent: names.filter((name) => !!customElements.get(name)).length,
      heapUsed: process.memoryUsage().heapUsed }))
    expect(new Set(names).size).toBe(3)
    for (const name of names) expect(customElements.get(name)).toBeDefined()
  })
})
