import { expect, it, vi } from 'vitest'
import { savePoint, namesOnLine, marginMenu } from '@/debugger/trace/panel'
import { Menu } from 'obsidian'
import type { DebuggerBinding } from '@/debugger/DebuggerService'

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
