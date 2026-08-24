/**
 * The model editors, which are the other place something can be destroyed.
 *
 * The delete button asks first, and the parent screen hears about it only once the question
 * has been answered — otherwise a mis-click removes a model from a provider silently.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelEditModal from '@/components/settings/ModelEditModal.vue'
import ImageModelEditModal from '@/components/settings/ImageModelEditModal.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Button from '@/components/obsidian/Button.vue'
import type { AiModelConfig, ImageModelConfig2 } from '@/ai/types'

const model: AiModelConfig = {
  id: 'big',
  name: 'Big',
  contextWindow: 100,
  maxTokens: 10,
  supportsReasoning: false,
}

const imageModel: ImageModelConfig2 = {
  id: 'gpt-image',
  name: 'Image',
  size: '1024x1024',
  outputFormat: 'png',
  quality: 'high',
}

const STUBS = {
  ObsidianModal: { template: '<div><slot /></div>' },
  Dropdown: { props: ['modelValue', 'options'], template: '<div class="dropdown-stub" />' },
}

const editors = [
  { name: 'the model editor', component: ModelEditModal, props: { model } },
  { name: 'the image model editor', component: ImageModelEditModal, props: { model: imageModel } },
]

for (const editor of editors) {
  describe(editor.name, () => {
    const open = () =>
      mount(editor.component, {
        props: editor.props as never,
        global: { stubs: STUBS },
      })

    const deleteButton = (view: ReturnType<typeof open>) =>
      view.findAllComponents(Button).find((b) => b.props('text') === 'Delete')

    it('marks deletion as destructive', () => {
      expect(deleteButton(open())?.props('warning')).toBe(true)
    })

    it('asks before telling anyone to delete', async () => {
      const view = open()

      await deleteButton(view)?.vm.$emit('click')

      expect(view.emitted('delete')).toBeUndefined()
      expect(view.findComponent(ConfirmModal).exists()).toBe(true)
    })

    it('deletes once the question is answered', async () => {
      const view = open()
      await deleteButton(view)?.vm.$emit('click')

      await view.findComponent(ConfirmModal).vm.$emit('confirm')

      expect(view.emitted('delete')).toHaveLength(1)
      expect(view.emitted('close')).toHaveLength(1)
    })

    it('keeps the model when the question is dismissed', async () => {
      const view = open()
      await deleteButton(view)?.vm.$emit('click')

      await view.findComponent(ConfirmModal).vm.$emit('close')

      expect(view.emitted('delete')).toBeUndefined()
      expect(view.findComponent(ConfirmModal).exists()).toBe(false)
    })

    it('offers no deletion for a model that does not exist yet', () => {
      const view = mount(editor.component, {
        props: { ...editor.props, isNew: true } as never,
        global: { stubs: STUBS },
      })

      expect(deleteButton(view)).toBeUndefined()
    })
  })
}
