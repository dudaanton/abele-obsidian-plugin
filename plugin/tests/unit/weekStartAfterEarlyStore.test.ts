/**
 * The store can exist before the settings do.
 *
 * Loading the settings asks every tool what it says of itself, and the `skill` tool looks at
 * `GlobalStore.app` to answer — so the store is built while `data.json` is still being read.
 * A value the store copied out of the settings at construction was then the unset one: the
 * calendar started its weeks on Sunday with "Week starts on Monday" switched on.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { codeToolDescriptions } from '@/ai/tools'
import { buildFakeVault } from '../helpers/fakeVault'

type Instances = { instance?: unknown }

function freshSingletons(): void {
  ;(GlobalStore as unknown as Instances).instance = undefined
}

function loadFrom(stored: Record<string, unknown>) {
  AbeleConfig.getInstance().init({
    loadData: async () => stored,
    saveData: async () => {},
    syncAiFeatures: vi.fn(),
  } as never)
  return AbeleConfig.getInstance().loadSettings()
}

describe('the week start the views draw from', () => {
  it('follows the loaded settings when the store was built during the load', async () => {
    freshSingletons()
    AbeleConfig.getInstance().weekStartsOnMonday = undefined as unknown as boolean
    // What loading the settings does first: every tool describes itself, building the store.
    await codeToolDescriptions()
    await loadFrom({ weekStartsOnMonday: true })

    const store = GlobalStore.getInstance()
    store.init(buildFakeVault([]) as never)
    expect(store.weekStartsOnMonday.value).toBe(true)
    store.destroy()
  })

  it('follows settings that arrived from another device', async () => {
    freshSingletons()
    await loadFrom({ weekStartsOnMonday: true })
    const store = GlobalStore.getInstance()
    store.init(buildFakeVault([]) as never)
    expect(store.weekStartsOnMonday.value).toBe(true)

    await loadFrom({ weekStartsOnMonday: false })
    store.applySettings()
    expect(store.weekStartsOnMonday.value).toBe(false)
    store.destroy()
  })

  it('follows the settings when the plugin is turned off and on again', async () => {
    freshSingletons()
    await loadFrom({ weekStartsOnMonday: false })
    const store = GlobalStore.getInstance()
    store.init(buildFakeVault([]) as never)
    store.destroy()

    await loadFrom({ weekStartsOnMonday: true })
    store.init(buildFakeVault([]) as never)
    expect(store.weekStartsOnMonday.value).toBe(true)
    store.destroy()
  })

  it('copies nothing out of the settings while the store is being built', () => {
    // Whatever the store takes from AbeleConfig at construction is taken before the settings
    // load. Read them in `applySettings`, or on use, instead.
    const source = readFileSync(resolve(__dirname, '../../src/stores/GlobalStore.ts'), 'utf8')
    const fieldInitializers = source
      .split('\n')
      .filter((l) => /^\s+(public|private|protected)\b[^(]*=/.test(l))
    expect(fieldInitializers.filter((l) => l.includes('AbeleConfig'))).toEqual([])
  })
})
