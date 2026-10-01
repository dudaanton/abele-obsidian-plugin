import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { FakeSettings } from '../helpers/fakeSettings'

it('does not overwrite incoming providers and keys on the next edit of an open AI screen', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  config.ai.enabled = true
  const screen = mount(GeneralSettings, { global: { stubs: { Input: true, Dropdown: true, Checkbox: true, Search: true } } })
  try {
    const incoming = config.exportSettings()
    incoming.ai = { ...incoming.ai!, providers: [{ id: 'sample-provider', name: 'Incoming provider', baseUrl: 'https://sample.invalid/v1', apiKeyId: 'sample-key', models: [] }],
      secrets: [{ name: 'Sample secret', keyId: 'sample-secret' }] }
    disk.stored = incoming
    await config.reloadSettings()
    await nextTick()
    await screen.findComponent(Checkbox).vm.$emit('toggle')
    await nextTick()
    expect(config.ai.providers[0]?.id).toBe('sample-provider')
    expect(config.ai.secrets[0]?.keyId).toBe('sample-secret')
  } finally {
    screen.unmount()
    config.destroy()
  }
})
