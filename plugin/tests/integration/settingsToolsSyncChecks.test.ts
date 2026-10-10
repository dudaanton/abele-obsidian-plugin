import { tokenSettingsFixture } from '../helpers/tokenSettingsFixture'
import { tokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
/**
 * What the agent's writes to this device's connection are held to, past the type check.
 *
 * The Sync tab refuses a cap that is not a positive number, stores the server address the way
 * a sign-in stores it, and never reports a value it did not keep. A write from the agent goes
 * through `SyncService.updateConnection` like the tab's does, so the same rules hold there —
 * and the tool's answer is read back from the connection as saved, not from what was asked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Platform, type App } from 'obsidian'
import { createWriteSettingsTool, describeSettingsWrite } from '@/ai/tools/SettingsTools'
import { AbeleConfig } from '@/services/AbeleConfig'
import { defaultSelective, MOBILE_MAX_FILE_BYTES } from '@/sync/connection'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const write = createWriteSettingsTool()

async function answer(params: Record<string, unknown>): Promise<string> {
  const result = await write.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

const OLD = 'https://old.example.com'

let app: FakeApp

const connection = () => fixture.registry.records()[0]

let fixture: ReturnType<typeof tokenSettingsFixture>
function connected({ token = false, isMobile = false } = {}): void {
  Platform.isMobile = isMobile
  if (!fixture || fixture.app !== app) fixture = tokenSettingsFixture(app)
  fixture.registry.setSelective(fixture.id, defaultSelective(isMobile))
  if (token) fixture.bind()
}

beforeEach(() => {
  app = useVault([])
  Platform.isMobile = false
  const config = AbeleConfig.getInstance()
  config.sync = { keySignature: null }
  config.saveSettings = vi.fn(async () => undefined)
  connected()
})

afterEach(async () => {
  tokenUi.value = null
  vi.restoreAllMocks()
  Platform.isMobile = false
})

describe('the server address is stored the way a sign-in stores it', () => {
  it('keeps the enrolled server under another spelling, stored as the sign-in wrote it', async () => {
    connected({ token: true })

    const text = await answer({
      path: fixture.path('address'),
      value: ' https://OLD.example.com/ ',
    })

    expect(connection().address).toBe(OLD)
    expect(text).toContain(`"${OLD}" → "${OLD}"`)
  })

  it('stores a new address normalised, and the card shows it that way', async () => {
    expect(describeSettingsWrite(fixture.path('address'), 'https://New.Example.com/').after).toBe(
      '"https://new.example.com"'
    )

    const text = await answer({ path: fixture.path('address'), value: 'https://New.Example.com/' })

    expect(connection().address).toBe('https://new.example.com')
    expect(text).toContain('→ "https://new.example.com"')
  })
})

describe('the selective settings are held to the Sync tab rules', () => {
  it('refuses a cap that is not a positive whole number, and changes nothing', async () => {
    for (const value of ['0', '-1', '"lots"', '1.5', '{}', '[]', 'true']) {
      const text = await answer({ path: fixture.path('selective.maxFileBytes'), value })
      expect(text, value).toMatch(/was not changed|type has to match/)
      expect(connection().selective.maxFileBytes, value).toBeNull()
    }
  })

  it('refuses a bad cap on a phone too', async () => {
    Platform.isMobile = true
    connected({ isMobile: true })

    const text = await answer({ path: fixture.path('selective.maxFileBytes'), value: '0' })

    expect(text).toContain('was not changed')
    expect(connection().selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
  })

  it('takes the cap off a phone with null, as an empty field on the tab does', async () => {
    Platform.isMobile = true
    connected({ isMobile: true })

    const text = await answer({ path: fixture.path('selective.maxFileBytes'), value: 'null' })

    expect(connection().selective.maxFileBytes).toBeNull()
    expect(text).toContain(`${MOBILE_MAX_FILE_BYTES} → null`)
  })

  it('refuses a folder list with anything but folder names in it', async () => {
    const text = await answer({
      path: fixture.path('selective.excludedFolders'),
      value: '["a", 5]',
    })

    expect(text).toContain('was not changed')
    expect(connection().selective.excludedFolders).toEqual([])
  })

  it('refuses a switch that is not true or false, and settings missing some', async () => {
    const kind = await answer({ path: fixture.path('selective.settings.main'), value: '"no"' })
    const block = await answer({ path: fixture.path('selective.settings'), value: '{}' })
    const extra = await answer({ path: fixture.path('selective.surprise'), value: 'true' })

    expect(kind).toMatch(/was not changed|type/)
    expect(block).toContain('was not changed')
    expect(extra).toMatch(/was not changed|not a setting|not a valid field path/)
    expect(connection().selective.settings.main).toBe(true)
    expect(connection().selective).not.toHaveProperty('surprise')
  })

  it('reports what was stored', async () => {
    const text = await answer({ path: fixture.path('selective.maxFileBytes'), value: '1000' })

    expect(text).toBe(fixture.path('selective.maxFileBytes') + ': null → 1000')
    expect(connection().selective.maxFileBytes).toBe(1000)
  })
})

describe('a write that leaves sync unable to start', () => {
  it('reports a stored filter even when the running engine cannot rescan', async () => {
    const runtime = fixture.bind()
    runtime.updateSelective = async () => {
      throw Object.assign(Error('sample offline'), { code: 'offline' })
    }
    const text = await answer({ path: fixture.path('selective.maxFileBytes'), value: '1000' })
    expect(fixture.registry.records()[0].selective?.maxFileBytes).toBe(1000)
    expect(text).toContain(fixture.path('selective.maxFileBytes') + ': null → 1000')
    expect(text).toContain('sync could not start:')
    expect(text).not.toContain('was not changed')
  })
  /** A state database that will not open: the build fails the way a broken one does. */
  const brokenDatabase = {
    open: () => {
      throw new Error('the state database would not open')
    },
  } as unknown as IDBFactory

  it('says so in the answer, beside what was written', async () => {
    const token = fixture
    token.bind()
    token.ui.runtimes.clear()
    const host = new TokenEngines(
      app as unknown as App,
      token.ui,
      (id) => token.keys.get(id) ?? null,
      { indexedDB: brokenDatabase }
    )
    try {
      const text = await answer({ path: token.path('paused'), value: 'true' })
      expect(token.registry.records()[0].status).toBe('error')
      expect(token.registry.records()[0].paused).toBe(true)
      expect(text).toContain(token.path('paused') + ': false → true')
      expect(text).toContain('sync could not start:')
      expect(text).toContain(token.ui.activity.value[token.id].error!)
      expect(text).not.toContain('a'.repeat(43))
      expect(AbeleConfig.getInstance().saveSettings).not.toHaveBeenCalled()
    } finally {
      await host.close()
    }
  })
})
