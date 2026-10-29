// @vitest-environment node
import { expect, it } from 'vitest'
import { waitForJsonExport } from './evidence-export.mjs'

it('waits for the diagnostic export after idle, including a partially written file', async () => {
  const observations = ['missing', '{"calls":', '{"calls":3}']
  const seen: string[] = []
  const result = await waitForJsonExport('sample-trace.json', {
    read: async () => {
      const value = observations.shift()!
      seen.push(value)
      if (value === 'missing') throw Object.assign(new Error('not written'), { code: 'ENOENT' })
      return value
    },
    delay: async () => {},
  })
  expect(result).toEqual({ calls: 3 })
  expect(seen).toHaveLength(3)
})

it('bounds an export that never finishes and preserves storage errors', async () => {
  await expect(
    waitForJsonExport('sample-trace.json', {
      timeoutMs: 0,
    })
  ).rejects.toThrow('Timed out waiting for JSON evidence export')
  await expect(
    waitForJsonExport('sample-trace.json', {
      read: async () => {
        throw Object.assign(new Error('sample storage failure'), { code: 'EACCES' })
      },
    })
  ).rejects.toThrow('sample storage failure')
})
