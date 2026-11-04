// @vitest-environment node
import { expect, it } from 'vitest'
import { freeFixturePort } from '../e2e/helpers/syncFixturePort'
import { createServer } from 'node:net'

it('keeps a forwarded phone listener outside the dynamic client port range', async () => {
  const port = await freeFixturePort(true)
  expect(port).toBeGreaterThanOrEqual(12000)
  expect(port).toBeLessThan(32768)
})
it('retains automatic runner allocation for an ordinary desktop fixture', async () => {
  expect(await freeFixturePort(false)).toBeGreaterThan(0)
})

it('skips an occupied runner port and leaves its listener alone', async () => {
  const first = await freeFixturePort(true)
  const held = createServer()
  await new Promise<void>((resolve) => held.listen(first, '127.0.0.1', resolve))
  try {
    const selected = await freeFixturePort(true, first)
    expect(selected).not.toBe(first)
    expect(selected).toBeLessThan(32768)
    expect(held.listening).toBe(true)
  } finally {
    await new Promise<void>((resolve) => held.close(() => resolve()))
  }
})
