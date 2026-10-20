import { expect, it, vi } from 'vitest'
import { Menu } from 'obsidian'
import { marginMenu } from '@/debugger/trace/panel'
import { promptDialog } from '@/components/obsidian/dialogs'
vi.mock('@/components/obsidian/dialogs', () => ({
  promptDialog: vi.fn(async () => '3'),
  confirmDialog: vi.fn(),
}))

it.each([false, true])(
  'offers the hit-count editor only with negotiated support: %s',
  async (supported) => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const edit = vi.fn(async () => {})
    marginMenu(
      {
        controller: {
          current: true,
          supportsHitCondition: supported,
          knownBreakpoints: () => [
            {
              id: 'sample-point',
              sourceId: 'sample-source',
              line: 8,
              enabled: true,
              hit_condition: '2',
            },
          ],
          editBreakpoint: edit,
        },
      } as never,
      'sample-source',
      8,
      new MouseEvent('contextmenu', { clientX: 180, clientY: 320 })
    )
    const menu = show.mock.instances[0] as Menu
    const item = menu.items.find((i) => i.title === 'Hit count')
    if (supported) {
      expect(item).toBeDefined()
      await item!.handler!()
      expect(promptDialog).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Hit count', value: '2' })
      )
      expect(edit).toHaveBeenCalledWith('sample-point', { hit_condition: '3' })
    } else {
      expect(item).toBeUndefined()
      expect(menu.items.some((i) => i.title === 'Hit count is not supported by this node')).toBe(
        true
      )
    }
    show.mockRestore()
  }
)

it.each([false, true])('anchors a keyboard or synthetic menu click to its control: %s', (phone) => {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const target = document.createElement('button')
  target.getBoundingClientRect = () => ({ left: phone ? 24 : 680, bottom: 240 }) as DOMRect
  const event = new MouseEvent('click')
  Object.defineProperty(event, 'currentTarget', { value: target })
  marginMenu(
    { controller: { knownBreakpoints: () => [], current: true } } as never,
    'sample-source',
    8,
    event
  )
  expect(show).toHaveBeenCalledWith({ x: phone ? 24 : 680, y: 240 })
  show.mockRestore()
})

it('keeps actual gutter pointer coordinates', () => {
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const event = new MouseEvent('contextmenu', { clientX: 180, clientY: 320 })
  marginMenu(
    { controller: { knownBreakpoints: () => [], current: true } } as never,
    'sample-source',
    8,
    event
  )
  expect(show).toHaveBeenCalledWith(event)
  show.mockRestore()
})
