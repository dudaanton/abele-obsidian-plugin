import { describe, expect, it, vi } from 'vitest'
import type { ChangeItem } from '@abele/sync-protocol'
import {
  StagedSettingsPrompt,
  appliedNotice,
  groupStaged,
  keptNotice,
  pluginIdsOf,
  stagedSummary,
} from '@/sync/stagedSettings'
import { obsidianReloader, RELOAD_COMMAND } from '@/sync/reload'
import { settingsDeferred } from '@/sync/scope'
import { DISCONNECTED_STATUS, statusOf, statusTooltip, type SyncStatus } from '@/sync/status'

/**
 * Settings changed on another device (phase 3b, decision 11): which paths wait, how the question
 * names them, when it is asked, and what is said afterwards.
 */

let seq = 0
const change = (path: string, from = 'Laptop', over: Partial<ChangeItem> = {}): ChangeItem => ({
  seq: ++seq,
  file_id: `f-${path}`,
  op: 'modify',
  path,
  prev_path: null,
  sha: 'a'.repeat(64),
  size: 2,
  mtime: 1,
  version_id: `v${seq}`,
  kind: 'config',
  actor: { kind: 'device', id: `d-${from}`, name: from },
  at: '2026-09-27T10:00:00.000Z',
  ...over,
})

const status = (deferred: number): SyncStatus => ({
  ...DISCONNECTED_STATUS,
  state: 'idle',
  deferred,
})

describe('which pulled paths wait', () => {
  const defer = settingsDeferred('.obsidian', '.obsidian/plugins/abele/data.json')!

  it('holds everything in the config folder, but Abele’s own settings', () => {
    expect(defer('.obsidian/app.json')).toBe(true)
    expect(defer('.obsidian/plugins/dataview/data.json')).toBe(true)
    expect(defer('.obsidian/plugins/dataview/main.js')).toBe(true)
    expect(defer('.obsidian/themes/Minimal/theme.css')).toBe(true)
    expect(defer('.obsidian/plugins/abele/data.json')).toBe(false)
    expect(defer('Notes/app.json')).toBe(false)
  })

  it('compares case-folded, as a case-insensitive disk hands the paths back', () => {
    expect(defer('.obsidian/plugins/Abele/Data.json')).toBe(false)
    expect(defer('.Obsidian/hotkeys.json')).toBe(true)
  })

  it('uses the plugin’s real folder, which is not always its id', () => {
    const own = settingsDeferred('.obsidian', '.obsidian/plugins/abele-dev/data.json')!
    expect(own('.obsidian/plugins/abele-dev/data.json')).toBe(false)
    expect(own('.obsidian/plugins/abele/data.json')).toBe(true)
  })

  it('holds nothing where the config folder is one the wire does not know', () => {
    expect(settingsDeferred('.obsidian-mobile', '.obsidian-mobile/plugins/abele/data.json')).toBe(
      null
    )
  })
})

describe('what the question says', () => {
  it('groups Obsidian’s own settings by name and plugins by theirs, or by folder', () => {
    const groups = groupStaged(
      [
        change('.obsidian/app.json'),
        change('.obsidian/hotkeys.json', 'Phone'),
        change('.obsidian/plugins/dataview/data.json'),
        change('.obsidian/plugins/dataview/main.js'),
        change('.obsidian/plugins/obsidian-tasks-plugin/manifest.json'),
        change('.obsidian/themes/Minimal/theme.css'),
        change('.obsidian/snippets/wide.css'),
        change('.obsidian/core-plugins.json'),
      ],
      { dataview: 'Dataview' }
    )

    expect(groups.categories).toEqual(['App settings', 'Hotkeys', 'Appearance', 'Core plugins'])
    expect(groups.plugins).toEqual(['Dataview', 'obsidian-tasks-plugin'])
    expect(groups.sources).toEqual(['Laptop', 'Phone'])
    expect(stagedSummary(groups)).toBe(
      'App settings, Hotkeys, Appearance, Core plugins, 2 plugins (Dataview, obsidian-tasks-plugin)'
    )
  })

  it('says one plugin as one', () => {
    const groups = groupStaged([change('.obsidian/plugins/dataview/data.json')], {})
    expect(stagedSummary(groups)).toBe('1 plugin (dataview)')
  })

  it('lists each plugin folder once', () => {
    expect(
      pluginIdsOf([
        change('.obsidian/plugins/a/data.json'),
        change('.obsidian/plugins/a/main.js'),
        change('.obsidian/plugins/b/data.json'),
        change('.obsidian/app.json'),
      ])
    ).toEqual(['a', 'b'])
  })
})

