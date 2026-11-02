import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SelectPropertyModal from '@/components/properties/SelectPropertyModal.vue'
import SelectPropertiesSettings from '@/components/settings/SelectPropertiesSettings.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import type { SelectProperty } from '@/properties/select'
import { configureAbele, useVault } from '../helpers/testEnv'

const modal = { template: '<div><slot /><slot name="footer" /></div>' }
let view: ReturnType<typeof mount>
const property: SelectProperty = {
  key: 'stage',
  multiple: false,
  options: [{ value: 'Ready' }, { value: 'Waiting' }],
}
beforeEach(() => {
  useVault([])
  configureAbele()
})
afterEach(() => {
  view?.unmount()
  vi.restoreAllMocks()
})
function edit() {
  view = mount(SelectPropertyModal, {
    props: { property, taken: [], uses: (value: string) => (value === 'Ready' ? 3 : 0), openAt: 0 },
    global: { stubs: { Modal: modal } },
  })
  return view
}
it('saves a detached draft only on Done, trimming newly edited names', async () => {
  edit()
  await view.findAllComponents(Input)[1].vm.$emit('update:model-value', ' Complete ')
  expect(property.options[0].value).toBe('Ready')
  expect(view.emitted('save')).toBeUndefined()
  const done = view.findAllComponents(Button).find((b) => b.props('accent'))!
  await done.trigger('click')
  expect(view.emitted('save')?.[0]).toEqual([
    { ...property, options: [{ value: 'Complete' }, { value: 'Waiting' }] },
  ])
})
it('does not offer a destructive rename to an invalid duplicate or blank option', async () => {
  edit()
  await view.findAllComponents(Input)[1].vm.$emit('update:model-value', 'Waiting')
  expect(view.find('.abele-select-property__stale a').exists()).toBe(false)
  await view.findAllComponents(Input)[1].vm.$emit('update:model-value', '   ')
  expect(view.find('.abele-select-property__stale a').exists()).toBe(false)
})
it('explicit rename emits a trimmed value, not an automatic note change on editing', async () => {
  edit()
  await view.findAllComponents(Input)[1].vm.$emit('update:model-value', ' Complete ')
  expect(view.emitted('rename')).toBeUndefined()
  await view.get('.abele-select-property__stale a').trigger('click')
  expect(view.emitted('rename')?.[0]).toEqual(['Ready', 'Complete'])
})
it('asks before removing a used option and reports use of its original name', async () => {
  edit()
  await view.findAllComponents(Input)[1].vm.$emit('update:model-value', 'Complete')
  await view.get('.abele-select-property__row .clickable-icon:last-child').trigger('click')
  const confirm = view.findComponent(ConfirmModal)
  expect(confirm.exists()).toBe(true)
  expect(confirm.props('message')).toContain('3')
  await confirm.vm.$emit('confirm')
  expect(view.findAll('.abele-select-property__option')).toHaveLength(1)
  expect(property.options).toHaveLength(2)
})
it('settings emits the saved list and leaves unrelated properties untouched', async () => {
  view = mount(SelectPropertiesSettings, {
    props: { modelValue: [property], uses: () => 0, initialEdit: { property: 0 } },
    global: { stubs: { SelectPropertyModal: true } },
  })
  const edited = { ...property, multiple: true }
  await view.findComponent(SelectPropertyModal).vm.$emit('save', edited)
  expect(view.emitted('update:modelValue')?.[0]).toEqual([[edited]])
  expect(property.multiple).toBe(false)
})
