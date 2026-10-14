import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Menu } from 'obsidian'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'

let wrapper: VueWrapper | undefined
let menu: Menu | undefined
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

async function open(onAction: () => void = () => {}, focusTrigger = true) {
  const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
  wrapper = mount(SheetHeaderActions, {
    attachTo: document.body,
    props: { actions: [{ id: 'find', label: 'Find in this chat' }], onAction },
  })
  const trigger = wrapper.get('button').element as HTMLButtonElement
  if (focusTrigger) trigger.focus()
  await wrapper.get('button').trigger('click')
  menu = shown.mock.instances.at(-1)!
  menu.unload = vi.fn()
  return trigger
}

it('does not steal focus from the field an action opens when the menu finishes hiding', async () => {
  const field = document.createElement('input')
  document.body.appendChild(field)
  await open(() => field.focus())
  const items = (menu as unknown as { items: { handler: () => void }[] }).items
  items[0].handler()
  expect(document.activeElement).toBe(field)
  menu!.hide()
  expect(document.activeElement).toBe(field)
})

it('returns focus after an action when a programmatic click left the earlier control focused', async () => {
  const previous = document.createElement('button')
  document.body.appendChild(previous)
  previous.focus()
  const trigger = await open(() => {}, false)
  const items = (menu as unknown as { items: { handler: () => void }[] }).items
  items[0].handler()
  menu!.hide()
  expect(document.activeElement).toBe(trigger)
})

it('does not steal focus when an action deliberately focuses the control that opened the menu', async () => {
  const previous = document.createElement('input')
  document.body.appendChild(previous)
  previous.focus()
  await open(() => previous.focus(), false)
  const popup = document.createElement('button')
  document.body.appendChild(popup)
  popup.focus()
  const items = (menu as unknown as { items: { handler: () => void }[] }).items
  items[0].handler()
  menu!.hide()
  expect(document.activeElement).toBe(previous)
})

it('returns focus to the trigger when dismissal leaves focus on the page', async () => {
  const trigger = await open()
  trigger.blur()
  menu!.hide()
  expect(document.activeElement).toBe(trigger)
})

it('returns focus to the trigger when dismissal leaves focus in the menu', async () => {
  const trigger = await open()
  const popup = document.createElement('div')
  popup.className = 'menu'
  const item = document.createElement('button')
  popup.appendChild(item)
  document.body.appendChild(popup)
  item.focus()
  menu!.hide()
  expect(document.activeElement).toBe(trigger)
})

it('keeps unsectioned actions in their place instead of letting Obsidian move them below every section', async () => {
  // Obsidian's menu draws named sections in order of first appearance and puts items with no
  // section after all of them, glued to the last group: a destructive item ended up mid-list.
  const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
  wrapper = mount(SheetHeaderActions, {
    attachTo: document.body,
    props: {
      actions: [
        { id: 'find', label: 'Find' },
        { id: 'reload', label: 'Reload', section: 'file' },
        { id: 'delete', label: 'Delete', section: 'danger', warning: true },
      ],
    },
  })
  await wrapper.get('button').trigger('click')
  menu = shown.mock.instances.at(-1)!
  menu.unload = vi.fn()
  const sections = (menu as unknown as { items: { section: string }[] }).items.map(
    (item) => item.section
  )
  expect(sections.every(Boolean)).toBe(true)
  expect([...new Set(sections)]).toEqual([sections[0], 'file', 'danger'])
})
