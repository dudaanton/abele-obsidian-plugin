import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SelectionToolbar from '@/components/obsidian/SelectionToolbar.vue'

it('teleports selection actions outside a clipping pane and preserves the selection on pointerdown', async () => {
  const view = mount(SelectionToolbar, {
    props: { top: 100, left: 20 },
    slots: { default: '<button>Quote</button>' },
  })
  await nextTick()
  const toolbar = document.body.querySelector<HTMLElement>('.abele-selection-toolbar')!
  expect(toolbar.getAttribute('role')).toBe('toolbar')
  expect(toolbar.style.top).toBe('100px')
  expect(toolbar.style.left).toBe('20px')
  const event = new Event('pointerdown', { cancelable: true, bubbles: true })
  toolbar.querySelector('button')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  view.unmount()
  expect(document.body.querySelector('.abele-selection-toolbar')).toBeNull()
})
