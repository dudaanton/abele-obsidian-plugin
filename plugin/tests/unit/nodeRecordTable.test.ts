import { expect, it } from 'vitest'
import { RecordTable } from '@/node/recordTable'
import { frozen, plain, storeDraft } from '@/node/storeDraft'

it('preserves published snapshots, insertion order and safe opaque record keys', () => {
  const before = new RecordTable()
    .set('sample-b', frozen({ text: 'before' }))
    .set('__proto__', frozen({ text: 'opaque' }))
    .set('sample-a', frozen({ text: 'last' }))
  const draft = storeDraft(before.view)
  ;(draft.value['sample-b'] as { text: string }).text = 'after'
  draft.value['sample-c'] = { text: 'new' }
  delete draft.value['sample-a']
  const first = draft.snapshot()
  expect(() => Object.setPrototypeOf(first, null)).toThrow(TypeError)
  ;(draft.value['sample-b'] as { text: string }).text = 'again'
  const second = draft.snapshot()
  expect((first['sample-b'] as { text: string }).text).toBe('after')
  expect((second['sample-b'] as { text: string }).text).toBe('again')
  expect((before.view['sample-b'] as { text: string }).text).toBe('before')
  expect(Object.keys(before.view)).toEqual(['sample-b', '__proto__', 'sample-a'])
  expect(Object.keys(second)).toEqual(['sample-b', '__proto__', 'sample-c'])
  expect(structuredClone(plain(second))).toEqual({
    'sample-b': { text: 'again' },
    ['__proto__']: { text: 'opaque' },
    'sample-c': { text: 'new' },
  })
  expect(Object.isFrozen(second)).toBe(true)
  expect(() => Object.freeze(second)).not.toThrow()
  expect(() => {
    second['sample-c'] = 'changed'
  }).toThrow(TypeError)
  expect(() => {
    ;(second['sample-b'] as { text: string }).text = 'changed'
  }).toThrow(TypeError)
})

it('moves a deleted and reinserted record to the end without changing an earlier snapshot', () => {
  const table = new RecordTable().set('sample-a', 'first').set('sample-b', 'second')
  const next = table.delete('sample-a').set('sample-a', 'reinserted')
  expect(Object.keys(next.view)).toEqual(['sample-b', 'sample-a'])
  expect(Object.keys(table.view)).toEqual(['sample-a', 'sample-b'])
})
