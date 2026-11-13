import { expect, it, vi } from 'vitest'
import { TransferBudget } from '@abele/sync-sdk/core'
import { discoveryPriorityOf } from '@/sync/transferBudget'

it('gives each waiting connection one cold read every five seconds under overlapping incoming leases', () => {
  vi.useFakeTimers()
  try {
    const budget = new TransferBudget()
    const first = discoveryPriorityOf(budget),
      second = discoveryPriorityOf(budget)
    const receiving = {},
      placing = {}
    first.set(receiving, true)
    first.set(placing, true)
    expect(first.mayScan).toBe(false)
    expect(second.mayScan).toBe(false)
    vi.advanceTimersByTime(4999)
    expect(first.claimRead()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(first.mayScan).toBe(true)
    expect(first.claimRead()).toBe(true)
    expect(first.claimRead()).toBe(false)
    expect(second.claimRead()).toBe(true)
    first.set(receiving, false)
    expect(first.available).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(first.claimRead()).toBe(true)
    expect(second.claimRead()).toBe(true)
    first.set(placing, false)
    expect(first.available).toBe(true)
    expect(first.mayScan).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
