import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookZen.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(WAIT_PRELUDE, '')

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('rejects an unready zen reader rather than continuing after the polling deadline', async () => {
  vi.useFakeTimers()
  const leaf = {
    setViewState: vi.fn().mockResolvedValue(undefined),
    view: { model: { status: 'loading', panel: false } },
  }
  const open = new Function('window', 'require', 'app', `${prelude}; return open`)(
    { __abeleTest: { reader: {} } },
    () => ({ getCurrentWebContents: () => ({ debugger: {} }) }),
    { workspace: { getLeavesOfType: () => [], getLeaf: () => leaf } }
  ) as (path: string) => Promise<unknown>
  const result = open('sample-book.epub').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/reader.*ready/i)
})
