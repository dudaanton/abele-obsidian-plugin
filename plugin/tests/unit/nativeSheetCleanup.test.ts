import { expect, it, vi } from 'vitest'
import { dismissNativeSheet, withNativeSheetCleanup } from '../e2e/helpers/nativeSheetCleanup'

const absent = JSON.stringify({ alert: null })
const sheet = JSON.stringify({ text: ['sample archive'], buttons: ['Copy', 'Close'] })
const pause = async (_ms: number) => {}

it('dismisses the native preview and verifies absence after the dismissal animation', async () => {
  const replies = [sheet, 'dismissed', sheet, absent, absent, absent]
  const run = vi.fn((_args: string[]) => replies.shift()!)
  await dismissNativeSheet(run, pause)
  expect(run.mock.calls).toEqual([
    [['alert']],
    [['alert', 'Close']],
    [['alert']],
    [['alert']],
    [['alert']],
    [['alert']],
  ])
})

it('still dismisses and verifies a sheet when opening the attachment fails', async () => {
  const run = vi.fn((args: string[]) => (args.length > 1 ? 'dismissed' : absent))
  run.mockReturnValueOnce(sheet)
  const failure = new Error('opening failed')
  await expect(
    withNativeSheetCleanup(
      async () => {
        throw failure
      },
      run,
      pause
    )
  ).rejects.toBe(failure)
  expect(run).toHaveBeenCalledWith(['alert', 'Close'])
  expect(run.mock.calls.at(-1)).toEqual([['alert']])
})

it('waits for a late sheet instead of accepting the first empty observation', async () => {
  const replies = [absent, sheet, 'dismissed', absent, absent, absent]
  const run = vi.fn((_args: string[]) => replies.shift()!)
  await dismissNativeSheet(run, pause)
  expect(run).toHaveBeenCalledWith(['alert', 'Close'])
  expect(replies).toEqual([])
})

it('fails if the sheet remains after its close action', async () => {
  const run = vi.fn((_args: string[]) => sheet)
  await expect(dismissNativeSheet(run, pause)).rejects.toThrow('Native sheet remains')
  expect(run.mock.calls.filter(([args]) => args.length > 1)).toHaveLength(1)
})

it('never selects a sharing action when no dismiss button is available', async () => {
  const run = vi.fn((_args: string[]) => JSON.stringify({ buttons: ['Copy', 'Save to Files'] }))
  await expect(dismissNativeSheet(run, pause)).rejects.toThrow('dismiss button')
  expect(run.mock.calls).toEqual([[['alert']]])
})

it('does not treat an invalid driver reply as a dismissed sheet', async () => {
  await expect(dismissNativeSheet(() => 'invalid reply', pause)).rejects.toThrow()
})

it('preserves a successful result and verifies an already-clear screen', async () => {
  const run = vi.fn((_args: string[]) => absent)
  const value = { downloaded: true }
  expect(await withNativeSheetCleanup(async () => value, run, pause)).toBe(value)
  expect(run.mock.calls).toEqual([[['alert']], [['alert']], [['alert']]])
})

it('retains the original failure if native cleanup also fails', async () => {
  const failure = new Error('opening failed')
  const result = await withNativeSheetCleanup(
    async () => {
      throw failure
    },
    () => sheet,
    pause
  ).catch((error) => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect(result.errors[0]).toBe(failure)
  expect(result.errors[1].message).toContain('Native sheet remains')
})
