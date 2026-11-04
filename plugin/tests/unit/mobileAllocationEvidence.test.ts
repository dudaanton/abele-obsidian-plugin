import { expect, it } from 'vitest'
import {
  allocationEvidence,
  startMobileAllocationEvidence,
  stopMobileAllocationEvidence,
  trackMobileAllocation,
  mobileAllocationSnapshot,
} from '@/sync/mobileAllocationEvidence'

it('stops collection at case teardown and starts a fresh measurement next time', () => {
  startMobileAllocationEvidence()
  trackMobileAllocation(new ArrayBuffer(512))
  expect(mobileAllocationSnapshot()).toMatchObject({ enabled: true, allocatedBytes: 512 })
  stopMobileAllocationEvidence()
  trackMobileAllocation(new ArrayBuffer(1024))
  expect(mobileAllocationSnapshot().enabled).toBe(false)
  startMobileAllocationEvidence()
  expect(mobileAllocationSnapshot()).toMatchObject({ enabled: true, allocatedBytes: 0 })
  stopMobileAllocationEvidence()
})

it('counts unreclaimed buffers without retaining them and separates native acknowledgement', () => {
  const held: number[] = []
  let collect: (size: number) => void = () => {}
  const evidence = allocationEvidence((callback) => {
    collect = callback
    return {
      register: (_target, size) => {
        held.push(size)
      },
    }
  })
  const bytes = new Uint8Array(1024)
  evidence.track(bytes.buffer)
  evidence.track(bytes.subarray(10).buffer)
  const done = evidence.submit(1368)
  expect(evidence.snapshot()).toMatchObject({
    allocatedBytes: 1024,
    unreclaimedBytes: 1024,
    nativePendingBytes: 1368,
  })
  done()
  done()
  expect(evidence.snapshot()).toMatchObject({ unreclaimedBytes: 1024, nativePendingBytes: 0 })
  collect(held[0])
  expect(evidence.snapshot()).toMatchObject({ unreclaimedBytes: 0, collectedBytes: 1024 })
})

it('reports unavailable collection evidence instead of claiming buffers were collected', () => {
  const evidence = allocationEvidence(null)
  evidence.track(new ArrayBuffer(1024))
  expect(evidence.snapshot()).toMatchObject({ collectionAvailable: false, unreclaimedBytes: null })
})
