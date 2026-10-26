// @vitest-environment node
import { expect, it } from 'vitest'
import { fileExpectations, oversizedEvidence, pauseWriteMetrics } from '../scale/refusals.mjs'
import { budgets, pauseMetrics } from '../scale/oracles.mjs'

it('retains oversized files and selects the largest allowed multipart target from advertised limits', () => {
  const files = [
    { path: 'a', size: 256, sha: 'big' },
    { path: 'b', size: 192, sha: 'fit' },
    { path: 'c', size: 128, sha: 'small' },
  ]
  const result = fileExpectations(files, { max_file_bytes: 200 })
  expect(result.oversized).toEqual([files[0]])
  expect(result.transfer).toEqual(files.slice(1))
  expect(result.interruptionTarget).toEqual(files[1])
  expect(files).toHaveLength(3)
})

it('requires exact visible size reasons in both status and log, intact primary, no repeated attempts and no synced claim', () => {
  const file = { path: 'Attachments/sample.pdf', size: 256, sha: 'abc' }
  const snapshots = [
    {
      at: 1,
      snapshot: { rows: [{ status: 'attention' }], visibleStatus: [{ text: '1 file not synced' }] },
      activity: [
        {
          refused: [{ path: file.path, reason: 'File too large' }],
          events: [{ text: `too_large: ${file.path}` }],
        },
      ],
    },
  ]
  expect(oversizedEvidence([file], [file], snapshots, []).every((row) => row.pass)).toBe(true)
  const idle = [
    {
      ...snapshots[0],
      snapshot: { rows: [{ status: 'idle' }], visibleStatus: [{ text: 'Synced' }] },
    },
  ]
  expect(oversizedEvidence([file], [file], idle, [])[0].pass).toBe(false)
  expect(oversizedEvidence([file], [], snapshots, [])[0].pass).toBe(false)
  expect(
    oversizedEvidence(
      [file],
      [file],
      [
        {
          ...snapshots[0],
          activity: [
            {
              refused: snapshots[0].activity[0].refused,
              events: [{ text: 'too_large: another.pdf' }],
            },
          ],
        },
      ],
      []
    )[0].pass
  ).toBe(false)
  expect(
    oversizedEvidence(
      [file],
      [file],
      [
        {
          ...snapshots[0],
          activity: [
            {
              refused: snapshots[0].activity[0].refused,
              events: [{ text: `too_large: ${file.path}-different` }],
            },
          ],
        },
      ],
      []
    )[0].pass
  ).toBe(false)
  const starts = [1, 2].map((id) => ({
    id,
    device: '0',
    event: 'start',
    method: 'POST',
    route: '/v2/uploads/abc/begin',
  }))
  expect(oversizedEvidence([file], [file], snapshots, starts)[0]).toMatchObject({
    attempts: 2,
    pass: false,
  })
  const acrossRestart = starts.map((e, i) => ({ ...e, at: 10 + i * 20 }))
  expect(
    oversizedEvidence([file], [file], snapshots, acrossRestart, [
      { kind: 'kill mid-large-file', at: 20 },
    ])[0]
  ).toMatchObject({ attempts: 2, maxAttemptsPerGeneration: 1, pass: true })
})

it('admits only the approved pause grace and requires a healthy write observer with no late writes', () => {
  const measured = pauseMetrics(
    [
      { event: 'start', id: 1, at: 1002, method: 'GET', route: '/v2/files/sample/content' },
      { event: 'close', id: 1, at: 1003 },
    ],
    1000,
    new Set(),
    new Set(),
    3500
  )
  expect(measured.pauseNewRequests).toBe(1)
  expect(
    budgets({ ...measured, pauseWriteBytesAfterGrace: 0, pauseWriteOperationsAfterGrace: 0 })
      .filter((row) => row.name.startsWith('pause'))
      .every((row) => row.status === 'PASS')
  ).toBe(true)
  expect(
    budgets({
      ...measured,
      pauseLastRequestMs: 101,
      pauseWriteBytesAfterGrace: 0,
      pauseWriteOperationsAfterGrace: 0,
    }).find((row) => row.name === 'pause request grace').status
  ).toBe('FAIL')
  expect(pauseWriteMetrics([], '1', 1000, 3500).pauseWriteBytesAfterGrace).toBeUndefined()
  const ready = { event: 'write-observer-ready', generation: 'sample', device: '1', at: 900 }
  expect(pauseWriteMetrics([ready], '1', 1000, 3500).pauseWriteBytesAfterGrace).toBe(0)
  const writes = [
    ready,
    {
      event: 'write-start',
      generation: 'sample',
      id: 1,
      device: '1',
      at: 1090,
      path: 'sample.md',
      bytes: 4,
    },
    { event: 'write-finish', generation: 'sample', id: 1, device: '1', at: 1101 },
  ]
  expect(pauseWriteMetrics(writes, '1', 1000, 3500)).toMatchObject({
    pauseWriteBytesAfterGrace: 4,
    pauseWriteOperationsAfterGrace: 1,
  })
})

