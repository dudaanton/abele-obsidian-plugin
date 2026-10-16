import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { openNodeFolderPicker } from '@/node/NodePathDialogs'

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: { containerEl: document.body } } }) },
}))
afterEach(() => {
  document.body.innerHTML = ''
})

it('says the node is not connected instead of doing nothing when Open is pressed', async () => {
  const register = vi.fn()
  const connection = {
    state: ref('connected'),
    client: {
      store: { transaction: async (run: (raw: object) => unknown) => run({}) },
      nodePath: {
        register,
        directories: vi.fn(async (params: { path?: string }) => ({
          directory_id: 'sample-directory',
          path: params.path ?? '/sample',
          entries: [
            { name: 'sample-folder', path: '/sample/sample-folder', directory_id: 'sample-folder-id' },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })),
      },
    },
  }
  const model = { capabilities: ref(['node_path_v2']), folders: ref([]) }
  await openNodeFolderPicker(model as never, connection as never)
  await flushPromises()
  connection.state.value = 'offline'
  const field = document.querySelector('.abele-folder-picker input') as HTMLInputElement
  field.value = '/sample/sample-folder'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  const open = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Open')!
  open.click()
  await flushPromises()
  expect(register).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('not connected')
})
