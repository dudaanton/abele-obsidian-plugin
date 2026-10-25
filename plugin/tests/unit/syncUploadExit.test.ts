import { afterEach, expect, it, vi } from 'vitest'
import { watchTheFront, watchSyncQuit } from '@/sync/phone'
import type { Plugin } from 'obsidian'

afterEach(() => vi.restoreAllMocks())

it('inspects immediately after native wake and removes the wake listener on unload', () => {
  const monitor = { on: vi.fn((_event: string, _cb: () => void) => {}), removeListener: vi.fn() }
  const previous = Object.getOwnPropertyDescriptor(window, 'require')
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: () => ({ powerMonitor: monitor }),
  })
  try {
    let cleanup!: () => void
    const sync = vi.fn()
    watchTheFront(
      {
        registerDomEvent: vi.fn(),
        register: (cb) => {
          cleanup = cb
        },
      },
      false,
      { held: vi.fn(), sync }
    )
    expect(monitor.on).toHaveBeenCalledWith('resume', expect.any(Function))
    const resume = monitor.on.mock.calls[0][1] as () => void
    resume()
    expect(sync).toHaveBeenCalledWith(true)
    cleanup()
    expect(monitor.removeListener).toHaveBeenCalledWith('resume', resume)
  } finally {
    if (previous) Object.defineProperty(window, 'require', previous)
    else Reflect.deleteProperty(window, 'require')
  }
})

it.each([false, true])('flushes on background for mobile=%s', (mobile) => {
  let visibility!: () => void
  const plugin = {
    registerDomEvent: (_el: unknown, event: string, cb: () => void) => {
      if (event === 'visibilitychange') visibility = cb
    },
  }
  const sync = vi.fn()
  watchTheFront(plugin, mobile, { held: vi.fn(), sync })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  visibility()
  expect(sync).toHaveBeenCalledWith(false)
})

it('adds an awaited flush task to host quit before shutdown', async () => {
  let quit!: (tasks: { add(work: () => Promise<void>): void }) => void
  const registerEvent = vi.fn()
  const plugin = {
    app: {
      workspace: {
        on: (_event: string, cb: typeof quit) => {
          quit = cb
          return {}
        },
      },
    },
    registerEvent,
  } as unknown as Pick<Plugin, 'app' | 'registerEvent'>
  let complete!: () => void
  const flush = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  watchSyncQuit(plugin, flush)
  let task!: () => Promise<void>
  quit({
    add: (work) => {
      task = work
    },
  })
  let finished = false
  const draining = task().then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  complete()
  await draining
  expect(finished).toBe(true)
  expect(flush).toHaveBeenCalledOnce()
  expect(registerEvent).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'inspects on focus, visibility return and page resume for mobile=%s',
  (mobile) => {
    const handlers = new Map<string, () => void>()
    const plugin = {
      registerDomEvent: (_el: unknown, event: string, cb: () => void) => {
        handlers.set(event, cb)
      },
    }
    const sync = vi.fn()
    watchTheFront(plugin, mobile, { held: vi.fn(), sync })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    for (const event of ['focus', 'visibilitychange', 'resume']) {
      sync.mockClear()
      handlers.get(event)?.()
      expect(sync).toHaveBeenCalledWith(true)
    }
  }
)
