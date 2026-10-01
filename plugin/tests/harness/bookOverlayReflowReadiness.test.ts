import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookOverlayReflow.e2e.test.ts'), 'utf8')
const checkSource = source.match(/const check = ([\s\S]*?)\n {6}const shot/)![1]

function probe() {
  const checks: unknown[] = []
  const box = { left: 10, top: 20, width: 100, height: 18 }
  let drawn = { ...box }
  const group = (fill: string) => ({
    getAttribute: () => fill,
    querySelectorAll: () => [{ getBoundingClientRect: () => drawn }],
  })
  const contents = () => ({
    overlayer: { element: { children: [group('none'), group('yellow')] } },
  })
  const doc = {
    defaultView: { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
  }
  const p = { getBoundingClientRect: () => box }
  const range = () => ({ getClientRects: () => [box] })
  const check = new Function(
    'contents',
    'doc',
    'p',
    'range',
    'query',
    'checks',
    `${WAIT_PRELUDE}; const rect = r => [r.left,r.top,r.width,r.height]; return ${checkSource}`
  )(contents, doc, p, range, 'sample', checks) as (
    name: string,
    applied?: () => boolean
  ) => Promise<void>
  return {
    check,
    checks,
    drawAt: (left: number) => {
      drawn = { ...box, left }
    },
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the requested reflow instead of accepting the old aligned rectangles', async () => {
  vi.useFakeTimers()
  const { check, checks } = probe()
  let applied = false
  setTimeout(() => {
    applied = true
  }, 1200)
  const done = vi.fn()
  void check('delayed reflow', () => applied).then(done)
  await vi.advanceTimersByTimeAsync(1000)
  expect(done).not.toHaveBeenCalled()
  expect(checks).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(500)
  expect(done).toHaveBeenCalledOnce()
  expect(checks).toHaveLength(1)
})

it('rejects overlays that never catch up with their words', async () => {
  vi.useFakeTimers()
  const { check, drawAt } = probe()
  drawAt(90)
  const result = check('misaligned overlay').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toContain('misaligned overlay')
})
