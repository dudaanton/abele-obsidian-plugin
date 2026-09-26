/**
 * The sidebars stay alive whatever a note widget does.
 *
 * Every sidebar panel and every note widget used to be a Teleport in the one `Views.vue`, and a
 * note widget found its element by a selector. At startup the editor builds its widgets before
 * its leaf is in the document, so the selector found nothing: the Teleport was kept with no
 * target and its component never made. The next change to any list in `Views.vue` patched that
 * missing component and threw — every time from then on, and quietly, because the error is one
 * the app's error handler files under Teleport clean-up. A sidebar opened after that (a tab in
 * the sidebar is only loaded when it is first shown) stayed blank, and so did every widget.
 */
import { it, expect, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import Views from '@/components/Views.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { HeaderWidget } from '@/editor/HeaderWidget'
import { registerPanelElement, forgetPanel } from '@/views/panelVisibility'
import { useVault } from '../helpers/testEnv'

const stub = (cls: string) => defineComponent({ setup: () => () => h('i', { class: cls }) })

let wrapper: VueWrapper | null = null
const errors: string[] = []

beforeEach(() => {
  useVault([{ path: 'Notes/A.md', content: '' }])
  errors.length = 0
  wrapper = mount(Views, {
    attachTo: document.body,
    global: {
      stubs: { HeaderView: stub('stub-header'), TodoSidebarView: stub('stub-todo') },
      config: {
        errorHandler: (e) => void errors.push((e as Error).message),
        warnHandler: () => {},
      },
    },
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  const store = GlobalStore.getInstance()
  store.headersContainers.value = []
  store.todoSidebarIds.value = []
  forgetPanel('panel-1')
  document.body.replaceChildren()
})

it('draws a widget built before its editor is in the document, and the panels after it', async () => {
  const store = GlobalStore.getInstance()

  // Built while detached, the way an editor restored at startup builds it.
  const early = new HeaderWidget('Notes/A.md').toDOM()
  await flushPromises()
  // Then CodeMirror puts it into the page, and another note's header comes along.
  document.body.appendChild(early)
  const later = new HeaderWidget('Notes/A.md').toDOM()
  document.body.appendChild(later)
  await flushPromises()

  // A sidebar tab shown for the first time after all that.
  const panel = document.createElement('div')
  document.body.appendChild(panel)
  registerPanelElement('panel-1', panel)
  store.todoSidebarIds.value = ['panel-1']
  await flushPromises()

  expect(errors).toEqual([])
  expect(panel.querySelector('.stub-todo')).not.toBeNull()
  expect(early.querySelector('.stub-header')).not.toBeNull()
  expect(later.querySelector('.stub-header')).not.toBeNull()
})

it('keeps the panels drawing even if a note widget fails to draw', async () => {
  const store = GlobalStore.getInstance()
  // An entry nobody made an element for — whatever the reason, it must stay its own problem.
  store.headersContainers.value.push({ id: 'orphan', cleanup() {} } as never)
  await flushPromises()
  store.headersContainers.value.push({ id: 'orphan-2', cleanup() {} } as never)
  await flushPromises()

  const panel = document.createElement('div')
  document.body.appendChild(panel)
  registerPanelElement('panel-1', panel)
  store.todoSidebarIds.value = ['panel-1']
  await flushPromises()

  expect(panel.querySelector('.stub-todo')).not.toBeNull()
})
