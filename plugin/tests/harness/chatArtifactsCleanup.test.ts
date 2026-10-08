import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('tests/e2e/chatArtifacts.e2e.test.ts', 'utf8')
const cleanup = source.slice(
  source.indexOf('      finally {') + '      finally {'.length,
  source.indexOf('\n      }\n    })()`')
)

describe('artifact fixture settings cleanup', () => {
  it.each([false, true])(
    'persists original script flags even if closing fails: %s',
    async (fails) => {
      const config = {
        ai: { scriptsEnabled: false, scriptsFolder: 'Sample temporary scripts' },
        saveSettings: vi.fn(async () => {
          persisted = { ...config.ai }
        }),
      }
      let persisted = { ...config.ai }
      const scriptFixture = {
        ai: { scriptsEnabled: true, scriptsFolder: 'Scripts', toolModes: { fixture: 'ask' } },
      }
      // The helper's durable flags/provenance restoration is exercised with real IDB in
      // scriptFixtureIsolation; here inject a closing failure into the actual finally body.
      const restoreScriptFixture = vi.fn(async (snapshot) => {
        config.ai = { ...snapshot.ai }
        await config.saveSettings()
      })
      const close = async () => {
        if (fails) {
          // A view closing can save again: restoration must also be the final boundary.
          config.ai.scriptsEnabled = false
          ;(config.ai as any).toolModes.fixture = 'auto'
          await config.saveSettings()
          throw new Error('Synthetic close failure')
        }
      }
      const app = {
        vault: { getAbstractFileByPath: () => null, setConfig: vi.fn() },
        workspace: { changeLayout: vi.fn(), getLeavesOfType: () => [] },
      }
      const execute = new Function(
        'config',
        'scriptFixture',
        'restoreScriptFixture',
        'close',
        'app',
        `return (async () => {
      const session = null, tab = null, priorTab = null, chatFile = null, priorLeaf = null
      const chats = {}, directory = 'Sample fixture', oldFolder = '', layout = {}
      const fixtureClone = value => JSON.parse(JSON.stringify(value))
      ${cleanup}
    })()`
      )
      await execute(config, scriptFixture, restoreScriptFixture, close, app).catch(() => {})
      expect(restoreScriptFixture).toHaveBeenCalledWith(scriptFixture)
      expect(config.ai).toEqual({
        scriptsEnabled: true,
        scriptsFolder: 'Scripts',
        toolModes: { fixture: 'ask' },
      })
      expect(persisted).toEqual(config.ai)
      expect(config.saveSettings).toHaveBeenCalled()
    }
  )
})
