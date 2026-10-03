import { describe, expect, it, vi } from 'vitest'
import { RepoIndex } from '@/github/search/repoIndex'

vi.mock('@/github/search/tar', () => ({
  stripRoot: (path: string) => path.slice(path.indexOf('/') + 1),
  readTar: function* () {
    for (let i = 0; i < 600; i++) yield { path: `root/sample-${i}.ts`, data: new TextEncoder().encode(`export const sample = ${i}`) }
  },
}))

describe('cooperative repository indexing', () => {
  it('keeps synchronous results and yields after bounded batches', async () => {
    const yieldWork = vi.fn(async () => {})
    const tar = new Uint8Array()
    const sync = RepoIndex.fromTar(tar)
    const cooperative = await RepoIndex.fromTarAsync(tar, { yieldWork })
    expect(cooperative.files).toEqual(sync.files)
    expect(cooperative.paths).toEqual(sync.paths)
    expect(cooperative.bytes).toBe(sync.bytes)
    expect(yieldWork).toHaveBeenCalledTimes(2)
  })
})
