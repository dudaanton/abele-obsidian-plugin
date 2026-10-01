import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import FindAndReplaceModal from '@/components/FindAndReplaceModal.vue'
import FindAndReplaceBases from '@/components/FindAndReplaceBases.vue'
import { ReplacementAction } from '@/entities/ReplacementAction'
import { buildFakeVault } from '../helpers/fakeVault'
import { GlobalStore } from '@/stores/GlobalStore'
import * as vaultUtils from '@/helpers/vaultUtils'
import * as obsidian from 'obsidian'
import { dump } from 'js-yaml'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})
const action = (fields: Partial<ReplacementAction>) =>
  Object.assign(new ReplacementAction(), fields)

for (const [name, component] of [
  ['modal', FindAndReplaceModal],
  ['bases', FindAndReplaceBases],
] as const) {
  describe(`Find & Replace ${name}`, () => {
    async function open(raw = '---\nlabel: old\nkeep: value\n---\n\nold body\n') {
      const app = buildFakeVault([
        { path: 'sample-note.md', raw, frontmatter: { label: 'old', keep: 'value' } },
      ])
      ;(GlobalStore.getInstance() as any)._app = app
      vi.spyOn(vaultUtils, 'getEditorForFile').mockReturnValue(null)
      // The shared host stub serializes JSON; this contract also pins actual YAML output.
      vi.spyOn(obsidian, 'stringifyYaml').mockImplementation((value) => dump(value))
      const file = app.vault.getMarkdownFiles()[0]
      const wrapper = mount(component as any, {
        shallow: true,
        props: name === 'bases' ? { files: ref([file]) } : {},
        global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
      })
      wrappers.push(wrapper)
      await flushPromises()
      const state = (wrapper.vm as any).$.setupState
      const preview = async (actions: ReplacementAction[]) => {
        state.replacements = actions
        await (name === 'bases' ? state.preview() : state.search())
        return state.searchResults[0]
      }
      return { app, file, state, preview }
    }

    // BUG: two competing writes can overwrite each other, and frontmatter is not awaited.
    it('commits property and body replacements as one awaited file write', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([
        action({ property: 'label', value: 'new' }),
        action({ type: 'replace-in-content', oldValue: 'old', value: 'new' }),
      ])
      app.resetStats()
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toMatch(/label: new/)
      expect(await app.vault.read(file)).toMatch(/keep: value/)
      expect(await app.vault.read(file)).toMatch(/---\n\nnew body\n$/)
      expect(app.stats.modify).toBe(1)
      expect(result.oldRaw).toBe(result.newRaw)
    })

    // BUG: previewed content is written over changes made while the preview is open.
    it('skips a note edited after preview and leaves it available for a fresh search', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([action({ property: 'label', value: 'new' })])
      const changed = '---\nlabel: edited\n---\nNew unsaved work persisted\n'
      await (app.vault as any).modify(file, changed)
      const before = result.oldRaw
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toBe(changed)
      expect(result.oldRaw).toBe(before)
      expect(result.error).toMatch(/changed/i)
    })

    // BUG: rename is fire-and-forget and the preview claims success before it completes.
    it('does not mark the preview applied until the rename completes', async () => {
      const { app, state, preview } = await open()
      const result = await preview([action({ type: 'move', directory: 'sample-folder' })])
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const rename = vi.spyOn(app.fileManager as any, 'renameFile').mockImplementation(() => gate)
      let completed = false
      const applying = state.replaceOne(result).then(() => {
        completed = true
      })
      try {
        await flushPromises()
        expect(rename).toHaveBeenCalledOnce()
        expect(completed).toBe(false)
        expect(result.oldPath).toBe('sample-note.md')
      } finally {
        release()
        await applying
      }
      expect(result.oldPath).toBe('sample-folder/sample-note.md')
    })

    it('waits for the combined write and reports a rejected write without claiming success', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([action({ property: 'label', value: 'new' })])
      const before = await app.vault.read(file)
      let reject!: (error: Error) => void
      const gate = new Promise<string>((_, fail) => {
        reject = fail
      })
      vi.spyOn(app.vault as any, 'process').mockImplementation(() => gate)
      let done = false
      const applying = state.replaceOne(result).then(() => {
        done = true
      })
      try {
        await flushPromises()
        expect(done).toBe(false)
        expect(result.oldRaw).not.toBe(result.newRaw)
      } finally {
        reject(new Error('sample write failed'))
        await applying
      }
      expect(result.error).toBe('sample write failed')
      expect(await app.vault.read(file)).toBe(before)
    })

    it('does not overwrite an open editor with unsaved changes', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([action({ property: 'label', value: 'new' })])
      const before = await app.vault.read(file)
      const editor = { getValue: () => before + 'Unsaved typing', setValue: vi.fn() }
      vi.mocked(vaultUtils.getEditorForFile).mockReturnValue(editor as any)
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toBe(before)
      expect(editor.setValue).not.toHaveBeenCalled()
      expect(result.error).toMatch(/changed/i)
    })

    it('reads preview properties from the same text as the body, not stale cached frontmatter', async () => {
      const { app, file, state, preview } = await open('---\nlabel: fresh\n---\nFresh body\n')
      const result = await preview([action({ property: 'added', value: 'yes' })])
      expect(result.oldFrontmatter).toEqual({ label: 'fresh' })
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toContain('label: fresh')
      expect(await app.vault.read(file)).not.toContain('keep:')
    })

    it('checks destination collisions before writing any changes', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([
        action({ property: 'label', value: 'new' }),
        action({ type: 'move', directory: 'sample-folder' }),
      ])
      await (app.vault as any).create('sample-folder/sample-note.md', 'Other note')
      const before = await app.vault.read(file)
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toBe(before)
      expect(result.error).toMatch(/already exists/)
    })

    it('preserves frontmatter formatting for body-only edits and does not rewrite an applied result', async () => {
      const raw = '---\r\n# sample comment\r\nlabel: "old"\r\n---\r\n\r\nold body'
      const { app, file, state, preview } = await open(raw)
      const result = await preview([
        action({ type: 'replace-in-content', oldValue: 'old', value: 'new' }),
      ])
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toBe(raw.replace('old body', 'new body'))
      app.resetStats()
      await state.replaceOne(result)
      expect(app.stats.modify).toBe(0)
    })

    it('applies replacements in order and preserves body when only properties change', async () => {
      const { app, file, state, preview } = await open()
      const result = await preview([
        action({ property: 'label', value: 'intermediate' }),
        action({
          type: 'replace-in-property',
          property: 'label',
          oldValue: 'intermediate',
          value: 'final',
        }),
        action({ type: 'remove-property', property: 'keep' }),
      ])
      expect(result.newFrontmatter).toEqual({ label: 'final' })
      await state.replaceOne(result)
      expect(await app.vault.read(file)).toMatch(/label: final/)
      expect(await app.vault.read(file)).not.toContain('keep:')
      expect(await app.vault.read(file)).toMatch(/---\n\nold body\n$/)
    })
  })
}
