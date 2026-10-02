import { expect, it } from 'vitest'
import { createDeckTools } from '@/ai/tools/DeckTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ReadGuard, contentHash, foldMarks, refusal } from '@/ai/readGuard'
import { ResultStore, STORE_OVER } from '@/ai/resultStore'
import { estimateTokens } from '@/ai/tokens'
import type { ReadMark } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const PATH = 'Decks/sample-large.md'
const LARGE =
  '---\ntype: presentation\n---\n# Sample\n> [!notes]\n> ' +
  'Sample detail. '.repeat(1000) +
  '\n```slide-html\n<img src="data:image/png;base64,' +
  'A'.repeat(60000) +
  '">\n```\n'
const context = () => {
  const scope = new ScopeResolver()
  scope.addFile(PATH)
  return { scope, interactive: true }
}

it('bounds a structured deck read even with large notes and a single-line inline image', async () => {
  useVault([{ path: PATH, content: LARGE }])
  const result = await createDeckTools()
    .find((t) => t.name === 'deck_read')!
    .execute('large', { path: PATH }, undefined, context())
  const store = new ResultStore({ messages: () => [] })
  store.keep('deck_read', 'large', result)
  expect(result.content[0].text!.length).toBeLessThanOrEqual(STORE_OVER)
  expect(estimateTokens(result.content[0].text!)).toBeLessThanOrEqual(STORE_OVER)
  expect(result.seen?.chars).toBeDefined()
  expect(result.seen?.totalChars).toBe(LARGE.length)
  const data = JSON.parse(result.content[0].text!)
  expect(data.structure).toBe('summary')
  expect(data.nextOffset).toBeGreaterThan(0)
  expect(data.nextOffset).toBeLessThan(LARGE.length)
})

it('only grants whole-file write access after every bounded source page has been read', async () => {
  useVault([{ path: PATH, content: LARGE }])
  const ctx = context()
  const guard = new ReadGuard({ history: () => [], scope: () => ctx.scope })
  const tool = createDeckTools().find((t) => t.name === 'deck_read')!
  let offset = 0
  let reconstructed = ''
  for (let page = 0; page < 100; page++) {
    const result = await tool.execute(
      'page',
      { path: PATH, offset, limit: 1000000 },
      undefined,
      ctx
    )
    expect(result.content[0].text!.length).toBeLessThanOrEqual(STORE_OVER)
    const data = JSON.parse(result.content[0].text!)
    expect(data.offset).toBe(offset)
    reconstructed += data.source
    await guard.record('deck_read', { path: PATH }, result)
    if (data.nextOffset === null) break
    expect(await guard.check('deck_edit', { path: PATH })).toContain('File must be read first')
    offset = data.nextOffset
    if (page === 99) throw Error('paging did not finish')
  }
  expect(reconstructed).toBe(LARGE)
  expect(guard.view(PATH)?.chars).toBeUndefined()
  expect(await guard.check('deck_edit', { path: PATH })).toBeNull()
})

it('bounds JSON-escaped source pages too, and does not repeat the full structure in every page', async () => {
  const source = '# Sample\n' + '"\\\t'.repeat(20000)
  useVault([{ path: PATH, content: source }])
  const result = await createDeckTools()
    .find((t) => t.name === 'deck_read')!
    .execute('escaped', { path: PATH }, undefined, context())
  expect(result.content[0].text!.length).toBeLessThanOrEqual(STORE_OVER)
  expect(JSON.parse(result.content[0].text!).structure).toBe('summary')
})

it('does not merge source character windows with file-line windows or stale versions', () => {
  const base: ReadMark = { path: PATH, hash: contentHash(LARGE), via: 'read', at: 1 }
  const target = { path: PATH, need: 'whole' as const }
  for (const first of [
    { ...base, lines: [1, 10] as [number, number], total: 20 },
    { ...base, chars: [1, 10] as [number, number], totalChars: 20, hash: 'old' },
  ]) {
    const folded = foldMarks([first, { ...base, chars: [11, 20], totalChars: 20 }]).get(PATH)
    expect(refusal(target, folded, base.hash)).toContain('File must be read first')
  }
  const whole = foldMarks([base, { ...base, chars: [11, 20], totalChars: 20 }]).get(PATH)
  expect(refusal(target, whole, base.hash)).toBeNull()
})
