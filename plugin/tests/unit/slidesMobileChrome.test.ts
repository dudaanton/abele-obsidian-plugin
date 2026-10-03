import { describe, expect, it, vi } from 'vitest'
import { mobilePresentation } from '@/slides/mobilePresentation'

const make = (visible = true) => {
  const statusBar = {
    getInfo: vi.fn(async () => ({ visible })),
    hide: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
  }
  const host = mobilePresentation({ Capacitor: { Plugins: { StatusBar: statusBar } } })
  return { host, statusBar }
}

describe('native mobile presentation chrome', () => {
  it('hides the native status bar during Play and restores its previous visibility', async () => {
    const { host, statusBar } = make()
    await host.enter()
    expect(statusBar.hide).toHaveBeenCalledTimes(1)
    await host.exit()
    expect(statusBar.show).toHaveBeenCalledTimes(1)
  })
  it('does not reveal a status bar that was hidden before the show', async () => {
    const { host, statusBar } = make(false)
    await host.enter()
    await host.exit()
    expect(statusBar.hide).not.toHaveBeenCalled()
    expect(statusBar.show).not.toHaveBeenCalled()
  })
  it('restores the status bar even when Escape arrives during the native request', async () => {
    const { host, statusBar } = make()
    let finish!: () => void
    statusBar.hide.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r
        })
    )
    const entering = host.enter()
    await vi.waitFor(() => expect(statusBar.hide).toHaveBeenCalled())
    const exiting = host.exit()
    finish()
    await Promise.all([entering, exiting])
    expect(statusBar.show).toHaveBeenCalledTimes(1)
  })
  it('is inert when the native bridge is absent or fails', async () => {
    const absent = mobilePresentation({})
    await absent.enter()
    await absent.exit()
    const { host, statusBar } = make()
    statusBar.getInfo.mockRejectedValue(new Error('unavailable'))
    await expect(host.enter()).resolves.toBeUndefined()
    await expect(host.exit()).resolves.toBeUndefined()
    expect(statusBar.hide).not.toHaveBeenCalled()
  })
})
