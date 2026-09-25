/**
 * The first start in a vault, which is when the documentation opens by itself.
 *
 * Told apart by the settings file: none at all is a first start. A file Obsidian could not
 * parse is still somebody's settings, and so is an empty object, so neither counts — the
 * documentation must not open at every start of a vault whose settings are damaged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

function install(stored: unknown) {
  AbeleConfig.getInstance().init({
    loadData: async () => stored,
    saveData: async () => undefined,
    syncAiFeatures: vi.fn(),
  } as never)
}

beforeEach(() => {
  useVault([])
})

describe('a first start', () => {
  it('is a vault with no settings file', async () => {
    install(null)
    await AbeleConfig.getInstance().loadSettings()
    expect(AbeleConfig.getInstance().freshInstall).toBe(true)
  })

  it('is not a vault with settings, even empty ones', async () => {
    install({})
    await AbeleConfig.getInstance().loadSettings()
    expect(AbeleConfig.getInstance().freshInstall).toBe(false)
  })

  it('is not a vault whose settings file could not be read', async () => {
    install(undefined)
    await AbeleConfig.getInstance().loadSettings()
    expect(AbeleConfig.getInstance().freshInstall).toBe(false)
  })
})
