import { expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { nativeInputProbe } from './helpers/nativeInput'
import { wideScript } from './helpers/chatScrollWide'
import { targets } from './helpers/target'

targets('desktop')

it.runIf(isObsidianRunning() && hasTestApi())(
  'keeps visible rows while wheeling up a wide compact chat',
  async () => {
    const size = evalJson<number[]>(
      "require('@electron/remote').getCurrentWindow().getContentSize()"
    )
    const zoom = evalJson<number>(
      "require('@electron/remote').getCurrentWebContents().getZoomFactor()"
    )
    try {
      // The display can clamp the native window height. Keep the CSS viewport
      // large enough for the wide pane without changing gesture or pixel budgets.
      evalRaw("require('@electron/remote').getCurrentWebContents().setZoomFactor(0.8)")
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(2000, 1100)")
      const report = JSON.parse(await evalLong(nativeInputProbe(wideScript()), 90_000))
      console.info('wide-scroll-matrix', JSON.stringify(report))
      expect(report.error).toBeUndefined()
      expect(report.width).toBeGreaterThanOrEqual(1450)
      expect(report.width).toBeLessThanOrEqual(1550)
      expect(report.height).toBeGreaterThanOrEqual(800)
      expect(report.startGap).toBeLessThanOrEqual(2)
      expect(report.collapsedRuns).toBeGreaterThan(0)
      expect(report.wideSteps.length).toBeGreaterThan(20)
      for (let pass = 0; pass < 3; pass++) {
        for (const delta of [-40, 40]) {
          expect(
            report.wideSteps.filter(
              (step: { pass: number; delta: number }) => step.pass === pass && step.delta === delta
            ).length
          ).toBeGreaterThan(20)
        }
      }
      expect(report.missing).toEqual([])
      expect(report.wideDrift).toBeLessThanOrEqual(2)
    } finally {
      evalRaw(`require('@electron/remote').getCurrentWebContents().setZoomFactor(${zoom})`)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
    }
  },
  120_000
)
