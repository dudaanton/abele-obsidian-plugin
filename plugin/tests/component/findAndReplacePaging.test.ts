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
        const more = wrapper.findAll('button').find((button) => button.text() === 'Load more')
        expect(more, 'Remaining previews must have a paging control').toBeDefined()
        await more!.trigger('click')
      }
      expect(rows().map((row) => row.find('a').text())).toEqual(
        app.vault.getMarkdownFiles().map((file) => file.path)
      )
      expect(wrapper.findAll('button').some((button) => button.text() === 'Load more')).toBe(false)
      await preview()
      await flushPromises()
      expect(rows().length).toBeLessThan(63)
    })
  })
}