it('counts the final synced restart as a generation without allowing retries inside it', () => {
  const file = { path: 'Attachments/sample.bin', size: 256, sha: 'abc' }
  const state = [
    {
      snapshot: { rows: [{ status: 'attention' }], visibleStatus: [{ text: '1 file not synced' }] },
      activity: [
        {
          refused: [{ path: file.path, reason: 'too large' }],
          events: [{ text: `too_large: ${file.path}` }],
        },
      ],
    },
  ]
  const attempts = [10, 30, 40].map((at, id) => ({
    at,
    id,
    device: '0',
    event: 'start',
    method: 'POST',
    route: '/v2/uploads/abc/begin',
  }))
  expect(oversizedEvidence([file], [file], state, attempts.slice(0, 2), [], 20)[0]).toMatchObject({
    attempts: 2,
    maxAttemptsPerGeneration: 1,
    pass: true,
  })
  expect(oversizedEvidence([file], [file], state, attempts, [], 20)[0]).toMatchObject({
    attempts: 3,
    maxAttemptsPerGeneration: 2,
    pass: false,
  })
})

it('excludes proven host persistence during pause but retains sync writes to the same path', () => {
  const ready = { event: 'write-observer-ready', generation: 'sample', device: '1', at: 900 }
  const write = {
    event: 'write-start',
    generation: 'sample',
    device: '1',
    id: 1,
    at: 1200,
    path: '.obsidian/workspace.json',
    bytes: 4,
    stack:
      'Error\n at wrapped (/fixture/scale-observer/writes.cjs:1:1)\n at save (app://obsidian.md/app.js:1:1)',
  }
  const host = pauseWriteMetrics([ready, write], '1', 1000, 3500)
  expect(host.pauseWriteBytesAfterGrace).toBe(0)
  expect(host.pauseHostWritesAfterGrace).toEqual([write])
  expect(budgets(host).find((row) => row.name === 'pause vault writes').status).toBe('PASS')
  for (const stack of [
    write.stack + '\n at persist (plugin:abele:1:1)',
    'Error\n at save (https://example.invalid/app.js:1:1)',
    undefined,
  ]) {
    const sync = pauseWriteMetrics([ready, { ...write, stack }], '1', 1000, 3500)
    expect(sync.pauseWriteBytesAfterGrace).toBe(4)
    expect(budgets(sync).find((row) => row.name === 'pause vault writes').status).toBe('FAIL')
  }
  expect(
    pauseWriteMetrics([ready, { ...write, path: 'sample.md' }], '1', 1000, 3500)
      .pauseWriteBytesAfterGrace
  ).toBe(4)
})

it('requires observed zero sync content bytes on restart and never exempts an unknown read', async () => {
  const { restartReadMetrics } = await import('../scale/refusals.mjs')
  const ready = { event: 'content-read-ready', device: '0', generation: 'sample', at: 101 }
  const start = {
    event: 'content-read-start',
    device: '0',
    generation: 'sample',
    id: 1,
    at: 102,
    path: 'fixture/sample.md',
    source: 'host',
  }
  const finish = {
    event: 'content-read-finish',
    device: '0',
    generation: 'sample',
    id: 1,
    at: 103,
    bytes: 4,
  }
  expect(restartReadMetrics([ready], '0', 100, 200)).toMatchObject({ complete: true, syncBytes: 0 })
  expect(restartReadMetrics([ready, start, finish], '0', 100, 200)).toMatchObject({
    complete: true,
    syncBytes: 0,
    hostBytes: 4,
  })
  expect(
    restartReadMetrics([ready, { ...start, source: 'abele' }, finish], '0', 100, 200)
  ).toMatchObject({ complete: true, syncBytes: 4 })
  expect(
    restartReadMetrics([ready, { ...start, source: 'unknown' }, finish], '0', 100, 200).complete
  ).toBe(false)
  expect(restartReadMetrics([ready, { ...start, source: 'abele' }], '0', 100, 200).complete).toBe(
    false
  )
  expect(restartReadMetrics([ready, start], '0', 100, 200)).toMatchObject({
    complete: true,
    syncBytes: 0,
  })
  expect(restartReadMetrics([], '0', 100, 200).complete).toBe(false)
  expect(
    restartReadMetrics([ready, { event: 'renderer-start', device: '0', at: 150 }], '0', 100, 200)
      .complete
  ).toBe(false)
})

