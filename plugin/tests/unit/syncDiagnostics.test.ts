import { expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { captureSyncFailure, SYNC_SNAPSHOT } from '../e2e/helpers/syncDiagnostics'
import { SHARE_SET_PICKER } from '../e2e/helpers/shareSetPicker'
import { syncModalClosed } from '../e2e/helpers/syncModal'
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

it('waits for a confirmation in another document to actually disconnect', () => {
  const settings = document.implementation.createHTMLDocument('Sample settings')
  const box = settings.createElement('div')
  settings.body.append(box)
  expect(syncModalClosed(box)).toBe(false)
  box.remove()
  expect(syncModalClosed(box)).toBe(true)
})

it('selects a folder by its scope kind even when the host renders an open-folder icon', async () => {
  const box = document.createElement('div')
  box.className = 'abele-share-picker'
  const input = document.createElement('input')
  const list = document.createElement('div')
  list.className = 'abele-share-picker__results'
  const row = document.createElement('div')
  row.className = 'suggestion-item'
  row.dataset.shareKind = 'folder'
  row.dataset.sharePath = 'Garden/Flowers'
  row.textContent = 'Flowers'
  const icon = document.createElement('span')
  icon.className = 'lucide-folder-open'
  row.append(icon)
  const nested = document.createElement('div')
  nested.className = 'suggestion-item'
  nested.dataset.shareKind = 'folder'
  nested.dataset.sharePath = 'Garden/Flowers/Nested'
  nested.textContent = 'Nested Garden/Flowers'
  list.append(nested, row)
  box.append(input, list)
  document.body.append(box)
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    top: 200,
    bottom: 240,
    height: 40,
  } as DOMRect)
  const clicked = vi.fn()
  row.addEventListener('click', clicked)
  const poll = async (fn: () => boolean) => {
    if (!(await fn())) throw new Error('Picker condition failed')
  }
  try {
    await new Function(
      'box',
      'poll',
      'typeInto',
      SHARE_SET_PICKER + ';return pickShareItem(box, "Folder: Garden/Flowers", false)'
    )(box, poll, (field: HTMLInputElement, value: string) => {
      field.value = value
    })
    expect(clicked).toHaveBeenCalledOnce()
  } finally {
    box.remove()
  }
})

it('captures the Share sheet HTML, rendering flags and typed query during a picker wait', () => {
  const sheet = document.createElement('div')
  sheet.className = 'modal'
  const picker = document.createElement('div')
  picker.className = 'abele-share-picker'
  Object.assign(picker.dataset, {
    sharePickerMode: 'inline',
    platformPhone: 'false',
    platformMobile: 'true',
    sourceCount: '1',
    sourcePaths: JSON.stringify(['Garden/Flowers']),
    sourceMatches: JSON.stringify(['Garden/Flowers']),
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
        inlineRowDetails: [
          {
            text: 'Flowers',
            kind: null,
            box: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
            keyboardTop: window.innerHeight,
            fullyAboveKeyboard: false,
          },
        ],
        source: { count: 1, firstPaths: ['Garden/Flowers'], matchingPaths: ['Garden/Flowers'] },
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
