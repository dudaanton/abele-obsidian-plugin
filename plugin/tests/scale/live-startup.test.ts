// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { startupReceipt, waitForLiveStartup } = require('./live-startup.cjs')

describe('real renderer startup gate', () => {
  const ledger = { complete: true, productRootsReady: true, sequence: 12, dropped: 0 }
  const proof = () => startupReceipt({ at: 1400, profilerAcknowledgedAt: 1100,
    marks: [{ name: 'abele:onload-start', epoch: 1200 }, { name: 'abele:onload-end', epoch: 1300 }], ledger })
  it('accepts completed onload with acknowledged profiling from this launch', async () => {
    expect(await waitForLiveStartup({ read: async () => proof(), startedAt: 1000, now: () => 1500 }))
      .toMatchObject({ onloadStartedAt: 1200, ledger })
  })
  it.each([
    ['no completed onload', () => ({ ...proof(), onloadCompletedAt: null })],
    ['no profiler acknowledgement', () => ({ ...proof(), profilerAcknowledgedAt: null })],
    ['previous launch', () => ({ ...proof(), onloadCompletedAt: 999 })],
    ['stale profiler', () => ({ ...proof(), profilerAcknowledgedAt: 999 })],
  ])('fails closed for %s', async (_label, receipt) => {
    let time = 1500
    await expect(waitForLiveStartup({ read: async () => receipt(), startedAt: 1000,
      now: () => time, timeoutMs: 1000, delay: async () => { time += 600 } }))
      .rejects.toThrow('Real app startup proof unavailable')
  })
  it.each([
    ['no entry', () => ({ ...proof(), ledger: { ...ledger, sequence: 0 } })],
    ['partial coverage', () => ({ ...proof(), ledger: { ...ledger, complete: false } })],
    ['no product bridge', () => ({ ...proof(), ledger: { ...ledger, productRootsReady: false } })],
    ['lost entries', () => ({ ...proof(), ledger: { ...ledger, dropped: 1 } })],
  ])('retains %s diagnostics without making them a load prerequisite', async (_label, receipt) => {
    expect(await waitForLiveStartup({ read: async () => receipt(), startedAt: 1000, now: () => 1500 }))
      .toMatchObject(receipt())
  })
  it('bounds missing receipts without persisting arbitrary read errors', async () => {
    let time = 1000
    await expect(waitForLiveStartup({ read: async () => { throw new Error('private sample detail') },
      startedAt: 1000, now: () => time, timeoutMs: 1000, delay: async () => { time += 500 } }))
      .rejects.toThrow(/^Real app startup proof unavailable$/)
    expect(time).toBe(2000)
  })
})
