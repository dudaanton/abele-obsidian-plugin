import { expect, it, vi } from 'vitest'
import { consentCleanupStages } from '../helpers/consentCleanupStages'

it('attempts every owned stage once and keeps first cleanup failure with secondary records', async () => {
  const first = new Error('sample config failure'),
    second = new Error('sample owner failure'),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const restored = vi.fn(),
    last = vi.fn()
  try {
    await expect(
      consentCleanupStages([
        {
          name: 'config',
          run: () => {
            throw first
          },
        },
        { name: 'owned-storage', run: restored },
        {
          name: 'owner',
          run: () => {
            throw second
          },
        },
        { name: 'release', run: last },
      ])
    ).rejects.toBe(first)
    expect(restored).toHaveBeenCalledOnce()
    expect(last).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      'Secondary consent cleanup failures',
      JSON.stringify([{ stage: 'owner', message: second.message }])
    )
  } finally {
    warn.mockRestore()
  }
})
it('fails a sole cleanup error rather than masking it', async () => {
  const error = new Error('sample sole cleanup failure')
  await expect(
    consentCleanupStages([
      {
        name: 'owned-storage',
        run: () => {
          throw error
        },
      },
    ])
  ).rejects.toBe(error)
})
