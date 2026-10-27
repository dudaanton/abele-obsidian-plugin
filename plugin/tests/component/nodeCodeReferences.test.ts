import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import { NODE_CODE_LINK_OPENER } from '@/node/codeLinkContext'
import { resolveNodeCodeLink } from '@/node/codeLinks'
import { useVault } from '../helpers/testEnv'
import { untrustedGuard } from '@/markdown/renderUntrusted'
import { ref } from 'vue'
import { ZWSP } from '@/markdown/untrustedCode'

const target = {
  nodeId: 'node',
  registrationId: 'registration',
  projectId: 'project',
  kind: 'worktree' as const,
  id: 'tree',
}
afterEach(() => vi.restoreAllMocks())
it('renders saved code references as internal links and routes taps with their ranges', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.innerHTML =
      '<p><a class="external-link" href="src/sample.ts#L3-L7">Sample</a> <code></code> <a href="/outside/secret.ts:4">Private</a></p>'
    el.querySelector('code')!.textContent = ZWSP + 'src/other.ts'
    untrustedGuard(el, {} as never)
  })
  const open = Object.assign(vi.fn(), {
    active: () => true,
    canOpen: (path: string) => !!resolveNodeCodeLink(path, target, '/sample/tree'),
  })
  const view = mount(Markdown, {
    props: { text: 'saved answer' },
    global: { provide: { [NODE_CODE_LINK_OPENER as symbol]: open } },
  })
  await flushPromises()
  expect(view.findAll('a.internal-link')).toHaveLength(2)
  expect(view.find('.external-link').exists()).toBe(false)
  expect(view.findAll('a').map((a) => a.text())).toEqual(['Sample', 'src/other.ts'])
  await view.find('a').trigger('click')
  expect(open).toHaveBeenCalledWith('src/sample.ts#L3-L7')
  expect(resolveNodeCodeLink(open.mock.calls[0][0], target)).toMatchObject({ line: 3, endLine: 7 })
  view.unmount()
})

it('resolves saved references again when node folder metadata arrives', async () => {
  useVault([])
  const ready = ref(false)
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.innerHTML = '<a href="/sample/tree/src/sample.ts:3">Sample</a>'
    untrustedGuard(el, {} as never)
  })
  const open = Object.assign(vi.fn(), { context: () => ready.value, canOpen: () => ready.value })
  const view = mount(Markdown, { props: { text: 'saved answer', resourceOpener: open } })
  await flushPromises()
  expect(view.find('a').exists()).toBe(false)
  ready.value = true
  await vi.waitFor(() => expect(view.find('a.internal-link').exists()).toBe(true))
  view.unmount()
})
