import { expect, it, vi } from 'vitest'
import {
  createReferenceResults,
  findNodeReferences,
  referenceLocationKey,
} from '@/node/referenceResults'
import type { NodeLspDocument, LspLocation } from '@/node/NodeLspDocument'

const hit = (path: string, line = 0): LspLocation => ({
  path,
  range: { start: { line, character: 2 }, end: { line, character: 8 } },
})
it('retains same-file usages first and adds a declaration omitted by the references response', async () => {
  const declaration = hit('origin.ts')
  const f = fixture([hit('other.ts'), hit('origin.ts', 1)], [declaration])
  const state = createReferenceResults()
  await findNodeReferences(
    state,
    f.document,
    { line: 1, character: 2 },
    '  sample()\n  sample()',
    async () => '  sample()',
    () => ''
  )
  expect(state.files.map((file) => file.path)).toEqual(['origin.ts', 'other.ts'])
  expect(state.files[0].lines.map((line) => line.label)).toEqual(['1', '2'])
  expect(state.definitions).toEqual([referenceLocationKey(declaration)])
  expect(state.count).toBe(3)
  expect(state.active).toBe('')
})
it('loads the capped locations when Show more is activated', async () => {
  const f = fixture(Array.from({ length: 110 }, (_, i) => hit(`sample-${i}.ts`)))
  const state = createReferenceResults()
  await findNodeReferences(
    state,
    f.document,
    { line: 0, character: 2 },
    '',
    async () => '  sample()',
    () => ''
  )
  expect(state.more).toBeTypeOf('function')
  await state.more!()
  expect(state.files).toHaveLength(110)
  expect(state.omitted).toBe(0)
  expect(state.more).toBeUndefined()
})
function fixture(hits: LspLocation[], definitions: LspLocation[] = []) {
  const query = vi.fn(async (kind: string) => (kind === 'definition' ? definitions : hits))
  return { query, document: { path: 'origin.ts', query } as unknown as NodeLspDocument }
}
it('puts definition files first, deduplicates, trims snippets and caps preview reads', async () => {
  const hits = [
    ...Array.from({ length: 110 }, (_, i) => hit(`sample-${String(i).padStart(3, '0')}.ts`)),
    hit('sample-000.ts'),
  ]
  const f = fixture(hits, [hits[109]])
  const state = createReferenceResults()
  const read = vi.fn(async () => '  sample()  ')
  await findNodeReferences(state, f.document, { line: 0, character: 0 }, '', read, () => '')
  expect(state.files[0].path).toBe('sample-109.ts')
  expect(state.files[1].path).toBe('sample-000.ts')
  expect(state.count).toBe(110)
  expect(state.omitted).toBe(10)
  expect(read).toHaveBeenCalledTimes(100)
  expect(state.definitions).toEqual([referenceLocationKey(hits[109])])
  expect(state.files[0].lines[0]).toMatchObject({ text: 'sample()', column: 0, length: 6 })
})
it('never lets a superseded query overwrite newer results', async () => {
  const f = fixture([hit('new.ts')])
  let finish!: (hits: LspLocation[]) => void
  f.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const state = createReferenceResults()
  const first = findNodeReferences(
    state,
    f.document,
    { line: 0, character: 0 },
    '',
    async () => '',
    () => ''
  )
  await findNodeReferences(
    state,
    f.document,
    { line: 1, character: 0 },
    '',
    async () => '',
    () => ''
  )
  finish([hit('old.ts')])
  await first
  expect(state.files.map((file) => file.path)).toEqual(['new.ts'])
  expect(state.loading).toBe(false)
})
it('shows trust refusal without definition or preview requests', async () => {
  const f = fixture([])
  const state = createReferenceResults()
  const read = vi.fn()
  await findNodeReferences(
    state,
    f.document,
    { line: 0, character: 0 },
    '',
    read,
    () => 'Trust this folder'
  )
  expect(f.query).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  expect(state.message).toBe('Trust this folder')
  expect(state.loading).toBe(false)
})
