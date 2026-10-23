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
      snapshot: { rows: [{ status: 'attention' }] },
      activity: [
        {
          refused: [{ path: file.path, reason: 'File too large' }],
          events: [{ text: `too_large: ${file.path}` }],
        },
      ],
    },
  ]
  expect(oversizedEvidence([file], [file], snapshots, []).every((row) => row.pass)).toBe(true)
  const idle = [{ ...snapshots[0], snapshot: { rows: [{ status: 'idle' }] } }]
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
