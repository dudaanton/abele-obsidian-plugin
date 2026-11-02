// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { startupReceipt, waitForLiveStartup } = createRequire(import.meta.url)('./live-startup.cjs')
it('accepts completed onload and acknowledged profiling with partial ledger coverage', async () => {
  const proof = startupReceipt({ at: 1500, profilerAcknowledgedAt: 1100,
    marks: [{ name: 'abele:onload-start', epoch: 1200 }, { name: 'abele:onload-end', epoch: 1400 }],
    ledger: { complete: false, sequence: 12, dropped: 0, productRootsReady: true } })
  let now = 1600
  expect(await waitForLiveStartup({ read: async () => proof, startedAt: 1000, now: () => now,
    timeoutMs: 1000, delay: async () => { now += 500 } }))
    .toMatchObject({ onloadCompletedAt: 1400, profilerAcknowledgedAt: 1100, ledger: { complete: false } })
})
