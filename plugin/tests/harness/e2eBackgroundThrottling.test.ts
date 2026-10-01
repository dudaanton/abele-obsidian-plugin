import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/helpers/obsidianCli.ts'), 'utf8')
const setter = source.match(
  /export function setBackgroundThrottling\(on: boolean\): void \{([\s\S]*?)\n\}/
)![1]
const probe = (evalRaw: ReturnType<typeof vi.fn>) =>
  new Function('onPhone', 'evalRaw', `return (on) => { ${setter} }`)(() => false, evalRaw) as (
    on: boolean
  ) => void

it('retries a lost reply once when setting background throttling after a reload', () => {
  const evalRaw = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('obsidian eval gave no answer in 30000 ms and was killed')
    })
    .mockReturnValueOnce('ok')
  expect(() => probe(evalRaw)(false)).not.toThrow()
  expect(evalRaw).toHaveBeenCalledTimes(2)
  const [first, retry] = evalRaw.mock.calls
  expect(first[0]).toEqual(retry[0])
  expect(first[1] + retry[1]).toBeLessThan(45_000)
})

it('does not retry an actual command error', () => {
  const evalRaw = vi.fn(() => {
    throw new Error('remote unavailable')
  })
  expect(() => probe(evalRaw)(false)).toThrow('remote unavailable')
  expect(evalRaw).toHaveBeenCalledOnce()
})

it('still fails if the retried throttling call also gets no reply', () => {
  const evalRaw = vi.fn(() => {
    throw new Error('obsidian eval gave no answer in 30000 ms and was killed')
  })
  expect(() => probe(evalRaw)(false)).toThrow('gave no answer')
  expect(evalRaw).toHaveBeenCalledTimes(2)
})
