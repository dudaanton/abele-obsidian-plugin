import { expect, it, vi } from 'vitest'
import { savePoint, namesOnLine, marginMenu } from '@/debugger/trace/panel'
import { Menu } from 'obsidian'
import type { DebuggerBinding } from '@/debugger/DebuggerService'

it('accepts Escape immediately after opening and releases its keyboard listener when hidden', async () => {
  vi.useFakeTimers()
  let keyboardScopeLoaded = false
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (
    this: Menu
  ) {
    window.setTimeout(() => {
      keyboardScopeLoaded = true
    }, 0)
    return this
  })
  const originalHide = Menu.prototype.hide
  const hide = vi.spyOn(Menu.prototype, 'hide').mockImplementation(function (this: Menu) {
    expect(keyboardScopeLoaded).toBe(true)
    keyboardScopeLoaded = false
    return originalHide.call(this)
  })
  try {
    marginMenu(
      { controller: { knownBreakpoints: () => [], current: true } } as never,
      'sample-source',
      1,
      new MouseEvent('contextmenu', { clientX: 1 })
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.runOnlyPendingTimersAsync()
    expect(hide).toHaveBeenCalledOnce()
    expect(hide.mock.instances[0]).toBe(show.mock.instances[0])
    expect(keyboardScopeLoaded).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.runOnlyPendingTimersAsync()
    expect(hide).toHaveBeenCalledOnce()
  } finally {
    for (const menu of show.mock.instances as Menu[]) originalHide.call(menu)
    show.mockRestore()
    hide.mockRestore()
    vi.useRealTimers()
  }
})

it.each([true, false])('names the record point in its enable action (%s)', (enabled) => {
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const binding = {
    trace: { pointAt: () => ({ id: 'sample-point' }) },
    controller: {
      current: true,
      knownBreakpoints: () => [{ id: 'sample-point', sourceId: 'sample-source', line: 1, enabled }],
    },
  } as unknown as DebuggerBinding
  try {
    marginMenu(binding, 'sample-source', 1, new MouseEvent('contextmenu', { clientX: 1 }))
    const menu = show.mock.instances.at(-1) as Menu
    expect(menu.items.map((item) => item.title)).toContain(
      enabled ? 'Disable record point' : 'Enable record point'
    )
  } finally {
    show.mockRestore()
  }
})

it('excludes locals from a callback that has ended', () => {
  const text = `function total(items) {
  const rate = 2
  const amounts = items.map((entry) => {
    const lineTotal = entry.price * rate
    return lineTotal
  })
  const surge = rate + 1
  return amounts.length + surge
}`
  const names = namesOnLine(text, 8)
  expect(names).toEqual(expect.arrayContaining(['rate', 'surge', 'amounts', 'items']))
  expect(names).not.toContain('entry')
  expect(names).not.toContain('lineTotal')
  expect(namesOnLine(text, 5)).toEqual(expect.arrayContaining(['entry', 'lineTotal', 'rate']))
})

it('offers declarations immediately above the selected line', () => {
  const text =
    'const rate = lookup(quote)\nconst surge = rate * 2\nconst deliveryFee = surge + 5\nreturn quote.total'
  expect(namesOnLine(text, 4)).toEqual(expect.arrayContaining(['rate', 'surge', 'deliveryFee']))
})

it('edits the margin point at its original requested line after relocation', async () => {
  const save = vi.fn(async () => ({ pending: false }))
  const binding = {
    trace: { savePoint: save },
    controller: {
      knownBreakpoints: () => [{ sourceId: 'sample-source', line: 7, requestedLine: 6 }],
    },
  } as unknown as DebuggerBinding
  await savePoint(binding, 'sample-source', 7, { take: ['cart'] })
  expect(save).toHaveBeenCalledWith('sample-source', 6, { take: ['cart'] })
})
