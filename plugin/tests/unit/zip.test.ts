import { describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { buildZip, ZIP_LIMITS, validateZipEntries } from '@/archive/zip'

const entry = (name: string, bytes = new Uint8Array()) => ({
  name,
  source: bytes,
  size: bytes.length,
})
const run = (entries = [entry('sample.bin')], overrides = {}) => {
  const sink = vi.fn(async (bytes: Uint8Array) => bytes)
  const read = vi.fn(async (bytes: Uint8Array) => bytes)
  const checkpoint = vi.fn()
  const yieldTask = vi.fn(async () => {})
  return {
    sink,
    read,
    checkpoint,
    yieldTask,
    promise: buildZip(entries, { read, checkpoint, yieldTask, publish: sink, ...overrides }),
  }
}

it('preserves bytes, Unicode paths, repeated sources and case-distinct entries', async () => {
  const bytes = new Uint8Array([239, 187, 191, 65, 13, 10, 255, 0])
  const result = run([
    entry('Notes/sample.md', bytes),
    entry('nested\\cafe\u0301.bin', bytes),
    entry('A'),
    entry('a'),
  ])
  const zip = unzipSync(await result.promise)
  expect(Object.keys(zip)).toEqual(['Notes/sample.md', 'nested/café.bin', 'A', 'a'])
  expect(zip['Notes/sample.md']).toEqual(bytes)
  expect(zip['nested/café.bin']).toEqual(bytes)
  expect(zip.A).toEqual(new Uint8Array())
  expect(result.read).toHaveBeenCalledTimes(4)
  expect(result.sink).toHaveBeenCalledOnce()
})

describe('whole-layout preflight', () => {
  it.each([
    '../x',
    'a/../x',
    './x',
    '/x',
    'C:/x',
    '\\\\host\\x',
    'x/',
    'x//y',
    '',
    'a\0b',
    '\ud800',
  ])('rejects unsafe entry %j before reading', async (name) => {
    const result = run([entry('good'), entry(name)])
    await expect(result.promise).rejects.toThrow()
    expect(result.read).not.toHaveBeenCalled()
    expect(result.sink).not.toHaveBeenCalled()
  })
  it.each([
    ['a', 'a'],
    ['a', 'a/b'],
    ['a/b', 'a'],
    ['café', 'cafe\u0301'],
    ['a/b', 'a\\b'],
  ])('rejects canonical duplicates/prefixes %j %j', async (a, b) => {
    const result = run([entry(a), entry(b)])
    await expect(result.promise).rejects.toThrow()
    expect(result.read).not.toHaveBeenCalled()
  })
  it('limits UTF-8 filename bytes, not characters', () => {
    expect(() => validateZipEntries([entry('é'.repeat(32768))])).toThrow(/filename/i)
  })
  it('has named ceilings and accounts for metadata before reads', async () => {
    expect(ZIP_LIMITS).toEqual({
      entries: 5000,
      inputBytes: 512 * 1024 * 1024,
      outputBytes: 64 * 1024 * 1024,
    })
    for (const limits of [{ entries: 1 }, { inputBytes: 1 }, { outputBytes: 210 }]) {
      const result = run([entry('abc', new Uint8Array(2)), entry('def')], {
        limits: { ...ZIP_LIMITS, ...limits },
      })
      await expect(result.promise).rejects.toThrow(/limit/i)
      expect(result.read).not.toHaveBeenCalled()
      expect(result.sink).not.toHaveBeenCalled()
    }
  })
})

it('checks returned bytes, complete output and cancellation without publishing', async () => {
  const largerRead = run([entry('a')], {
    read: async () => new Uint8Array(5),
    limits: { ...ZIP_LIMITS, inputBytes: 4 },
  })
  await expect(largerRead.promise).rejects.toThrow(/input/i)
  expect(largerRead.sink).not.toHaveBeenCalled()
  const noise = Uint8Array.from({ length: 1024 }, (_, i) => (i * 101 + (i >> 3)) % 256)
  const largeOutput = run([entry('a', noise)], { limits: { ...ZIP_LIMITS, outputBytes: 150 } })
  await expect(largeOutput.promise).rejects.toThrow(/output/i)
  expect(largeOutput.sink).not.toHaveBeenCalled()
  const stopped = run([entry('a', new Uint8Array(140000))], {
    yieldTask: async () => {
      throw new Error('Stopped')
    },
  })
  await expect(stopped.promise).rejects.toThrow('Stopped')
  expect(stopped.sink).not.toHaveBeenCalled()
})

it('yields between bounded pushes and reads sequentially', async () => {
  let reads = 0
  let yields = 0
  const result = run([entry('a', new Uint8Array(140000)), entry('b')], {
    read: async (bytes: Uint8Array) => {
      reads++
      if (reads === 2) expect(yields).toBeGreaterThanOrEqual(3)
      return bytes
    },
    yieldTask: async () => {
      yields++
    },
  })
  await result.promise
  expect(yields).toBeGreaterThanOrEqual(4)
})

it('provides a real event-loop opportunity by default', async () => {
  let serviced = false
  const timer = setTimeout(() => {
    serviced = true
  }, 0)
  try {
    await buildZip([entry('a', new Uint8Array(140000))], {
      read: async (b) => b,
      checkpoint: () => {},
      publish: async () => {
        expect(serviced).toBe(true)
      },
    })
  } finally {
    clearTimeout(timer)
  }
})
