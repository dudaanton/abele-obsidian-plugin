import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ChangeItem } from '@abele/sync-protocol'
import PluginCodeModal from '@/components/sync/PluginCodeModal.vue'
import Button from '@/components/obsidian/Button.vue'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

const service = {
  codePrompt: { reloader: { available: () => true } },
  applyPluginCodeAndReload: vi.fn(async () => ({
    applied: ['main.js'],
    skipped: [],
    unshown: [],
    reloaded: true,
  })),
  keepLocalPluginCode: vi.fn(async () => ({
    kept: ['main.js'],
    left: [],
    blocked: [],
    unshown: [],
  })),
  applySettingsAndReload: vi.fn(),
}
const changes = [
  { path: '.obsidian/plugins/sample/main.js', prev_path: null, version_id: 'shown' },
  { path: '.obsidian/plugins/fresh/main.js', prev_path: null, version_id: 'fresh' },
] as ChangeItem[]
const open = (shown = changes) =>
  mount(PluginCodeModal, {
    props: {
      questionKey: 1,
      changes: shown,
      names: {
        sample: 'Sample tool (sample) — Changed · Version 2.0.0',
        fresh: 'Fresh tool — New',
      },
    },
    global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
  })
const press = async (view: ReturnType<typeof open>, text: string) => {
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === text)!
    .trigger('click')
  await flushPromises()
}
beforeEach(() => {
  useVault([])
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the separate plugin-code confirmation', () => {
  it('names every plugin, distinguishes new and changed, and explains the code risk', () => {
    const view = open()
    expect(view.findAll('li').map((one) => one.text())).toEqual([
      'Sample tool (sample) — Changed · Version 2.0.0',
      'Fresh tool — New',
    ])
    expect(view.text()).toContain('code that can run in Obsidian and access your vault')
    expect(view.text()).toContain('separate from applying settings')
  })
  it('does not list a plugin whose changes are no longer in the question', () => {
    const view = open([changes[0]])
    expect(view.findAll('li').map((one) => one.text())).toEqual([
      'Sample tool (sample) — Changed · Version 2.0.0',
    ])
  })
  it('installs only the versions shown through the code action', async () => {
    const view = open()
    await press(view, 'Install and reload')
    expect(service.applyPluginCodeAndReload).toHaveBeenCalledExactlyOnceWith(['shown', 'fresh'])
    expect(service.applySettingsAndReload).not.toHaveBeenCalled()
  })
  it('declines through Keep local code, without installing anything', async () => {
    const view = open()
    await press(view, 'Keep local code')
    expect(service.keepLocalPluginCode).toHaveBeenCalledExactlyOnceWith(['shown', 'fresh'])
    expect(service.applyPluginCodeAndReload).not.toHaveBeenCalled()
  })
  it('Later closes without deciding', async () => {
    const view = open()
    await press(view, 'Later')
    expect(view.emitted('close')).toHaveLength(1)
    expect(service.applyPluginCodeAndReload).not.toHaveBeenCalled()
    expect(service.keepLocalPluginCode).not.toHaveBeenCalled()
  })
})
