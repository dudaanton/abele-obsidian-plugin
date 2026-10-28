import { describe, expect, it, vi } from 'vitest'
import * as protocol from '@abele/sync-sdk/protocol'
import { assertPhysicalPath } from '@/sync/external/projection'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

vi.mock('@abele/sync-sdk/protocol', async (original) => {
  const actual = await original<typeof import('@abele/sync-sdk/protocol')>()
  return { ...actual, validatePath: vi.fn(actual.validatePath) }
})

const outcome = (path: string) => {
  try {
    assertPhysicalPath(path)
    return 'ok'
  } catch (error) {
    return `${(error as Error).constructor.name}: ${(error as Error).message}`
  }
}

describe('physical path checks are remembered', () => {
  it('retains a full large inventory across later passes', () => {
    const validate = vi.mocked(protocol.validatePath)
    const paths = Array.from(
      { length: 33000 },
      (_, i) => `Shared/Section ${i % 40}/Nested/sample-${i}.md`
    )
    validate.mockClear()
    for (const path of paths) assertPhysicalPath(path)
    const firstPass = validate.mock.calls.length
    for (const path of paths) assertPhysicalPath(path)
    expect(validate.mock.calls.length).toBe(firstPass)
  })

  it('validates a passing path once and keeps answering the same', () => {
    const validate = vi.mocked(protocol.validatePath)
    validate.mockClear()
    for (let i = 0; i < 5; i++) expect(outcome('Shared/memo-once.md')).toBe('ok')
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it.each([
    'Shared/../secret.md',
    '/absolute.md',
    'Shared/.hidden.md',
    'Shared/' + 'a'.repeat(256) + '.md',
    'Shared/' + 'é'.repeat(130) + '.md',
    ('Shared/' + 'é'.repeat(100) + '/').repeat(6) + 'x.md',
    '',
  ])('fails the same way on every call: %s', (path) => {
    const first = outcome(path)
    expect(first).not.toBe('ok')
    for (let i = 0; i < 3; i++) expect(outcome(path)).toBe(first)
  })

  it('counts UTF-8 bytes, not characters, for non-ASCII segments', () => {
    expect(outcome('Shared/' + 'é'.repeat(126) + '.md')).toBe('ok')
    expect(outcome('Shared/' + 'é'.repeat(127) + '.md')).toMatch(/too long/)
    // A decomposed spelling passes as its composed form does, and stays passing.
    expect(outcome('Shared/caf\u0065\u0301.md')).toBe('ok')
    expect(outcome('Shared/caf\u0065\u0301.md')).toBe('ok')
    expect(outcome('Shared/' + 'a'.repeat(255))).toBe('ok')
    expect(outcome('Shared/' + 'a'.repeat(256))).toMatch(/too long/)
  })

  it('follows a placement change after paths were remembered', () => {
    const placement = new LocalFolderPlacement('Shared', 'Moved')
    expect(placement.toServer('Moved/note.md')).toBe('Shared/note.md')
    expect(placement.toLocal('Shared/note.md')).toBe('Moved/note.md')
    placement.local = 'Elsewhere'
    expect(placement.toLocal('Shared/note.md')).toBe('Elsewhere/note.md')
    expect(() => placement.toServer('Moved/note.md')).toThrow(/outside this connection/)
    placement.server = 'Other'
    expect(() => placement.toLocal('Shared/note.md')).toThrow(/outside this connection/)
  })
})

it('preserves protocol and physical byte limits after warming sibling directory checks', () => {
  const parent = 'Notes/Cafe\u0301/' + 'Nested/'.repeat(10)
  assertPhysicalPath(parent + 'sample.md')
  const candidates = [
    'next.md',
    '.hidden',
    '.obsidian',
    '.trash',
    '..',
    '.',
    '',
    ' a.md',
    'a\\b',
    'a\u0000b',
    'a'.repeat(255),
    'a'.repeat(256),
    'e\u0301'.repeat(85),
    'e\u0301'.repeat(86),
    'Sub/next.md',
    '/bad.md',
    '../bad.md',
  ]
  for (const leaf of candidates) {
    const path = parent + leaf
    let valid = true
    try {
      protocol.validatePath(path.normalize('NFC'))
    } catch {
      valid = false
    }
    const encoder = new TextEncoder()
    valid &&=
      encoder.encode(path).length <= 1024 &&
      path.split('/').every((part) => encoder.encode(part).length <= 255)
    if (valid) expect(() => assertPhysicalPath(path)).not.toThrow()
    else expect(() => assertPhysicalPath(path)).toThrow()
  }
  const longParent = ('x'.repeat(200) + '/').repeat(4)
  assertPhysicalPath(longParent + 'short.md')
  expect(() => assertPhysicalPath(longParent + 'x'.repeat(221))).toThrow()
  assertPhysicalPath('.obsidian/sample.json')
  expect(() => assertPhysicalPath('.obsidian/.trash')).toThrow()
})
