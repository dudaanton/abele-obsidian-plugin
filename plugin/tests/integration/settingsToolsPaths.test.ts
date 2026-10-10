/**
 * A settings path an agent writes is walked one segment at a time, and a segment is a name only
 * when it is a setting the container already has.
 *
 * `__proto__`, `prototype` and `constructor` name something on every object: walked into, the
 * next assignment lands on `Object.prototype` — or `Array.prototype` — and every object in the
 * app has the key from then on, before any check of the value has run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Platform } from 'obsidian'
import { createReadSettingsTool, createWriteSettingsTool } from '@/ai/tools/SettingsTools'
import { deviceValue, writeDevice } from '@/ai/tools/settingsDevice'
import { AbeleConfig } from '@/services/AbeleConfig'
import { tokenSettingsFixture } from '../helpers/tokenSettingsFixture'
import { tokenUi } from '@/sync/tokenUi'
import { useVault } from '../helpers/testEnv'

const write = createWriteSettingsTool()
const read = createReadSettingsTool()

async function answer(tool: typeof write, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

let token: ReturnType<typeof tokenSettingsFixture>
const BLOCKED = ['__proto__', 'prototype', 'constructor']

/** Whatever a polluting write may have put on the prototypes every object reads through. */
function polluted(): unknown[] {
  return [
    ({} as Record<string, unknown>).polluted,
    ([] as unknown as Record<string, unknown>).polluted,
    (Object.prototype as Record<string, unknown>).polluted,
  ].filter((value) => value !== undefined)
}

beforeEach(() => {
  useVault([])
  Platform.isMobile = false
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.saveSettings = vi.fn(async () => undefined)
  token = tokenSettingsFixture()
})

afterEach(async () => {
  delete (Object.prototype as Record<string, unknown>).polluted
  delete (Array.prototype as unknown as Record<string, unknown>).polluted
  vi.restoreAllMocks()
  tokenUi.value = null
})

describe("a path into this device's connection", () => {
  for (const segment of BLOCKED) {
    it(`is refused through ${segment}, and nothing is written anywhere`, async () => {
      const path = `sync.connections.${token.id}.${segment}.polluted`

      expect(await answer(write, { path, value: 'true' })).toBe(
        `"${path}" is not a valid field path.`
      )
      expect(await answer(read, { path })).toBe(`"${path}" is not a valid field path.`)
      expect(polluted()).toEqual([])
      expect(token.registry.records()[0]).not.toHaveProperty('polluted')
    })
  }

  for (const segment of BLOCKED) {
    it(`is refused through ${segment} when written or read directly, too`, async () => {
      const path = `sync.connections.${token.id}.${segment}.polluted`

      expect(await writeDevice(path, true)).toBe(`"${path}" is not a valid field path.`)
      expect(deviceValue(path)).toBeUndefined()
      expect(deviceValue(`sync.connections.${token.id}.${segment}`)).toBeUndefined()
      expect(polluted()).toEqual([])
    })
  }

  it('is refused for a name the token preferences do not have, or below a plain field', async () => {
    for (const path of [token.path('polluted'), token.path('paused') + '.polluted']) {
      expect(await answer(write, { path, value: 'true' })).toBe(
        `"${path}" is not a valid field path.`
      )
    }
    expect(polluted()).toEqual([])
  })

  it('still writes a public token preference', async () => {
    const text = await answer(write, { path: token.path('paused'), value: 'true' })

    expect(text).not.toContain('not a valid field path')
    expect(token.registry.records()[0].paused).toBe(true)
  })
})

describe('a path into the settings', () => {
  const paths = [
    'ai.agents.0.__proto__.polluted',
    'journals.__proto__.polluted',
    'accountsList.__proto__.__proto__',
    'accountsList.constructor.prototype.polluted',
    'reader.constructor',
    'github.prototype',
  ]

  for (const path of paths) {
    it(`is refused for ${path}, and nothing is written anywhere`, async () => {
      expect(await answer(write, { path, value: '"x"' })).toBe(
        `"${path}" is not a valid field path.`
      )
      expect(await answer(read, { path })).toBe(`"${path}" is not a valid field path.`)
      expect(polluted()).toEqual([])
      expect(AbeleConfig.getInstance().saveSettings).not.toHaveBeenCalled()
    })
  }

  it('still reads and writes a setting below the top level', async () => {
    const text = await answer(write, { path: 'reader.fontSize', value: '21' })

    expect(text).not.toContain('not a valid field path')
    expect(AbeleConfig.getInstance().reader.fontSize).toBe(21)
    expect(await answer(read, { path: 'logsNotesTypes' })).toContain('logsNotesTypes (array)')
  })
})