describe('what is said afterwards', () => {
  it('says a reload is under way, or that Obsidian has to be restarted', () => {
    expect(appliedNotice({ applied: ['a'], skipped: [], reloaded: true })).toBe(
      'Settings applied; Obsidian is reloading.'
    )
    expect(appliedNotice({ applied: ['a'], skipped: [], reloaded: false })).toBe(
      'Settings applied. Restart Obsidian to use them.'
    )
  })

  it('names the files changed here since, whose version goes out instead', () => {
    expect(appliedNotice({ applied: [], skipped: ['a', 'b'], reloaded: false })).toBe(
      "2 files changed on this device since, so this device's version of them goes to the other devices instead."
    )
  })

  it('says nothing was applied without an engine or with nothing waiting', () => {
    expect(appliedNotice(null)).toMatch(/not running/)
    expect(appliedNotice({ applied: [], skipped: [], reloaded: false })).toMatch(/no longer/)
  })

  it('says what stayed on the other device when this device’s were kept', () => {
    expect(keptNotice({ kept: ['a'], left: ['b', 'c', 'd'] })).toBe(
      "This device's settings go to the other devices at the next sync. 3 files exist only on the other device and were left there."
    )
    expect(keptNotice({ kept: [], left: ['b'] })).toBe(
      '1 file exists only on the other device and was left there.'
    )
  })
})

describe('when the question is asked', () => {
  function prompt(list: ChangeItem[][], visible = true) {
    const reads = [...list]
    const host = {
      list: vi.fn(async () => reads.shift() ?? []),
      visible: vi.fn(() => visible),
      names: vi.fn(async () => ({})),
    }
    const reloader = { available: () => true, reload: () => true }
    return { host, prompt: new StagedSettingsPrompt(host, reloader) }
  }

  it('asks about what waits at a start, once', async () => {
    const waiting = [change('.obsidian/app.json')]
    const { prompt: p } = prompt([waiting, waiting])

    await p.noticed(status(1))
    expect(p.asking.value?.changes).toEqual(waiting)
    p.later()
    await p.refresh()
    expect(p.asking.value).toBeNull()
  })

  it('asks again when a sync stages a new version, even at the same count', async () => {
    const first = [change('.obsidian/app.json')]
    const second = [change('.obsidian/app.json')]
    const { prompt: p } = prompt([first, second])
    await p.noticed(status(1))
    p.later()

    const news = {
      pull: { deferred: 1 },
      push: {},
      secondPull: null,
    } as unknown as Parameters<StagedSettingsPrompt['reported']>[0]
    await p.reported(news)

    expect(p.asking.value?.changes).toEqual(second)
  })

  it('does not close a question on a count of 0 an engine just built reports', async () => {
    const waiting = [change('.obsidian/app.json')]
    const { prompt: p } = prompt([waiting, waiting])
    await p.noticed(status(1))
    const key = p.asking.value!.key

    await p.noticed(status(0))

    expect(p.asking.value?.key).toBe(key)
  })

  it('waits for the app to come to the front', async () => {
    const waiting = [change('.obsidian/app.json')]
    const { host, prompt: p } = prompt([waiting], false)
    await p.noticed(status(1))
    expect(p.asking.value).toBeNull()

    host.visible.mockReturnValue(true)
    p.foreground()
    expect(p.asking.value?.changes).toEqual(waiting)
  })
})

describe('the reload', () => {
  const appWith = (commands: unknown) => () => ({ commands }) as never

  it('runs Obsidian’s own reload command', () => {
    const executeCommandById = vi.fn(() => true)
    const reloader = obsidianReloader(appWith({ findCommand: () => ({}), executeCommandById }))

    expect(reloader.available()).toBe(true)
    expect(reloader.reload()).toBe(true)
    expect(executeCommandById).toHaveBeenCalledWith(RELOAD_COMMAND)
    expect(RELOAD_COMMAND).toBe('app:reload')
  })

  it('is not available where Obsidian has no such command', () => {
    const reloader = obsidianReloader(
      appWith({ findCommand: () => undefined, executeCommandById: () => false })
    )
    expect(reloader.available()).toBe(false)
    expect(reloader.reload()).toBe(false)
    expect(obsidianReloader(() => null).available()).toBe(false)
  })
})

describe('the status', () => {
  it('carries the staged count, and the tooltip says where to apply it', () => {
    const engine = {
      state: 'idle' as const,
      pending: 0,
      lastSyncAt: null,
      lastError: null,
      cursor: 1,
      headSeq: 1,
      deferred: 5,
    }
    expect(statusOf(engine).deferred).toBe(5)
    expect(statusOf({ ...engine, deferred: undefined }).deferred).toBe(0)
    expect(statusTooltip(status(5))).toContain(
      'Settings waiting (5) — Apply and reload on the Sync tab.'
    )
    expect(statusTooltip(status(0))).not.toContain('Settings waiting')
  })
})
