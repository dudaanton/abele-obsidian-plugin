/** Native-input regression matrix. Each row emits measurements, including failed invariants. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  enterPhone,
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './obsidianCli'
import { nativeInputProbe, withNativeInput } from './nativeInput'
import { fitSidebarInputWidths } from './sidebarInputViewport'

const available = isObsidianRunning() && hasTestApi()
import { inputProbe, script, states, type Report } from './chatScrollMatrix'
// Optional focused reruns keep the unfiltered matrix as the final qualification.
export function chatScrollMatrixSuite(filter?: string, frameBudgetMs?: number, idleMs = 0) {
  const selected = (phone: boolean, size: string, state: string) =>
    !filter || new RegExp(filter).test(`${phone ? 'touch' : 'wheel'}/${size}/${state}`)

  describe.runIf(available)('continuous chat scrolling matrix', () => {
    for (const phone of [false, true]) {
      if (
        !['short', 'medium', 'long'].some((size) =>
          states.some((state) => selected(phone, size, state))
        )
      )
        continue
      describe(phone ? 'emulated phone' : 'desktop', () => {
        let originalSize: [number, number]
        let sidebarSizes: number[] | undefined
        beforeAll(async () => {
          if (phone) {
            originalSize = evalJson<[number, number]>(
              `require('@electron/remote').getCurrentWindow().getContentSize()`
            )
            await enterPhone(390, 844)
          } else {
            // Native scrollbar input needs the whole pane inside the viewport,
            // including when a saved wide sidebar outlives a larger test window.
            sidebarSizes = evalJson<number[]>(
              `JSON.stringify((${fitSidebarInputWidths.toString()})([app.workspace.leftSplit, app.workspace.rightSplit], innerWidth))`
            )
          }
          const input = await withNativeInput(
            async () =>
              JSON.parse(await evalLong(inputProbe(phone), 15_000)) as {
                moved: number
                explicitLarge: { requested: number; moved: number }[]
              }
          )
          console.info('scroll-native-control', JSON.stringify({ phone, ...input }))
          expect(input.moved, 'native input must move an ordinary scroll box').toBeGreaterThan(50)
          for (const control of input.explicitLarge)
            expect(
              Math.abs(control.requested - control.moved),
              'explicit native touch travel'
            ).toBeLessThanOrEqual(24)
        }, 180_000)
        afterAll(async () => {
          if (!phone) {
            if (sidebarSizes)
              evalRaw(
                `([app.workspace.leftSplit, app.workspace.rightSplit]).forEach((split, i) => split.setSize(${JSON.stringify(sidebarSizes)}[i]))`
              )
            return
          }
          try {
            await reloadApp('app.emulateMobile(false)')
          } finally {
            if (originalSize)
              evalRaw(
                `require('@electron/remote').getCurrentWindow().setContentSize(${originalSize[0]}, ${originalSize[1]})`
              )
          }
        }, 180_000)
        for (const size of ['short', 'medium', 'long']) {
          const cases = states.filter((state) => selected(phone, size, state))
          if (!cases.length) continue
          for (const state of cases) {
            const longTouchText = phone && size === 'long' && state === 'text'
            it(
              `${phone ? 'touch' : 'wheel'} / ${size} / ${state}`,
              async () => {
                const probe = () =>
                  evalLong(
                    nativeInputProbe(script(size, state, phone, idleMs)),
                    longTouchText ? 390_000 : 300_000
                  ).then((result) => JSON.parse(result) as Report)
                const result = await probe()
                console.log('scroll-matrix', JSON.stringify({ phone, size, state, ...result }))
                if (frameBudgetMs !== undefined)
                  expect.soft(result.maxInputFrameMs).toBeLessThanOrEqual(frameBudgetMs)
                if (idleMs) expect.soft(result.idleLongTasks).toEqual([])
                expect.soft(result.error).toBeUndefined()
                expect.soft(result.rows).toHaveLength(13)
                if (size === 'short') expect.soft(result.initialPages).toBeLessThanOrEqual(1)
                if (size === 'medium') {
                  expect.soft(result.initialPages).toBeGreaterThanOrEqual(1.5)
                  expect.soft(result.initialPages).toBeLessThanOrEqual(2.5)
                }
                if (state !== 'idle') expect.soft(result.streamMs).toBeGreaterThanOrEqual(5000)
                if (size === 'long') expect.soft(result.evicted).toBe(true)
                for (const row of result.rows) {
                  for (const gesture of row.gestures ?? [])
                    expect
                      .soft(gesture.receivedInputs, row.move + ' native input receipt')
                      .toBeGreaterThan(0)
                  expect.soft(row.samples, row.move).toBeGreaterThan(0)
                  if (row.drift !== null) expect.soft(row.drift, row.move + ' A').toBeLessThan(2)
                  expect.soft(row.blank, row.move + ' B').toBeLessThanOrEqual(2)
                  if (row.bottomGap !== null)
                    expect.soft(row.bottomGap, row.move + ' C').toBeLessThan(2)
                  if (row.destination !== null)
                    expect.soft(row.destination, row.move + ' E').toBe(true)
                  expect.soft(row.reversals, row.move + ' F').toBe(0)
                  expect
                    .soft(row.lost, row.move + ' F: gesture distance')
                    .toBeLessThanOrEqual(phone ? 24 : 2)
                }
              },
              longTouchText ? 420_000 : 360_000
            )
          }
        }
      })
    }
  })
}
