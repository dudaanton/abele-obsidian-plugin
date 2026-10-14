import ScrollMore from '@/components/obsidian/ScrollMore.vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import FindAndReplaceBases from '@/components/FindAndReplaceBases.vue'
import FindAndReplaceModal from '@/components/FindAndReplaceModal.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault } from '../helpers/fakeVault'

const wrappers: VueWrapper[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

for (const [name, component, prefix] of [
  ['bases', FindAndReplaceBases, 'abele-far-bases'],
  ['modal', FindAndReplaceModal, 'abele-sar-fm-modal'],
] as const) {
  describe(`Replacement paging in ${name}`, () => {
    it('makes every preview reachable beyond fifty and resets paging on a fresh preview', async () => {
      const app = buildFakeVault(
        Array.from({ length: 63 }, (_, i) => ({
          path: `sample-${String(i).padStart(2, '0')}.md`,
          raw: 'Sample body',
        }))
      )
      ;(GlobalStore.getInstance() as any)._app = app
      const wrapper = mount(component as any, {
        props: name === 'bases' ? { files: ref(app.vault.getMarkdownFiles()) } : {},
        global: {
          stubs: {
            ObsidianModal: { template: '<div><slot /></div>' },
            Diff: true,
            ReplacementActionView: true,
            CriterionView: true,
          },
        },
      })
      wrappers.push(wrapper)
      const preview = () =>
        (wrapper.vm as any).$.setupState[name === 'bases' ? 'preview' : 'search']()
      await flushPromises()
      if (name === 'modal') await preview()
      const rows = () => wrapper.findAll(`.${prefix}__result`)
      expect(rows().length).toBeLessThan(63)
      while (rows().length < 63) {
        // The end of the list asks for more as it scrolls into view.
        const more = wrapper.findComponent(ScrollMore)
        expect(more.exists(), 'Remaining previews must load as the list scrolls').toBe(true)
        more.vm.$emit('more')
        await flushPromises()
      }
      expect(rows().map((row) => row.find('a').attributes('title'))).toEqual(
        app.vault.getMarkdownFiles().map((file) => file.path)
      )
      expect(wrapper.findComponent(ScrollMore).exists()).toBe(false)
      await preview()
      await flushPromises()
      expect(rows().length).toBeLessThan(63)
    })
  })
}
