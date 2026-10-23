import { expect, it, vi } from 'vitest'
import { NodeLogModel } from '@/node/NodeLogModel'
import { NodeLogSnapshots } from '@/node/NodeLogSnapshots'
import { nodeLogAvailable } from '@/node/nodeLogCapability'

it('remembers log support only within the same authorization and replaces it on a new welcome', () => {
  const connection = { authorizationGeneration: 1, client: { channel: undefined as unknown } }
  expect(nodeLogAvailable(connection)).toBe(false)
  connection.client.channel = { channel: { welcome: { methods: ['node.log.v1.tail'] } } }
  expect(nodeLogAvailable(connection)).toBe(true)
  connection.client.channel = undefined
  expect(nodeLogAvailable(connection)).toBe(true)
  connection.authorizationGeneration++
  expect(nodeLogAvailable(connection)).toBe(false)
  connection.client.channel = { channel: { welcome: { methods: [] } } }
  expect(nodeLogAvailable(connection)).toBe(false)
})

it('rejects a late disconnected read and allows a fresh reconnect read', async () => {
  let answer!: (value: unknown) => void
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    .mockResolvedValue({ lines: [], truncated: false, files: [] })
  const model = new NodeLogModel({ online: () => true, read })
  const oldRead = model.refresh()
  model.connectionChanged(false)
  model.connectionChanged(true)
  await Promise.resolve()
  answer({
    lines: [{ time: null, level: 'info', text: 'Stale transport entry', source: 'stdout' }],
    truncated: false,
    files: [],
  })
  await oldRead
  expect(read).toHaveBeenCalledTimes(2)
  expect(model.lines.value).toEqual([])
  model.destroy()
})

it('keeps offline snapshots separate across nodes and authorization generations', () => {
  const snapshots = new NodeLogSnapshots(),
    first = {},
    second = {}
  const lines = [
    { time: null, level: 'info' as const, text: 'Sample evidence', source: 'stdout' as const },
  ]
  snapshots.remember(first, 1, lines, '0.4.50')
  expect(snapshots.read(first, 1)?.lines[0]?.text).toBe('Sample evidence')
  expect(snapshots.read(second, 1)).toBeUndefined()
  expect(snapshots.read(first, 2)).toBeUndefined()
  lines[0]!.text = 'Changed caller data'
  expect(snapshots.read(first, 1)?.lines[0]?.text).toBe('Sample evidence')
})

it('keeps loaded evidence offline, filters locally, and ignores a closed window read', async () => {
  let online = true
  const read = vi.fn().mockResolvedValue({
    lines: [
      { time: '2025-01-01T10:00:02Z', level: 'debug', text: 'Sample detail', source: 'stdout' },
      { time: '2025-01-01T10:00:01Z', level: 'warn', text: 'Sample warning', source: 'stderr' },
      { time: '2025-01-01T10:00:03Z', level: 'error', text: 'Sample failure', source: 'stderr' },
    ],
    truncated: false,
    files: [],
  })
  const model = new NodeLogModel({ read, online: () => online }, Date.parse('2025-01-01T10:00:03Z'))
  await model.refresh()
  expect(read).toHaveBeenCalledWith({ limit: 200 })
  expect(model.lines.value.map((l) => l.text)).toEqual([
    'Sample warning',
    'Sample detail',
    'Sample failure',
  ])
  expect(model.marked.value).toBe('2025-01-01T10:00:03Z')
  model.level.value = 'warn'
  expect(model.shown.value).toHaveLength(2)
  expect(model.copyText()).not.toContain('Sample detail')
  online = false
  await model.refresh()
  expect(read).toHaveBeenCalledTimes(1)
  expect(model.lines.value).toHaveLength(3)
  online = true
  let answer!: (value: unknown) => void
  read.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve
      })
  )
  const pending = model.refresh()
  model.destroy()
  answer({ lines: [], truncated: false, files: [] })
  await pending
  expect(model.lines.value).toHaveLength(3)
})

it('retains untimed lines without highlighting them and exposes truncation and missing logs', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      lines: [{ time: null, level: 'unknown', text: 'Sample untimed line', source: 'stdout' }],
      truncated: true,
      files: [],
    })
    .mockResolvedValueOnce({
      lines: [],
      truncated: false,
      reason: 'logs_missing',
      files: [{ source: 'stdout', truncated: false, reason: 'missing' }],
    })
  const model = new NodeLogModel({ online: () => true, read }, Date.now())
  await model.refresh()
  expect(model.marked.value).toBeUndefined()
  expect(model.truncated.value).toBe(true)
  model.level.value = 'warn'
  expect(model.shown.value).toHaveLength(0)
  await model.refresh()
  expect(model.reason.value).toBe('logs_missing')
  model.destroy()
})
