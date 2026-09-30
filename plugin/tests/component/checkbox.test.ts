import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import Checkbox from '@/components/obsidian/Checkbox.vue'

// A row may be clickable too. The widget owns its DOM click and its consumer handles toggle;
// unrelated sibling labels must remain clickable, and ordinary settings switches still work.
describe('the shared Checkbox click contract', () => {
  it('emits one toggle without also invoking a clickable parent', async () => {
    const parent = vi.fn()
    const toggle = vi.fn()
    const host = mount(
      defineComponent({
        components: { Checkbox },
        setup: () => ({ parent, toggle }),
        template: '<div @click="parent"><Checkbox :is-enabled="false" @toggle="toggle" /></div>',
      })
    )
    await host.find('.checkbox-container').trigger('click')
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(parent).not.toHaveBeenCalled()
  })

  it('keeps ordinary settings toggles and separately clickable labels working', async () => {
    const enabled = ref(false)
    const toggle = () => {
      enabled.value = !enabled.value
    }
    const host = mount(
      defineComponent({
        components: { Checkbox },
        setup: () => ({ enabled, toggle }),
        template:
          '<div><Checkbox :is-enabled="enabled" @toggle="toggle" /><span @click="toggle">Label</span></div>',
      })
    )
    await host.find('.checkbox-container').trigger('click')
    expect(enabled.value).toBe(true)
    await host.find('span').trigger('click')
    expect(enabled.value).toBe(false)
  })
})
