import { expect, it, vi } from 'vitest'
import { SyncStartupTimeline, timedSyncTransport } from '@/sync/startupTimeline'

it('records each startup phase once and replays early phases with their original time', () => {
  let elapsed = 100
  let wall = 1000
  const timeline = new SyncStartupTimeline(
    () => elapsed,
    () => wall
  )
  timeline.mark('onload')
  elapsed = 325
  wall = 1225
  timeline.mark('db-open')
  const first: unknown[] = []
  const unsubscribe = timeline.subscribe((mark) => first.push(mark))
  elapsed = 350
  wall = 1250
  timeline.mark('db-open')
  timeline.mark('layout-ready')
  expect(first).toEqual([
    { phase: 'onload', elapsedMs: 0, at: 1000 },
    { phase: 'db-open', elapsedMs: 225, at: 1225 },
    { phase: 'layout-ready', elapsedMs: 250, at: 1250 },
  ])
  unsubscribe()
  timeline.mark('engine-construct')
  expect(first).toHaveLength(3)
})

it('closes a failed preparation span without hiding the failure', async () => {
  const timeline = new SyncStartupTimeline(
    () => 0,
    () => 0
  )
  const phases: string[] = []
  timeline.subscribe((mark) => phases.push(mark.phase))
  timeline.mark('layout-ready')
  await expect(
    timeline.stage('connection', 'Checking recovery records', async () => {
      throw new Error('sample failure')
    })
  ).rejects.toThrow('sample failure')
  expect(phases).toEqual([
    'layout-ready',
    'connection:Checking recovery records:begin',
    'connection:Checking recovery records:end',
  ])
})

it('keeps diagnostics subscribers from delaying a startup request when one fails', async () => {
  const timeline = new SyncStartupTimeline(
    () => 0,
    () => 1000
  )
  const received: string[] = []
  timeline.subscribe(() => {
    throw new Error('activity unavailable')
  })
  timeline.subscribe((mark) => received.push(mark.phase))
  const request = vi.fn(async () => new Response()) as typeof fetch
  await expect(
    timedSyncTransport(request, timeline)('https://sample.invalid')
  ).resolves.toBeInstanceOf(Response)
  expect(request).toHaveBeenCalledOnce()
  expect(received).toEqual(['first-request', 'first-response'])
})

it('marks the first request and first actual response across an early transport failure', async () => {
  let elapsed = 0
  const timeline = new SyncStartupTimeline(
    () => elapsed,
    () => 2000 + elapsed
  )
  timeline.mark('onload')
  const marks: string[] = []
  timeline.subscribe((mark) => marks.push(`${mark.phase}:${mark.elapsedMs}`))
  let reject!: (error: Error) => void
  let calls = 0
  const request = vi.fn(() =>
    ++calls === 1
      ? new Promise<Response>((_resolve, fail) => (reject = fail))
      : Promise.resolve(new Response())
  ) as typeof fetch
  const transport = timedSyncTransport(request, timeline)
  elapsed = 400
  const pending = transport('https://sample.invalid/v2/connection').catch(() => undefined)
  expect(marks).toContain('first-request:400')
  elapsed = 430
  reject(new Error('offline'))
  await pending
  expect(marks).not.toContain('first-response:430')
  elapsed = 500
  await transport('https://sample.invalid/v2/connection').catch(() => undefined)
  expect(marks.filter((one) => one.startsWith('first-'))).toEqual([
    'first-request:400',
    'first-response:500',
  ])
})
