import { afterEach, expect, it, vi } from 'vitest'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'

afterEach(() => vi.restoreAllMocks())

it('reaches the first request after restart without inspecting ordinary payloads', async () => {
  const s = await tokenBuildFixture()
  try {
    for (let n = 0; n < 2000; n++)
      await s.app.vault.adapter.write(`Media/sample-${n}.md`, 'ordinary content')
    s.store.close()
    const read = vi.spyOn(s.app.vault.adapter, 'readBinary')
    const built = await s.build()
    const beforeRequest: number[] = []
    s.fetcher.mockImplementation(async () => {
      beforeRequest.push(read.mock.calls.filter(([path]) => path.startsWith('Media/')).length)
      throw new Error('sample network interruption')
    })
    await built.engine.sync().catch(() => {})
    expect(beforeRequest.length).toBeGreaterThan(0)
    expect(beforeRequest[0]).toBe(0)
  } finally {
    await s.close()
  }
})

it('holds an unowned copied projection lazily before an upload can read it', async () => {
  const s = await tokenBuildFixture()
  try {
    await s.app.vault.adapter.write('Media/copied.md', '{"format":"abele.external"}')
    s.store.close()
    const read = vi.spyOn(s.app.vault.adapter, 'readBinary')
    const built = await s.build()
    expect(read.mock.calls.some(([path]) => path === 'Media/copied.md')).toBe(false)
    await expect(built.fs.openRead!('Media/copied.md')).rejects.toThrow(/held representation/)
    expect(await s.app.vault.adapter.read('Media/copied.md')).toBe('{"format":"abele.external"}')
  } finally {
    await s.close()
  }
})
