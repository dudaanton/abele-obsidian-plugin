import { expect, it, vi } from 'vitest'

it('bounds work between yields while rendering twelve thousand activity actions', async () => {
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
      // Live updates yield to the host between batches.
      await new Promise((resolve) => setTimeout(resolve, 0))
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
