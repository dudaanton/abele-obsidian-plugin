import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/calendarBase.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', 'FOLDER', `return \`${template}\``)(
  WAIT_PRELUDE,
  '',
  'Sample calendar'
)
const tab = new Function(`${prelude}; return tab`)() as (
  root: unknown,
  label: string
) => Promise<void>

function calendar(delay?: number) {
  const root = {
    dataset: { mode: 'month' },
    querySelector: () => root.dataset.mode === 'week',
    querySelectorAll: () => [
      {
        textContent: 'Week',
        click: () => {
          if (delay !== undefined) setTimeout(() => (root.dataset.mode = 'week'), delay)
        },
      },
    ],
  }
  return root
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the requested calendar mode instead of accepting the previous one', async () => {
  vi.useFakeTimers()
  const done = vi.fn()
  void tab(calendar(1100), 'Week').then(done)
  await vi.advanceTimersByTimeAsync(800)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(400)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects a calendar mode which never mounts', async () => {
  vi.useFakeTimers()
  const result = tab(calendar(), 'Week').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/calendar.*week/i)
})

it('waits for the new frontmatter, not just for any cached frontmatter', async () => {
  vi.useFakeTimers()
  const frontmatter = { date: '2000-01-01' }
  const app = {
    vault: { getAbstractFileByPath: () => ({}) },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
  }
  const fm = new Function('app', `${prelude}; return fm`)(app) as (
    name: string,
    expected: Record<string, string>
  ) => Promise<unknown>
  const done = vi.fn()
  setTimeout(() => (frontmatter.date = '2000-01-02'), 2100)
  void fm('Sample note', { date: '2000-01-02' }).then(done)
  await vi.advanceTimersByTimeAsync(1800)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(400)
  expect(done).toHaveBeenCalledWith({ date: '2000-01-02' })
})
