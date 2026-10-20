import { expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { captureSyncFailure, SYNC_SNAPSHOT } from '../e2e/helpers/syncDiagnostics'
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  const mkdirSync = vi.fn(),
    writeFileSync = vi.fn()
  return {
    ...actual,
    mkdirSync,
    writeFileSync,
    default: { ...actual.default, mkdirSync, writeFileSync },
  }
})
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
vi.mock('../e2e/helpers/phone', () => ({ screenshot: vi.fn() }))

it('captures the Share sheet HTML, rendering flags and typed query during a picker wait', () => {
  const sheet = document.createElement('div')
  sheet.className = 'modal'
  const picker = document.createElement('div')
  picker.className = 'abele-share-picker'
  Object.assign(picker.dataset, {
    sharePickerMode: 'inline',
    platformPhone: 'false',
    platformMobile: 'true',
  })
  const input = document.createElement('input')
  input.value = 'Garden/Flowers'
  const results = document.createElement('div')
  results.className = 'abele-share-picker__results'
  const row = document.createElement('div')
  row.className = 'suggestion-item'
  row.textContent = 'Flowers'
  results.append(row)
  picker.append(input, results)
  sheet.append(picker)
  document.body.append(sheet)
  const bodyClass = document.body.className
  document.body.classList.add('is-mobile', 'is-phone')
  try {
    const app = { isMobile: true, plugins: { plugins: {} }, setting: {} }
    const snapshot = new Function('app', 'document', SYNC_SNAPSHOT + ';return syncSnapshot()')(
      app,
      document
    )
    expect(snapshot.sharePickers).toEqual([
      {
        sheetHtml: sheet.outerHTML,
        mode: 'inline',
        flags: {
          appMobile: true,
          bodyMobile: true,
          bodyPhone: true,
          platformMobile: 'true',
          platformPhone: 'false',
        },
        query: 'Garden/Flowers',
        inlineRows: 1,
      },
    ])
  } finally {
    sheet.remove()
    document.body.className = bodyClass
  }
})

it('records inspection stage, counters and timings rather than hiding them behind Connecting', () => {
  const startup = {
    stage: 'Checking the vault',
    completed: 8469,
    total: 12023,
    startedAt: 100,
    progressAt: 200,
  }
  const timings = [
    { stage: 'Waiting for previous sync', startedAt: 50, durationMs: 50, outcome: 'complete' },
  ]
  const app = {
    plugins: {
      plugins: {
        abele: {
          tokenEngines: {
            ui: {
              rows: { value: [{ id: 'sample', status: 'joining', paused: false }] },
              activity: {
                value: {
                  sample: {
                    startup,
                    startupTimings: timings,
                    inspection: { completed: 8469, total: 12023 },
                  },
                },
              },
            },
            live: new Map(),
          },
        },
      },
    },
    setting: {},
  }
  const snapshot = new Function('app', 'document', SYNC_SNAPSHOT + ';return syncSnapshot()')(
    app,
    document
  )
  expect(snapshot.connections[0]).toMatchObject({
    statusText: 'Checking the vault… 8469/12023',
    startup,
    startupTimings: timings,
  })
})

it('snapshots a stuck engine and pending holds synchronously without reading a token or awaiting its ledger', () => {
  const engine = {
    state: 'syncing',
    pending: 4,
    heldDeletes: 60,
    deferred: 1,
    lastError: { code: 'io', message: 'private request data' },
  }
  const ui = {
    rows: {
      value: [
        { id: 'sample', status: 'syncing', paused: false, secretReference: 'private-secret' },
      ],
    },
    activity: { value: { sample: { heldDeletes: 60, error: 'Needs attention' } } },
  }
  const app = {
    plugins: {
      plugins: {
        abele: {
          tokenEngines: { ui, live: new Map([['sample', { engine: { status: engine } }]]) },
        },
      },
    },
    setting: {},
  }
  const snapshot = new Function('app', 'document', SYNC_SNAPSHOT + ';return syncSnapshot()')(
    app,
    document
  )
  expect(snapshot.connections[0]).toMatchObject({
    id: 'sample',
    holds: 60,
    lastError: 'Needs attention',
    engine: { state: 'syncing', lastErrorCode: 'io' },
  })
  expect(JSON.stringify(snapshot)).not.toContain('private')
  const evalAwait = vi.fn().mockReturnValueOnce(snapshot).mockReturnValueOnce(true)
  const report = captureSyncFailure({ evalAwait } as never, 'sync timeout')
  expect(mkdirSync).toHaveBeenCalled()
  expect(writeFileSync).toHaveBeenCalledWith(
    expect.stringMatching(/\.json$/),
    expect.stringContaining('"holds": 60')
  )
  expect(evalAwait.mock.calls[1][0]).toContain('capturePage')
  expect(report).toContain('syncing')
  expect(report).toContain('.png')
})
