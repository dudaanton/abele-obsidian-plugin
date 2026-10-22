import { expect, it, vi } from 'vitest'

it('bounds rendering work per update for twelve thousand activity actions', async () => {
  // Count module-level construction as well as construction during live updates.
  vi.resetModules()
  const { mount } = await import('@vue/test-utils')
  const DateTimeFormat = Intl.DateTimeFormat
  const formatters = vi
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(function (locales, options) {
      return new DateTimeFormat(locales, options)
    })
  const { default: ConnectionEvents } = await import('@/components/sync/ConnectionEvents.vue')
  const { ActivityHistory } = await import('@/sync/activityHistory')
  const time = await import('@/sync/activityTime')
  const formats = vi.spyOn(time, 'activityTime')
  const events = new ActivityHistory()
  const host = document.createElement('div')
  host.className = 'abele-modal__body'
  document.body.append(host)
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  const heights = vi.spyOn(Element.prototype, 'scrollHeight', 'get')
  const view = mount(ConnectionEvents, { attachTo: host, props: { events, revision: 0 } })
  let mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  observer.observe(view.element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  let reads = 0
  try {
    for (let start = 0; start < 12000; start += 32) {
      reads = 0
      mutations = []
      formats.mockClear()
      geometry.mockClear()
      heights.mockClear()
      for (let i = start; i < start + 32; i++)
        events.append({
          at: 1000 + i,
          get text() {
            reads++
            return 'Uploaded Notes/sample-' + i + '.md'
          },
        })
      await view.setProps({ revision: events.revision })
      mutations.push(...observer.takeRecords())
      // Only boundary chunks may render: the tail (64), the expiring head (64),
      // and, when the head crosses a boundary, its replacement (64).
      expect(reads, `row evaluations at ${start}`).toBeLessThanOrEqual(192)
      expect(formats.mock.calls.length, `time formats at ${start}`).toBeLessThanOrEqual(128)
      expect(formatters.mock.calls.length, 'one shared formatter for the entire log').toBe(1)
      // 32 new rows with two spans and their text, plus up to 32 expired rows.
      expect(mutations.length, `DOM mutations at ${start}`).toBeLessThanOrEqual(32 * 8)
      const addedRows = mutations
        .flatMap((record) => [...record.addedNodes])
        .filter((node) => node instanceof HTMLElement && node.tagName === 'LI')
      const removedRows = mutations
        .flatMap((record) => [...record.removedNodes])
        .filter((node) => node instanceof HTMLElement && node.tagName === 'LI')
      expect(addedRows).toHaveLength(32)
      expect(removedRows.length).toBeLessThanOrEqual(32)
      // Following the tail reads its height once, without a per-row layout walk.
      expect(geometry.mock.calls.length + heights.mock.calls.length).toBeLessThanOrEqual(2)
    }
    expect(view.findAll('li')).toHaveLength(5000)
    expect(view.find('li').text()).toContain('sample-7000.md')
    expect(view.findAll('li').at(-1)?.text()).toContain('sample-11999.md')
  } finally {
    observer.disconnect()
    view.unmount()
    host.remove()
    vi.restoreAllMocks()
  }
})

it('lets host timers run during the production scan and live activity publication', async () => {
  vi.resetModules()
  const { mount } = await import('@vue/test-utils')
  const { h } = await import('vue')
  const { default: ConnectionEvents } = await import('@/components/sync/ConnectionEvents.vue')
  const { tokenUiFixture } = await import('@/testing/tokenUiFixture')
  const { ActivityHistory } = await import('@/sync/activityHistory')
  const { TokenEngineRuntime } = await import('@/sync/tokenEngineRuntime')
  const { ExecutableReview } = await import('@/sync/executableReview')
  const { AttachmentConsent } = await import('@/sync/attachmentConsent')
  const { MemoryFileSystem, MemoryStateStore, scan } = await import('@abele/sync-sdk/core')
  const { encodeAccessToken } = await import('@abele/sync-sdk/protocol')
  const time = await import('@/sync/activityTime')
  const formats = vi.spyOn(time, 'activityTime')
  const ui = tokenUiFixture(true)
  const id = 'sample-connection'
  ui.activity.value = { [id]: { events: new ActivityHistory(), eventsRevision: 0 } }
  const host = document.createElement('div')
  host.className = 'abele-modal__body'
  document.body.append(host)
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  const heights = vi.spyOn(Element.prototype, 'scrollHeight', 'get')
  const view = mount(
    {
      setup: () => () =>
        h(ConnectionEvents, {
          events: ui.activity.value[id].events!,
          revision: ui.activity.value[id].eventsRevision,
        }),
    },
    { attachTo: host }
  )
  let mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  observer.observe(view.element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  let reads = 0
  const append = ActivityHistory.prototype.append
  vi.spyOn(ActivityHistory.prototype, 'append').mockImplementation(function (event) {
    const text = event.text
    append.call(this, {
      at: event.at,
      get text() {
        reads++
        return text
      },
    })
  })
  const fs = new MemoryFileSystem()
  for (let i = 0; i < 12000; i++)
    await fs.writeAtomic('Notes/sample-' + i + '.md', new Uint8Array([1]), 1000)
  let processed = 0
  let inventoried = 0
  const list = fs.list.bind(fs)
  fs.list = async function* () {
    for await (const info of list()) {
      inventoried++
      yield info
    }
  }
  Object.assign(fs, {
    fingerprint: async () => {
      processed++
      return { size: 1, sha: 'b'.repeat(64) }
    },
  })
  const state = new MemoryStateStore()
  const metadata = new MemoryStateStore()
  // Simulate CPU cost deterministically. Only production decides when to yield.
  vi.useFakeTimers()
  let cpu = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (cpu += 0.25))
  // Model the browser scheduler with a fake-timer task boundary. Giving each
  // continuation the next clock tick avoids fake zero-delay timers all sharing
  // time zero while the host heartbeat waits at time one.
  const yieldTask = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1)))
  vi.stubGlobal('scheduler', { yield: yieldTask })
  const runtime = new TokenEngineRuntime({
    id,
    encoded: encodeAccessToken({
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    }),
    fs,
    state,
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    fetch: async () => {
      throw new Error('Cached scanning must not use the network')
    },
    changed: () => {},
    failed: (error) => {
      throw error
    },
    covers: async () => false,
    event: (text) => ui.recordEvent(id, text),
  })
  // Use the same adapter and SDK scan as the runtime's exchange, including its
  // comparison budget and activity callbacks, rather than scheduling updates here.
  const scanning = (
    runtime.engine as unknown as {
      opts: { fs: import('@abele/sync-sdk/core').FileSystem }
    }
  ).opts.fs
  let previous = 0
  let previousWork = 0
  let partialTicks = 0
  let publishedTicks = 0
  let done = false
  const checkChunk = () => {
    mutations.push(...observer.takeRecords())
    const count = processed - previous
    const work = inventoried + processed
    expect(work - previousWork, 'file operations without a host timer').toBeLessThanOrEqual(32)
    expect(reads, 'row evaluations between host timers').toBeLessThanOrEqual(192)
    expect(formats.mock.calls.length).toBeLessThanOrEqual(128)
    expect(mutations.length).toBeLessThanOrEqual(32 * 8)
    const rows = (nodes: NodeList) =>
      [...nodes].filter((node) => node instanceof HTMLElement && node.tagName === 'LI')
    expect(mutations.flatMap((record) => rows(record.addedNodes)).length).toBeLessThanOrEqual(32)
    expect(mutations.flatMap((record) => rows(record.removedNodes)).length).toBeLessThanOrEqual(32)
    expect(geometry.mock.calls.length + heights.mock.calls.length).toBeLessThanOrEqual(2)
    if (count > 0 && processed < 12000) {
      partialTicks++
      if (view.text().includes('Comparing files')) publishedTicks++
    }
    previous = processed
    previousWork = work
    reads = 0
    mutations = []
    formats.mockClear()
    geometry.mockClear()
    heights.mockClear()
  }
  const timer = setInterval(checkChunk, 1)
  const job = scan(
    scanning,
    state,
    { excluded: () => false },
    {
      readOnly: true,
      pairMoves: false,
    }
  ).finally(() => {
    done = true
  })
  void job.catch(() => {})
  try {
    // Advancing the host does not insert any yield into the producer. A continuous
    // production microtask chain finishes all files before this first timer fires.
    while (!done) await vi.advanceTimersToNextTimerAsync()
    const found = await job
    checkChunk()
    expect(partialTicks).toBeGreaterThan(1)
    expect(yieldTask).toHaveBeenCalled()
    expect(publishedTicks, 'live activity is visible while scanning is incomplete').toBeGreaterThan(
      1
    )
    expect(processed).toBe(12000)
    // The SDK lists once for local path mapping and once for the scan.
    expect(inventoried).toBe(24000)
    expect(found.ops).toHaveLength(12000)
    expect(view.text()).toContain('Comparing files')
  } finally {
    clearInterval(timer)
    runtime.invalidate()
    await vi.runAllTimersAsync()
    await job.catch(() => {})
    await runtime.close()
    observer.disconnect()
    view.unmount()
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
