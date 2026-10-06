import { describe, expect, it, vi } from 'vitest'
import { mobilePresentation } from '@/slides/mobilePresentation'

const make = (visible = true) => {
  const statusBar = {
    getInfo: vi.fn(async () => ({ visible })),
    hide: vi.fn(async () => {
      visible = false
    }),
    show: vi.fn(async () => {
      visible = true
    }),
  }
  const win = { Capacitor: { Plugins: { StatusBar: statusBar } } }
  const host = mobilePresentation(win)
  return { host, statusBar, win, visible: () => visible }
}

describe('native mobile presentation chrome', () => {
  it('keeps chrome hidden for a successor while an outgoing adapter has a late hide', async () => {
    const { host: first, statusBar, win, visible } = make()
    const second = mobilePresentation(win)
    let finish!: () => void
    const hide = statusBar.hide.getMockImplementation()!
    statusBar.hide.mockImplementation(() => {
      // Native effect arrives before the acknowledgement, as it can across a WebView bridge.
      void hide()
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const entering = first.enter()
    await vi.waitFor(() => expect(statusBar.hide).toHaveBeenCalledTimes(1))
    const exiting = first.exit()
    const successor = second.enter()
    finish()
    await Promise.all([entering, exiting, successor])
    expect(statusBar.show).not.toHaveBeenCalled()
    expect(visible()).toBe(false)
    expect(statusBar.getInfo).toHaveBeenCalledTimes(1)
    await first.exit() // Repeated outgoing destroy must not release the successor's ownership.
    expect(statusBar.show).not.toHaveBeenCalled()
    await second.exit()
    expect(statusBar.show).toHaveBeenCalledTimes(1)
    expect(visible()).toBe(true)
  })

  it('shares one baseline across overlapping adapters and repeated enter/exit lifetimes', async () => {
    const { host: first, statusBar, win, visible } = make()
    const second = mobilePresentation(win)
    await first.enter()
    await first.enter()
    await second.enter()
    expect(statusBar.hide).toHaveBeenCalledTimes(1)
    await first.exit()
    await first.exit()
    expect(visible()).toBe(false)
    expect(statusBar.show).not.toHaveBeenCalled()
    await second.exit()
    await second.exit()
    expect(visible()).toBe(true)
    expect(statusBar.show).toHaveBeenCalledTimes(1)
    await first.enter()
    await first.exit()
    expect(statusBar.getInfo).toHaveBeenCalledTimes(2)
    expect(statusBar.show).toHaveBeenCalledTimes(2)
  })

  it('preserves an initially hidden baseline for multiple owners', async () => {
    const { host: first, win, statusBar, visible } = make(false)
    const second = mobilePresentation(win)
    await first.enter()
    await second.enter()
    await first.exit()
    await second.exit()
    expect(visible()).toBe(false)
    expect(statusBar.hide).not.toHaveBeenCalled()
    expect(statusBar.show).not.toHaveBeenCalled()
    expect(statusBar.getInfo).toHaveBeenCalledTimes(1)
  })

  it('does not share ownership or queue waits between separate windows', async () => {
    const a = make(),
      b = make()
    let finish!: () => void
    a.statusBar.hide.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const entering = a.host.enter()
    await vi.waitFor(() => expect(a.statusBar.hide).toHaveBeenCalled())
    await b.host.enter()
    await b.host.exit()
    expect(b.statusBar.show).toHaveBeenCalledTimes(1)
    finish()
    await entering
    await a.host.exit()
    expect(a.statusBar.show).toHaveBeenCalledTimes(1)
  })

  it('rehides for an incoming owner if a previous native restore is already pending', async () => {
    const { host: first, win, statusBar } = make()
    const second = mobilePresentation(win)
    let finish!: () => void
    statusBar.show.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await first.enter()
    const exiting = first.exit()
    await vi.waitFor(() => expect(statusBar.show).toHaveBeenCalledTimes(1))
    const entering = second.enter()
    finish()
    await Promise.all([exiting, entering])
    expect(statusBar.hide).toHaveBeenCalledTimes(2)
    statusBar.show.mockResolvedValue()
    await second.exit()
    expect(statusBar.show).toHaveBeenCalledTimes(2)
  })

  it('recovers from rejected native operations without losing the original baseline', async () => {
    const { host, statusBar, win, visible } = make()
    statusBar.getInfo.mockRejectedValueOnce(new Error('not ready'))
    await host.enter()
    expect(statusBar.hide).not.toHaveBeenCalled()
    statusBar.hide.mockRejectedValueOnce(new Error('hide failed'))
    await host.enter()
    expect(statusBar.hide).toHaveBeenCalledTimes(1)
    const successor = mobilePresentation(win)
    await successor.enter()
    expect(visible()).toBe(false)
    await host.exit()
    statusBar.show.mockRejectedValueOnce(new Error('show failed'))
    await successor.exit()
    await successor.exit()
    expect(visible()).toBe(true)
    expect(statusBar.getInfo).toHaveBeenCalledTimes(2)
    expect(statusBar.show).toHaveBeenCalledTimes(2)
  })

  it('restores chrome after one rejected show without another ownership update', async () => {
    const { host, statusBar, visible } = make()
    await host.enter()
    statusBar.show.mockRejectedValueOnce(new Error('temporarily unavailable'))
    await host.exit()
    expect(visible()).toBe(true)
    expect(statusBar.show).toHaveBeenCalledTimes(2)
  })

  it('bounds retries and retains the baseline after persistent restoration failure', async () => {
    const { host, statusBar, visible } = make()
    await host.enter()
    const restore = statusBar.show.getMockImplementation()!
    statusBar.show.mockRejectedValue(new Error('unavailable'))
    await host.exit()
    expect(statusBar.show).toHaveBeenCalledTimes(2)
    expect(visible()).toBe(false)
    statusBar.show.mockImplementation(restore)
    await host.exit()
    expect(visible()).toBe(true)
    expect(statusBar.show).toHaveBeenCalledTimes(3)
    expect(statusBar.getInfo).toHaveBeenCalledTimes(1)
  })

  it('does not retry a rejected restoration over an incoming owner', async () => {
    const { host: first, statusBar, win, visible } = make()
    const second = mobilePresentation(win)
    let reject!: (error: Error) => void
    statusBar.show.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail
        })
    )
    await first.enter()
    const exiting = first.exit()
    await vi.waitFor(() => expect(statusBar.show).toHaveBeenCalledTimes(1))
    const entering = second.enter()
    reject(new Error('late restoration rejection'))
    await Promise.all([exiting, entering])
    expect(statusBar.show).toHaveBeenCalledTimes(1)
    expect(visible()).toBe(false)
    expect(statusBar.hide).toHaveBeenCalledTimes(2)
    await second.exit()
    expect(visible()).toBe(true)
  })

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
  it('does not start an irreversible hide with an incomplete native capability', async () => {
    const getInfo = vi.fn(async () => ({ visible: true }))
    const hide = vi.fn(async () => {})
    const host = mobilePresentation({
      Capacitor: { Plugins: { StatusBar: { getInfo, hide } } },
    } as never)
    await host.enter()
    await host.exit()
    expect(getInfo).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it('handles a hide rejection after the native effect and restores on exit', async () => {
    const { host, statusBar, visible } = make()
    const hide = statusBar.hide.getMockImplementation()!
    statusBar.hide.mockImplementationOnce(async () => {
      await hide()
      throw Error('late native rejection')
    })
    await host.enter()
    expect(visible()).toBe(false)
    await host.exit()
    expect(visible()).toBe(true)
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
