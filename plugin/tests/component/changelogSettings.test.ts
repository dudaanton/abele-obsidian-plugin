import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import OtherSettings from '@/components/settings/OtherSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

const opened = vi.hoisted(() => vi.fn())
vi.mock('@/changelog/ChangelogView', () => ({ openChangelog: opened }))

it('closes settings before opening all versions without changing settings', async () => {
  const app = useVault([]) as unknown as { setting: { close: ReturnType<typeof vi.fn> } }
  app.setting = { close: vi.fn() }
  const save = vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const wrapper = mount(OtherSettings)
  const button = wrapper.findAll('button').find((b) => b.text() === 'Open changelog')!
  expect(button).toBeDefined()
  await button.trigger('click')
  expect(app.setting.close).toHaveBeenCalledOnce()
  expect(opened).toHaveBeenCalledExactlyOnceWith(app)
  expect(app.setting.close.mock.invocationCallOrder[0]).toBeLessThan(
    opened.mock.invocationCallOrder[0]
  )
  expect(save).not.toHaveBeenCalled()
  wrapper.unmount()
  save.mockRestore()
})
