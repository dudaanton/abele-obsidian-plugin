import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  enterPhone,
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import {
  endScript,
  followScript,
  handoffScript,
  states,
  type Report,
} from './helpers/chatScrollMatrix'
import { nativeInputProbe } from './helpers/nativeInput'
import { targets } from './helpers/target'

targets('desktop')
describe.runIf(isObsidianRunning() && hasTestApi())('End from earlier chat history', () => {
  for (const phone of [false, true])
    describe(phone ? 'emulated phone' : 'desktop', () => {
      let size: [number, number]
      beforeAll(async () => {
        if (!phone) return
        size = evalJson<[number, number]>(
          `require('@electron/remote').getCurrentWindow().getContentSize()`
        )
        await enterPhone(390, 844)
      }, 180_000)
      afterAll(async () => {
        if (!phone) return
        try {
          await reloadApp('app.emulateMobile(false)')
        } finally {
          if (size)
            evalRaw(
              `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
            )
        }
      }, 180_000)
      for (const length of ['short', 'medium', 'long'])
        it.each(states)(
          `${length} / %s`,
          async (state) => {
            const report = JSON.parse(
              await evalLong(nativeInputProbe(endScript(length, state, phone)), 60_000)
            ) as Report
            console.info(
              'scroll-end-matrix',
              JSON.stringify({ phone, size: length, state, ...report })
            )
            expect.soft(report.error).toBeUndefined()
            expect.soft(report.rows).toHaveLength(3)
            if (length === 'long') expect.soft(report.evicted).toBe(true)
            const end = report.rows.find((row) => row.move === 'End from history')
            expect.soft(end?.destination).toBe(true)
            expect.soft(end?.bottomGap).toBeLessThan(2)
            for (const row of report.rows) {
              expect.soft(row.samples, row.move).toBeGreaterThan(0)
              expect.soft(row.blank, row.move).toBeLessThanOrEqual(2)
            }
          },
          120_000
        )
      it('follows later streamed lines after returning to the tail', async () => {
        const report = JSON.parse(
          await evalLong(nativeInputProbe(followScript(phone)), 120_000)
        ) as Report
        console.info('scroll-follow-matrix', JSON.stringify({ phone, ...report }))
        expect(report.error).toBeUndefined()
        expect(report.evicted).toBe(true)
        const resumed = report.rows.find((row) => row.move === 'resume with new lines')
        expect(resumed?.heightGain).toBeGreaterThan(0)
        expect(resumed?.bottomGap).toBeLessThan(2)
        expect(resumed?.destination).toBe(true)
        for (const row of report.rows) {
          expect.soft(row.blank, row.move).toBeLessThanOrEqual(2)
          expect.soft(row.reversals, row.move).toBe(0)
          expect.soft(row.lost, row.move).toBeLessThanOrEqual(phone ? 24 : 2)
        }
      }, 180_000)
      it('keeps a full-window reply readable across completion', async () => {
        const report = JSON.parse(
          await evalLong(nativeInputProbe(handoffScript(phone)), 60_000)
        ) as Report
        console.info('scroll-handoff-matrix', JSON.stringify({ phone, ...report }))
        expect.soft(report.error).toBeUndefined()
        expect.soft(report.fullWindow).toBe(true)
        expect.soft(report.readingStream).toBe(true)
        expect.soft(report.keptReading).toBe(true)
        const completed = report.rows.find((row) => row.move === 'complete while reading')
        expect.soft(completed?.destination).toBe(true)
        expect.soft(completed?.drift).toBeLessThan(2)
        for (const row of report.rows) {
          expect.soft(row.samples, row.move).toBeGreaterThan(0)
          expect.soft(row.blank, row.move).toBeLessThanOrEqual(2)
        }
      }, 120_000)
    })
})
