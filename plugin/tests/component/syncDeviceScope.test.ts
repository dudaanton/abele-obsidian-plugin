import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Platform } from 'obsidian'
import SharePicker from '@/components/sync/SharePicker.vue'

afterEach(() => {
  Platform.isPhone = false
})

// BUG: the approved device-scope picker is not wired until remote group discovery is available.
it.fails(
  'switches local choices by kind on the phone and replaces the whole-vault default',
  async () => {
    Platform.isPhone = true
    const vault = { id: 'vault', kind: 'vault' as const, path: '/' }
    const group = { id: 'group-a', kind: 'group' as const, path: 'Reading.md' }
    const wrapper = mount(SharePicker, {
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
      await wrapper.findAll('.abele-share-picker__kinds .clickable-icon')[1].trigger('click')
      expect(wrapper.text()).toContain('no notes yet')
      await wrapper.find('[data-share-kind="group"]').trigger('click')
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[group]])
    } finally {
      wrapper.unmount()
    }
  }
)
