/**
 * When the plugin takes a join as done: only on the run the engine says finished it
 * (`joinFinished(report)`, the core's `SyncReport.joined`), never on any run that got through.
 * A run past the feed's start that got through without the join's push being answered — a
 * restart after a pull whose scan failed, say — must leave the choice in place, or the files the
 * join still owes go out without the side the person picked (pi review #5). The engine itself is
 * replaced here by one that only keeps the options it was built with, so `onSync` can be handed
 * the reports a run would hand it; the round trip against a real server is in the integration
 * tier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SyncReport } from '@abele/sync-core'

const built: { onSync?: (report: SyncReport) => void } = {}

vi.mock('@abele/sync-core', async (original) => ({
  ...(await original<typeof import('@abele/sync-core')>()),
  SyncEngine: class {
    constructor(options: { onSync: (report: SyncReport) => void }) {
      built.onSync = options.onSync
    }
  },
  SyncClient: class {
    forVault(): object {
      return {}
    }
  },
}))
vi.mock('@/sync/IndexedDbStateStore', () => ({
  stateDatabaseName: (id: string) => `abele-sync-${id}`,
  IndexedDbStateStore: {
    open: async () => ({
      onClosedElsewhere: () => undefined,
      onRecoveryRequired: () => undefined,
      permitsEngineEffects: true,
      close: () => undefined,
      async *all() {},
      observeEntries: () => undefined,
    }),
  },
}))
vi.mock('@/sync/ledgerRecovery', () => ({
  requireLedger: async () => undefined,
  LEDGER_IDENTITY_KEY: 'ledger-identity-v1',
  LedgerRecoveryRequired: class extends Error {},
}))
vi.mock('@/scripting/trust/scriptTrustStorage', () => ({
  activateScriptProvenance: async () => ({
    store: {
      close: () => undefined,
      onRecoveryRequired: () => undefined,
      permitsEngineEffects: true,
    },
    provenance: {},
  }),
}))
vi.mock('@/sync/ObsidianFileSystem', () => ({ ObsidianFileSystem: class {} }))
vi.mock('@/sync/ledgerId', () => ({
  readLedgerId: () => ({ stateId: 's1', vaultId: 'v1' }),
  writeLedgerId: () => undefined,
}))
vi.mock('@/sync/messages', () => ({ summarise: () => 'sync: done' }))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: { getInstance: () => ({ ai: { scriptsFolder: '' } }) },
}))

import { buildEngine, type EngineRecipe } from '@/sync/engineBuild'
import { emptyConnection } from '@/sync/connection'

/** What a run that got through reports, `joined` as said. */
function report(joined: boolean): SyncReport {
  return {
    joined,
    pull: { bootstrapped: true, applied: 0, conflicts: 0 },
    push: { applied: 0 },
  } as unknown as SyncReport
}

describe('the end of a join', () => {
  const joinedCalls: unknown[] = []
  let recipe: EngineRecipe

  beforeEach(async () => {
    joinedCalls.length = 0
    built.onSync = undefined
    recipe = {
      app: {
        loadLocalStorage: () => null,
        vault: { configDir: '.obsidian', on: () => ({}), offref: () => undefined },
      },
      host: {
        deps: () => ({}),
        manifest: () => ({ id: 'abele' }),
        settingsArrived: () => undefined,
        settingsMeaning: async () => '',
        joined: (join: unknown) => joinedCalls.push(join),
        synced: () => undefined,
      },
      board: { note: () => undefined, failed: () => undefined },
      connection: { ...emptyConnection(), serverUrl: 'http://x', vaultId: 'v1' },
      token: 'absd_x',
      ignoreText: null,
      join: { vaultId: 'v1', prefer: 'theirs', ask: false },
      noticed: () => undefined,
      closedElsewhere: () => undefined,
    } as unknown as EngineRecipe
    await buildEngine(recipe)
  })

  it('refuses personal engine construction with retained scoped context before replacing callbacks', async () => {
    const previous = built.onSync
    recipe.app.loadLocalStorage = (key) =>
      key === 'abele-sync-scoped-connection' ? { sample: true } : null
    await expect(buildEngine(recipe)).rejects.toThrow(/Scoped/)
    expect(built.onSync).toBe(previous)
  })
  it('keeps the choice after a run that got through without finishing the join', () => {
    built.onSync?.(report(false))
    expect(joinedCalls).toEqual([])
  })

  it('ends it on the run the engine says finished it', () => {
    built.onSync?.(report(true))
    expect(joinedCalls).toEqual([{ vaultId: 'v1', prefer: 'theirs', ask: false }])
  })
})
