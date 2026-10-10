import { expect, it } from 'vitest'
import { ExchangeTrace } from '@/sync/exchangeTrace'

it('names a stalled operation synchronously and removes it after success or failure', async () => {
  const trace = new ExchangeTrace()
  let release!: () => void
  const job = trace.run(
    'GET /v2/manifest',
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  expect(trace.snapshot().active).toMatchObject([{ operation: 'GET /v2/manifest' }])
  release()
  await job
  expect(trace.snapshot().active).toEqual([])
  await expect(
    trace.run('read file', async () => {
      throw new Error('io')
    })
  ).rejects.toThrow('io')
  expect(trace.snapshot().active).toEqual([])
})
