import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import SharePicker from '@/components/sync/SharePicker.vue'
import DeviceScopeField from '@/components/sync/DeviceScopeField.vue'

afterEach(() => {
  Platform.isPhone = false
})

it.each(['narrowing', 'widening'] as const)(
  'offers the capture folder for phone %s',
  async (mode) => {
    Platform.isPhone = true
    const vault = { kind: 'vault' as const, id: 'sample-vault', path: '/' }
    const first = {
      kind: 'folder' as const,
      id: 'sample-first',
      path: 'Sample collection/Long descriptive parent/Example item 01',
    }
    const next = {
      ...first,
      id: 'sample-next',
      path: 'Sample collection/Long descriptive parent/Example item 04',
    }
    const selected = mode === 'narrowing' ? [vault] : [first]
    const target = mode === 'narrowing' ? first : next
    const wrapper = mount(DeviceScopeField, {
      attachTo: document.body,
      props: { modelValue: selected, choices: [vault, first, next], saved: selected },
    })
    try {
      await wrapper.find('input').trigger('focusin')
      await wrapper.find('input').setValue(target.path)
      const row = wrapper
        .findAll('.suggestion-item')
        .find((item) => item.attributes('data-share-path') === target.path)!
      expect(row.exists()).toBe(true)
      expect(row.attributes('aria-disabled')).toBe('false')
      await row.trigger('click')
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
        mode === 'narrowing' ? [target] : [first, target],
      ])
    } finally {
      wrapper.unmount()
    }
  }
)

it('switches local choices by kind on the phone and replaces the whole-vault default', async () => {
  Platform.isPhone = true
  const vault = { id: 'vault', kind: 'vault' as const, path: '/' }
  const group = { id: 'group-a', kind: 'group' as const, path: 'Reading.md' }
  const wrapper = mount(SharePicker, {
    attachTo: document.body,
    props: {
      modelValue: [vault],
      choices: [vault, group],
      vaultGivesWay: true,
      members: () => 0,
    },
  })
  try {
    await wrapper.find('input').trigger('focusin')
    expect(wrapper.find('[data-share-kind="group"]').exists()).toBe(false)
    const toggle = wrapper.findAll('.abele-share-picker__kinds .clickable-icon')[1]
    ;(toggle.element as HTMLButtonElement).focus()
    await toggle.trigger('click')
    expect(document.activeElement).toBe(wrapper.find('input').element)
    expect(wrapper.text()).toContain('no notes yet')
    await wrapper.find('[data-share-kind="group"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[group]])
  } finally {
    wrapper.unmount()
  }
})
