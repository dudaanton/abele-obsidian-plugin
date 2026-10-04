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

it('validates maximum-byte deep names with linear prefix work and no depth cutoff', () => {
  const names = ['a/'.repeat(32767) + 'z', 'a/'.repeat(32767) + 'w']
  const characterBudget = names.reduce((sum, name) => sum + name.length, 0)
  let joinedSegments = 0
  let characterReads = 0
  const join = Array.prototype.join
  const code = String.prototype.charCodeAt
  const joinSpy = vi.spyOn(Array.prototype, 'join').mockImplementation(function (separator) {
    joinedSegments += this.length
    // Fail early instead of allocating the old billion-character prefix workload.
    if (joinedSegments > characterBudget * 4) throw new Error('Superlinear ZIP prefix work')
    return join.call(this, separator)
  })
  const codeSpy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (position) {
    characterReads++
    return code.call(this, position)
  })
  let result: ReturnType<typeof validateZipEntries>
  try {
    result = validateZipEntries(names.map((name) => entry(name)))
  } finally {
    joinSpy.mockRestore()
    codeSpy.mockRestore()
  }
  expect(result!.map((item) => item.name)).toEqual(names)
  expect(joinedSegments).toBeLessThanOrEqual(characterBudget)
  expect(characterReads).toBeLessThanOrEqual(characterBudget * 6)
  expect(() => validateZipEntries([entry(names[0]), entry('a')])).toThrow(/prefix/)
  expect(() => validateZipEntries([entry('a'), entry(names[0])])).toThrow(/prefix/)
})

it('splits shared trie edges without repeatedly copying the remaining long name', () => {
  const names = ['a'.repeat(500) + 'z', ...Array.from({ length: 20 }, (_, i) => 'a'.repeat(i + 1))]
  const bytes = names.reduce((sum, name) => sum + name.length, 0)
  const slice = String.prototype.slice
  let copiedCharacters = 0
  const copy = vi.spyOn(String.prototype, 'slice').mockImplementation(function (start, end) {
    const result = slice.call(this, start, end)
    copiedCharacters += result.length
    if (copiedCharacters > bytes * 4) throw new Error('Superlinear ZIP edge copying')
    return result
  })
  let result: ReturnType<typeof validateZipEntries>
  try {
    result = validateZipEntries(names.map((name) => entry(name)))
  } finally {
    copy.mockRestore()
  }
  expect(result!).toHaveLength(names.length)
  expect(copiedCharacters).toBeLessThanOrEqual(bytes * 2)
})

it('rejects cumulative metadata/input overflow before evaluating later entries', () => {
  const nameRead = vi.fn(() => {
    throw new Error('A later name must not be evaluated')
  })
  const later = {
    get name(): string {
      return nameRead()
    },
    source: new Uint8Array(),
    size: 0,
  }
  for (const limits of [
    { ...ZIP_LIMITS, outputBytes: 120 },
    { ...ZIP_LIMITS, inputBytes: 1 },
  ]) {
    expect(() =>
      validateZipEntries([entry('long-sample-name.bin', new Uint8Array(2)), later], limits)
    ).toThrow(/ZIP (output metadata|input byte) limit/)
    expect(nameRead).not.toHaveBeenCalled()
  }
})

it('distinguishes ordinary string prefixes from file/directory prefixes in either order', () => {
  for (const names of [
    ['a', 'ab', 'ab/c', 'ab/d'],
    ['ab/c', 'ab/d', 'ab', 'a'],
  ]) {
    // ab is a file-prefix conflict with ab/c; a alone is not a prefix of ab.
    expect(() => validateZipEntries(names.map((name) => entry(name)))).toThrow(/prefix/)
  }
  for (const names of [
    ['a', 'ab/c', 'ab/d', 'abc'],
    ['abc', 'ab/d', 'ab/c', 'a'],
  ])
    expect(validateZipEntries(names.map((name) => entry(name)))).toHaveLength(4)
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

it('services the event loop through the injected host scheduler', async () => {
  let serviced = false
  const timer = setTimeout(() => {
    serviced = true
  }, 0)
  try {
    await buildZip([entry('a', new Uint8Array(140000))], {
      read: async (b) => b,
      checkpoint: () => {},
      yieldTask: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      publish: async () => {
        expect(serviced).toBe(true)
      },
    })
  } finally {
    clearTimeout(timer)
  }
})
