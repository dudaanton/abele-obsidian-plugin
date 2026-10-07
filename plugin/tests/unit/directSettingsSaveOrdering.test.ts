import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const config = AbeleConfig.getInstance()
afterEach(() => {
  config.destroy()
  vi.restoreAllMocks()
})

it.each(['awaited', 'queued'] as const)(
  'retains a completed direct on/off save cycle during a stale read (%s)',
  async (ordering) => {
    useVault([])
    const disk = new FakeSettings({ refreshDelay: 500, editorSyntaxHighlight: false })
    config.init(disk as never)
    await config.loadSettings()
    const before = { ...config.exportSettings(), editorSyntaxHighlight: true, refreshDelay: 888 }
    disk.stored = before
    const entered = deferred<void>(),
      release = deferred<void>()
    vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
      const snapshot = JSON.parse(JSON.stringify(disk.stored))
      entered.resolve()
      await release.promise
      return snapshot
    })
    const reading = config.reloadSettings()
    await entered.promise
    try {
      // The direct screen path: no editSettings/useSettingsSave registration.
      config.editorSyntaxHighlight = true
      const first = config.saveSettings()
      if (ordering === 'awaited') await first
      config.editorSyntaxHighlight = false
      const second = config.saveSettings()
      await Promise.all([first, second])
      expect(disk.saved.at(-1)?.editorSyntaxHighlight).toBe(false)
      release.resolve()
      await reading
      expect(config.editorSyntaxHighlight).toBe(false)
      expect(config.refreshDelay).toBe(888)
      expect(disk.stored).toMatchObject({ editorSyntaxHighlight: false, refreshDelay: 888 })
    } finally {
      release.resolve()
      await reading
    }
  }
)
