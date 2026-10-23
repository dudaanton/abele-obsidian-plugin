import { afterEach, expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { UploadQuietPeriod } from '@/sync/uploadQuietPeriod'

afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const fs = new MemoryFileSystem()
  const sent: string[] = []
  const gate = new UploadQuietPeriod(
    fs,
    (paths) => sent.push(...paths),
    () => {}
  )
  return { fs, gate, sent }
}
it('forwards first-upload and incoming-write notifications without filesystem work', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
  const stat = vi.spyOn(fs, 'stat')
  await gate.notice(['note.md'])
  expect(sent).toEqual(['note.md'])
  expect(stat).not.toHaveBeenCalled()
  expect(gate.pending).toBe(0)
  gate.stop()
})

it('releases waiting children when their deleted folder arrives without child notifications', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('Folder/note.md', new Uint8Array(100), Date.now())
  gate.synced('Folder/note.md')
  await gate.notice(['Folder/note.md'])
  await fs.remove('Folder/note.md')
  await gate.notice(['Folder'])
  expect(sent).toEqual(['Folder/note.md', 'Folder'])
  expect(gate.pending).toBe(0)
  gate.stop()
})
it('limits a note edited every second for a minute to six uploads, without delaying another file', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
  gate.synced('note.md')
  let uploads = 0
  for (let second = 1; second <= 60; second++) {
    await vi.advanceTimersByTimeAsync(1000)
    await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
    await gate.notice(['note.md'])
    if (sent.includes('note.md')) {
      uploads++
      sent.length = 0
      gate.synced('note.md')
    }
    if (second === 1) {
      expect(gate.pending).toBe(1)
      await fs.writeAtomic('other.md', new Uint8Array(1), Date.now())
      await gate.notice(['other.md'])
      expect(sent.splice(0)).toEqual(['other.md'])
    }
  }
  expect(uploads).toBeGreaterThanOrEqual(3)
  expect(uploads).toBeLessThanOrEqual(6)
  gate.stop()
})
it.each([
  [10 * 1024, 10_000],
  [100 * 1024, 20_000],
  [100 * 1024 + 1, 30_000],
])('holds %i bytes for %i ms since the last sync', async (size, delay) => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(size), Date.now())
  gate.synced('note.md')
  await gate.notice(['note.md'])
  expect(gate.refusal('note.md')?.code).toBe('rate_limited')
  await vi.advanceTimersByTimeAsync(delay - 1)
  expect(sent).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(sent).toEqual(['note.md'])
  expect(gate.refusal('note.md')).toBeUndefined()
  gate.stop()
})
it.each(['quit', 'background', 'sync now', 'unload'])(
  '%s flushes pending edits immediately',
  async () => {
    const { fs, gate, sent } = setup()
    await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
    gate.synced('note.md')
    await gate.notice(['note.md'])
    await gate.flush(async () => {
      expect(sent).toEqual(['note.md'])
      expect(gate.refusal('note.md')).toBeUndefined()
      gate.synced('note.md')
    })
    expect(gate.pending).toBe(0)
    gate.stop()
  }
)
it('does not delay a deletion or either side of a rename', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
  gate.synced('note.md')
  await gate.notice(['note.md'])
  await fs.move('note.md', 'renamed.md')
  await gate.notice(['note.md', 'renamed.md'])
  expect(sent.splice(0)).toEqual(['note.md', 'renamed.md'])
  gate.synced('renamed.md')
  await gate.notice(['renamed.md'])
  await fs.remove('renamed.md')
  await gate.notice(['renamed.md'])
  expect(sent).toEqual(['renamed.md'])
  expect(gate.pending).toBe(0)
  gate.stop()
})
it('a pause prevents timer and flush uploads; resuming releases the latest work', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
  gate.synced('note.md')
  await gate.notice(['note.md'])
  gate.pause(true)
  await vi.advanceTimersByTimeAsync(60_000)
  const work = vi.fn()
  await gate.flush(work)
  expect(work).not.toHaveBeenCalled()
  expect(sent).toEqual([])
  expect(gate.pending).toBe(1)
  gate.pause(false)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent).toEqual(['note.md'])
  gate.stop()
})
it('a restarted runtime has no quiet hold on durable unsent disk content', async () => {
  const { fs, gate, sent } = setup()
  await fs.writeAtomic('note.md', new Uint8Array(100), Date.now())
  gate.synced('note.md')
  await gate.notice(['note.md'])
  gate.stop()
  const restarted = new UploadQuietPeriod(
    fs,
    (paths) => sent.push(...paths),
    () => {}
  )
  await restarted.notice(['note.md'])
  expect(sent).toEqual(['note.md'])
  expect(await fs.read('note.md')).toHaveLength(100)
  restarted.stop()
})
