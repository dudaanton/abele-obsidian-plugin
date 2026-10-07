import { expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { FakeSettings } from '../helpers/fakeSettings'
import Card from '@/components/obsidian/Card.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'

it.each(['remove', 'reorder'] as const)(
  'keeps secret drafts with their identity during an incoming %s',
  async (operation) => {
    const app = useVault([])
    const disk = new FakeSettings()
    const config = AbeleConfig.getInstance()
    config.init(disk as never)
    await config.loadSettings()
    config.ai.enabled = true
    const first = { name: 'Sample first', keyId: 'sample-first-key' }
    const second = { name: 'Sample second', keyId: 'sample-second-key' }
    config.ai.secrets = [first, second]
    app.secretStorage.setSecret(first.keyId, 'first value')
    app.secretStorage.setSecret(second.keyId, 'second value')
    await config.saveSettings()
    const screen = mount(GeneralSettings, { global: { stubs: { Dropdown: true, Search: true } } })
    const card = (title: string) =>
      screen.findAllComponents(Card).find((item) => item.props('title') === title)!
    try {
      await card(first.name).trigger('click')
      await card(first.name).find('input[type="password"]').setValue('first draft')
      await card(first.name)
        .findAllComponents(Icon)
        .find((icon) => icon.props('tooltip') === 'Reveal')!
        .trigger('click')
      const incoming = config.exportSettings()
      incoming.ai = {
        ...incoming.ai!,
        secrets: operation === 'remove' ? [second] : [second, first],
      }
      disk.stored = incoming
      await config.reloadSettings()
      await nextTick()
      if (operation === 'remove') {
        expect(screen.find('.abele-ai-secret__editor').exists()).toBe(false)
        await card(second.name).trigger('click')
        expect(card(second.name).find('input[type="password"]').element).toHaveProperty(
          'value',
          'second value'
        )
      } else {
        expect(card(first.name).find('input[placeholder="Value..."]').element).toHaveProperty(
          'value',
          'first draft'
        )
        await card(first.name)
          .findAllComponents(Button)
          .find((button) => button.props('text') === 'Save')!
          .trigger('click')
        await flushPromises()
        expect(app.secretStorage.getSecret(first.keyId)).toBe('first draft')
      }
      expect(app.secretStorage.getSecret(second.keyId)).toBe('second value')
    } finally {
      screen.unmount()
      config.destroy()
    }
  }
)

it('does not overwrite incoming providers and keys on the next edit of an open AI screen', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  config.ai.enabled = true
  const screen = mount(GeneralSettings, {
    global: { stubs: { Input: true, Dropdown: true, Checkbox: true, Search: true } },
  })
  try {
    const incoming = config.exportSettings()
    incoming.ai = {
      ...incoming.ai!,
      providers: [
        {
          id: 'sample-provider',
          name: 'Incoming provider',
          baseUrl: 'https://sample.invalid/v1',
          apiKeyId: 'sample-key',
          models: [],
        },
      ],
      secrets: [{ name: 'Sample secret', keyId: 'sample-secret' }],
    }
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
