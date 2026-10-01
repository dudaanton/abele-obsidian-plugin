import { describe, expect, it, vi } from 'vitest'
import { nativeFullscreen } from '@/slides/fullscreen'

describe('native presentation fullscreen adapter', () => {
  it('enters the native window, restores its previous mode, and releases exit listeners', async () => {
    let fullscreen = false
    const win = {
      isFullScreen: () => fullscreen,
      setFullScreen: vi.fn((on: boolean) => {
        fullscreen = on
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const host = nativeFullscreen(win)
    const exited = vi.fn(),
      stop = host.watchExited!(exited)
    expect(win.on).toHaveBeenCalledWith('leave-full-screen', exited)
    await host.enter()
    expect(fullscreen).toBe(true)
    await host.exit()
    expect(fullscreen).toBe(false)
    stop()
    expect(win.removeListener).toHaveBeenCalledWith('leave-full-screen', exited)
  })

  it('uses simple fullscreen on a desktop host that does not enter a separate native space', async () => {
    let simple = false
    const win = {
      isFullScreen: () => false,
      setFullScreen: vi.fn(),
      isSimpleFullScreen: () => simple,
      setSimpleFullScreen: vi.fn((on: boolean) => {
        simple = on
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const host = nativeFullscreen(win, true)
    await host.enter()
    expect(simple).toBe(true)
    expect(win.setFullScreen).not.toHaveBeenCalled()
    await host.exit()
    expect(simple).toBe(false)
  })

  it('does not leave native fullscreen if the window was already fullscreen before presenting', async () => {
    const win = {
      isFullScreen: () => true,
      setFullScreen: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const host = nativeFullscreen(win)
    await host.enter()
    await host.exit()
    expect(win.setFullScreen).not.toHaveBeenCalled()
  })
})
