import { expect, it, vi } from 'vitest'
import { nativeGesture } from '../helpers/nativeGesture'

it.each(['request never arrived', 'delivered but reply lost'])(
  'keeps %s primary without gesture replay',
  async (failure) => {
    const tap = vi.fn(async () => {
      throw new Error(`Phone host transport (tap): sample ${failure}`)
    })
    await expect(nativeGesture(tap)).rejects.toThrow(
      `Phone host transport (tap): sample ${failure}`
    )
    expect(tap).toHaveBeenCalledOnce()
  }
)

it('returns the explicit acknowledgment without inferring selection', async () => {
  const tap = vi.fn(async () => ({ ok: true }))
  expect(await nativeGesture(tap)).toEqual({ ok: true })
  expect(tap).toHaveBeenCalledOnce()
})