it('recognizes host workspace persistence through an adapter wrapper without exempting plugin-only writes', async () => {
  const writes = (await import('../scale/writes.cjs')).default
  const stack =
    'Error\n at wrapped (/fixture/scale-observer/writes.cjs:1:1)\n at mutate (plugin:abele:1:1)\n at ChangeTracker.around (plugin:abele:1:1)\n at e.eval [as write] (plugin:abele:1:1)\n at save (app://obsidian.md/app.js:1:1)'
  expect(writes.isHostPersistence({ path: '.obsidian/workspace.json', stack })).toBe(true)
  expect(writes.isHostPersistence({ path: 'sample.md', stack })).toBe(false)
  expect(
    writes.isHostPersistence({
      path: '.obsidian/workspace.json',
      stack: 'Error\n at persist (plugin:abele:1:1)',
    })
  ).toBe(false)
})

it('judges synced claims from visible words rather than internal idle rows', async () => {
  const { visibleSyncedClaim } = await import('../scale/refusals.mjs')
  expect(
    visibleSyncedClaim({
      rows: [{ status: 'idle' }],
      visibleStatus: [{ text: '1 file not synced' }],
    })
  ).toBe(false)
  expect(
    visibleSyncedClaim({ rows: [{ status: 'attention' }], visibleStatus: [{ text: 'Synced' }] })
  ).toBe(true)
  expect(visibleSyncedClaim({ visibleStatus: [{ text: 'Syncing 12 files' }] })).toBe(false)
  expect(visibleSyncedClaim({})).toBe(null)
})

it('requires visible labels for connected snapshots without treating pre-connection emptiness as a claim', () => {
  const file = { path: 'sample.bin', size: 256, sha: 'abc' }
  const connected = {
    snapshot: { rows: [{ status: 'idle' }], visibleStatus: [{ text: '1 file not synced' }] },
    activity: [
      {
        refused: [{ path: file.path, reason: 'too large' }],
        events: [{ text: 'too_large: sample.bin' }],
      },
    ],
  }
  const disconnected = { snapshot: { rows: [], engines: [], visibleStatus: [] }, activity: [] }
  expect(oversizedEvidence([file], [file], [disconnected, connected], [])[0].pass).toBe(true)
  expect(
    oversizedEvidence(
      [file],
      [file],
      [{ ...connected, snapshot: { rows: [{ status: 'idle' }] } }],
      []
    )[0].pass
  ).toBe(false)
  expect(oversizedEvidence([file], [file], [disconnected], [])[0].pass).toBe(false)
})

it('recognizes the full visible completion label', async () => {
  const { visibleSyncedClaim } = await import('../scale/refusals.mjs')
  expect(visibleSyncedClaim({ visibleStatus: [{ text: 'Fully synced' }] })).toBe(true)
})

it('distinguishes an observed empty screen from missing status evidence', async () => {
  const { visibleSyncedClaim } = await import('../scale/refusals.mjs')
  expect(visibleSyncedClaim({ visibleStatus: [] })).toBe(false)
  expect(visibleSyncedClaim({})).toBe(null)
})

it('does not exempt a plugin workspace mutation just because a host callback follows it', async () => {
  const writes = (await import('../scale/writes.cjs')).default
  const stack = 'Error\n at persist (plugin:abele:1:1)\n at dispatch (app://obsidian.md/app.js:1:1)'
  expect(writes.isHostPersistence({ path: '.obsidian/workspace.json', stack })).toBe(false)
})

it('keeps a plugin eval caller outside the adapter write boundary', async () => {
  const writes = (await import('../scale/writes.cjs')).default
  const stack =
    'Error\n at mutate (plugin:abele:1:1)\n at ChangeTracker.around (plugin:abele:1:1)\n at e.eval [as write] (plugin:abele:1:1)\n at eval (plugin:abele:1:1)\n at dispatch (app://obsidian.md/app.js:1:1)'
  expect(writes.isHostPersistence({ path: '.obsidian/workspace.json', stack })).toBe(false)
})
