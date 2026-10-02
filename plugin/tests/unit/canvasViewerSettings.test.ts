import { expect, it } from 'vitest'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { collectEntries, buildPayload, applyEntries } from '@/transfer/entries'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
it('opens canvases in Abele by default and transfers the explicit native preference', async () => {
  useVault([])
  expect(DEFAULT_SETTINGS.canvasViewer).toBe(true)
  const config = AbeleConfig.getInstance()
  config.init(new FakeSettings({ refreshDelay: 500 }) as never)
  await config.loadSettings()
  expect(config.canvasViewer).toBe(true)
  config.destroy()
  const entries = collectEntries({ ...DEFAULT_SETTINGS, canvasViewer: false })
  const payload = buildPayload(entries, () => '')
  expect(applyEntries(payload.entries, { ...DEFAULT_SETTINGS }).canvasViewer).toBe(false)
})
