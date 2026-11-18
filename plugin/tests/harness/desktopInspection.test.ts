import { expect, it, vi } from 'vitest'
import { desktopCaptureErrors, withDesktopInspection } from '../e2e/helpers/desktopInspection'

const desktop = {
  width: 1200,
  height: 900,
  imageWidth: 1200,
  imageHeight: 900,
  mobile: false,
  phoneClasses: false,
  centered: true,
}
it.each([
  { mobile: true },
  { phoneClasses: true },
  { centered: false },
  { imageWidth: 780, imageHeight: 1688 },
])('rejects a non-desktop capture even with a 1200-wide viewport: %j', (change) => {
  expect(desktopCaptureErrors({ ...desktop, ...change })).not.toEqual([])
})
it('accepts the full desktop window', () => expect(desktopCaptureErrors(desktop)).toEqual([]))
it.each([false, true])(
  'enters desktop mode and restores the prior phone state after failure=%s',
  async (fail) => {
    const show = vi.fn(async () => {})
    const work = vi.fn(async () => {
      if (fail) throw new Error('sample failure')
      return 'captured'
    })
    const task = withDesktopInspection(
      { snapshot: () => ({ mobile: true, width: 390, height: 844 }), show },
      work
    )
    if (fail) await expect(task).rejects.toThrow('sample failure')
    else await expect(task).resolves.toBe('captured')
    expect(show.mock.calls).toEqual([
      [1200, 900, false],
      [390, 844, true],
    ])
  }
)
