import { describe, expect, it, vi } from 'vitest'
import { restorePhoneState } from '../e2e/helpers/phoneState'

const state = (portrait = true, keyboard = 0, typing = false) => ({
  width: portrait ? 390 : 844,
  height: portrait ? 844 : 390,
  keyboard,
  typing,
})

describe('phone file boundaries', () => {
  it('restores landscape and dismisses typing before accepting a clean viewport', async () => {
    let current = state(false, 300, true)
    const turn = vi.fn(async () => {
      current = state(true, 300, true)
    })
    const blur = vi.fn(async () => {
      current = state()
    })
    const report = await restorePhoneState(
      () => current,
      turn,
      blur,
      async () => {}
    )
    expect(turn).toHaveBeenCalledOnce()
    expect(blur).toHaveBeenCalledOnce()
    expect(report.before).toEqual(state(false, 300, true))
    expect(report.after).toEqual(state())
  })

  it('waits for orientation and the native keyboard animation, not just blur', async () => {
    let current = state(false, 300, true)
    let waits = 0
    const report = await restorePhoneState(
      () => current,
      async () => {},
      async () => {},
      async () => {
        waits++
        if (waits === 3) current = state()
      }
    )
    expect(waits).toBeGreaterThanOrEqual(3)
    expect(report.after).toEqual(state())
  })

  it('refuses a keyboard or landscape viewport that never settles, with its condition', async () => {
    await expect(
      restorePhoneState(
        () => state(false, 300),
        async () => {},
        async () => {},
        async () => {},
        3
      )
    ).rejects.toThrow(/portrait.*keyboard.*844.*300/)
  })
})
