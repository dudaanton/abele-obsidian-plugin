// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { startupReceipt, waitForLiveStartup } = require('./live-startup.cjs')

describe('real renderer startup gate', () => {
  const ledger = { complete: true, productRootsReady: true, sequence: 12, dropped: 0 }
  const proof = () => startupReceipt({ at: 1400, marks: [{ name: 'abele:onload-start', epoch: 1200 }], ledger })
  it('accepts product onload with an acknowledged, nonempty ledger from this launch', async () => {
    expect(await waitForLiveStartup({ read: async () => proof(), startedAt: 1000, now: () => 1500 }))
      .toMatchObject({ onloadStartedAt: 1200, ledger })
  })
  it.each([
    ['no onload', () => ({ ...proof(), onloadStartedAt: null })],
    ['no entry', () => ({ ...proof(), ledger: { ...ledger, sequence: 0 } })],
    ['partial coverage', () => ({ ...proof(), ledger: { ...ledger, complete: false } })],
    ['no product bridge', () => ({ ...proof(), ledger: { ...ledger, productRootsReady: false } })],
    ['lost entries', () => ({ ...proof(), ledger: { ...ledger, dropped: 1 } })],
    ['previous launch', () => ({ ...proof(), onloadStartedAt: 999 })],
  ])('fails closed for %s', async (_label, receipt) => {
    let time = 1500
    await expect(waitForLiveStartup({ read: async () => receipt(), startedAt: 1000,
      now: () => time, timeoutMs: 1000, delay: async () => { time += 600 } }))
      .rejects.toThrow('Real app startup proof unavailable')
  })
  it('bounds missing receipts without persisting arbitrary read errors', async () => {
    let time = 1000
    await expect(waitForLiveStartup({ read: async () => { throw new Error('private sample detail') },
      startedAt: 1000, now: () => time, timeoutMs: 1000, delay: async () => { time += 500 } }))
      .rejects.toThrow(/^Real app startup proof unavailable$/)
    expect(time).toBe(2000)
  })
})
