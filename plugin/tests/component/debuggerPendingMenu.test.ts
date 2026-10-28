import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import { DebuggerService } from '@/debugger/DebuggerService'

vi.mock('@/components/nodeWork/FileView.vue', () => ({
  default: { template: '<div><slot name="code" /></div>' },
}))

it('opens a populated pending menu on markers and line numbers without a session', async () => {
  const service = DebuggerService.instance
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    kind: 'folder',
    id: 'sample-folder',
  }
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const wrapper = mount(NodePathFilePane, {
    attachTo: document.body,
    props: {
      model: {
        target,
        busy: ref(false),
        error: ref(''),
        mode: ref('file'),
        document: ref({ target, path: 'sample.js', text: 'const sample = 1' }),
      } as never,
    },
  })
  try {
    await flushPromises()
    const initialMarker = wrapper.get('button.abele-debug-source__point').element
    for (const pending of [false, true]) {
      if (pending) service.togglePendingBreakpoint(target as never, 'sample.js', 1)
      await flushPromises()
      if (pending) expect(initialMarker.isConnected).toBe(false)
      for (const selector of [
        'button.abele-debug-source__point',
        '.cm-lineNumbers .cm-gutterElement',
      ]) {
        const control = wrapper
          .findAll(selector)
          .find((element) => (element.element as HTMLElement).style.visibility !== 'hidden')!
        await control.trigger('contextmenu', { clientX: 480, clientY: 320 })
        expect(show).toHaveBeenLastCalledWith(
          expect.objectContaining({ clientX: 480, clientY: 320 })
        )
        const menu = show.mock.instances.at(-1) as Menu
        const titles = menu.items.map((item) => item.title)
        expect(titles).toContain('Add record point')
        expect(titles).toContain(pending ? 'Remove breakpoint' : 'Add breakpoint')
        if (pending)
          expect(titles).toEqual(
            expect.arrayContaining(['Edit condition', 'Hit count', 'Disable breakpoint'])
          )
      }
    }
  } finally {
    wrapper.unmount()
    if (service.pendingBreakpoints(target as never, 'sample.js').includes(1))
      service.togglePendingBreakpoint(target as never, 'sample.js', 1)
    show.mockRestore()
  }
})
