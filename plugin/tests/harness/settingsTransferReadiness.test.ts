import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref, shallowRef } from 'vue'

const source = readFileSync(resolve(__dirname, '../../src/components/Views.vue'), 'utf8')
const template = source.match(/<Teleport v-if="settingsContainer"[\s\S]*?<\/Teleport>/)![0]

it('starts fresh settings when hide and display are batched in one Vue tick', async () => {
  const first = document.createElement('div')
  const second = document.createElement('div')
  first.id = 'sample-settings-first'
  second.id = 'sample-settings-second'
  document.body.append(first, second)
  const settingsContainer = shallowRef<HTMLElement | null>(first)
  let mounts = 0
  const SettingsView = defineComponent({
    setup: () => ({ instance: ++mounts, menuOpen: ref(true) }),
    template:
      '<div><nav v-if="menuOpen"><button @click="menuOpen = false">Transfer</button></nav><span>{{ instance }}</span></div>',
  })
  const wrapper = mount(
    defineComponent({
      components: { SettingsView },
      setup: () => ({ settingsContainer }),
      template,
    })
  )
  try {
    expect(first.querySelector('nav')).not.toBeNull()
    first.querySelector('button')!.click()
    await nextTick()
    expect(first.querySelector('nav')).toBeNull()
    // The host can hide and redisplay its plugin tab before Vue flushes the null target.
    settingsContainer.value = null
    settingsContainer.value = second
    await nextTick()
    expect(first.textContent).toBe('')
    expect(second.querySelector('nav')?.textContent).toBe('Transfer')
    expect(second.querySelector('span')?.textContent).toBe('2')
    expect(mounts).toBe(2)
  } finally {
    wrapper.unmount()
    first.remove()
    second.remove()
  }
})
