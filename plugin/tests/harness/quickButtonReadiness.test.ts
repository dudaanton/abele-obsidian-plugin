import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/quickButton.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(WAIT_PRELUDE, '')

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('does not measure the quick button before placement and its slide finish', async () => {
  vi.useFakeTimers()
  let placed = false
  let animating = true
  const rect = { left: 300, right: 350, top: 600, bottom: 650 }
  const button = {
    getBoundingClientRect: () => rect,
    getAnimations: () => (animating ? [{ playState: 'running' }] : []),
    style: { getPropertyValue: () => (placed ? '600px' : '') },
    classList: { contains: () => false },
    offsetLeft: 300,
    offsetTop: 600,
    offsetWidth: 50,
    offsetHeight: 50,
  }
  const obstacle = {
    getClientRects: () => [{ left: 0, right: 390, top: 700, bottom: 750 }],
    getBoundingClientRect: () => ({ left: 0, right: 390, top: 700, bottom: 750 }),
    getAnimations: () => [],
  }
  const report = new Function(
    'require',
    'document',
    'innerWidth',
    'innerHeight',
    `${prelude}; return report`
  )(
    () => ({ getCurrentWebContents: () => ({ debugger: {} }) }),
    { querySelector: () => button, querySelectorAll: () => [obstacle] },
    390,
    844
  ) as (below: string) => Promise<unknown>
  const done = vi.fn()
  void report('.sample-navbar').then(done)
  await vi.advanceTimersByTimeAsync(600)
  expect(done).not.toHaveBeenCalled()
  placed = true
  await vi.advanceTimersByTimeAsync(100)
  expect(done).not.toHaveBeenCalled()
  animating = false
  await vi.advanceTimersByTimeAsync(100)
  expect(done).toHaveBeenCalledOnce()
})
