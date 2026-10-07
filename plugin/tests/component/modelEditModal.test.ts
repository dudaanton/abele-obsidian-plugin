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
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
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
  ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
  Dropdown: { props: ['modelValue', 'options'], template: '<div class="dropdown-stub" />' },
}

describe('per-model request timeout', () => {
  it.each([undefined, 180])(
    'opens with saved timeout %s and only commits changes on Save',
    async (initial) => {
      const view = mount(ModelEditModal, {
        props: { model: { ...model, requestTimeoutSeconds: initial } },
        global: { stubs: STUBS },
      })
      try {
        const setting = view
          .findAllComponents(Setting)
          .find((item) => item.props('name') === 'Request timeout (seconds)')!
        expect(setting).toBeDefined()
        const input = setting.findComponent(Input)
        expect(input.props('modelValue')).toBe(initial === undefined ? '' : String(initial))
        for (const value of ['1', '3600', '180', '500']) {
          await input.find('input').setValue(value)
          expect((input.find('input').element as HTMLInputElement).value).toBe(value)
        }
        const save = view
          .findAllComponents(Button)
          .find((button) => button.props('text') === 'Save')!
        for (const value of ['5000', '0', '-1', '0.5', '3601', 'Infinity', 'not a number']) {
          await input.find('input').setValue(value)
          expect((input.find('input').element as HTMLInputElement).value).toBe(value)
          expect(setting.find('[role="alert"]').text()).toContain('1–3600')
          expect(input.find('input').attributes('aria-invalid')).toBe('true')
          expect(save.props('disabled')).toBe(true)
          await save.find('button').trigger('click')
          expect(view.emitted('save')).toBeUndefined()
        }
        await input.find('input').setValue('180')
        expect(setting.find('[role="alert"]').exists()).toBe(false)
        expect(save.props('disabled')).toBe(false)
        expect(view.emitted('save')).toBeUndefined()
        expect(view.props('model').requestTimeoutSeconds).toBe(initial)
        await view
          .findAllComponents(Button)
          .find((button) => button.props('text') === 'Save')!
          .vm.$emit('click')
        expect(view.emitted('save')?.[0]?.[0]).toMatchObject({
          ...model,
          requestTimeoutSeconds: 180,
        })
      } finally {
        view.unmount()
      }
    }
  )

  it('clears the override rather than saving a copy of the global timeout', async () => {
    const view = mount(ModelEditModal, {
      props: { model: { ...model, requestTimeoutSeconds: 180 } },
      global: { stubs: STUBS },
    })
    try {
      const setting = view
        .findAllComponents(Setting)
        .find((item) => item.props('name') === 'Request timeout (seconds)')!
      expect(setting).toBeDefined()
      const input = setting.findComponent(Input)
      await input.find('input').setValue(' ')
      expect(input.props('modelValue')).toBe('')
      await view
        .findAllComponents(Button)
        .find((button) => button.props('text') === 'Save')!
        .vm.$emit('click')
      expect(
        (view.emitted('save')?.[0]?.[0] as AiModelConfig).requestTimeoutSeconds
      ).toBeUndefined()
    } finally {
      view.unmount()
    }
  })
})

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
