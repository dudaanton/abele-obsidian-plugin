/** File paths stay at the tab scroller's top; links and native line jumps stay below them. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { diffHash } from './helpers/fakeGithubRepo'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('github-sticky')

for (const mobile of [false, true]) {
  describe.skipIf(!available || (onPhone() && !mobile))(
    `GitHub sticky file paths (${mobile ? 'phone layout' : 'desktop'})`,
    () => {
      let gh: FakeGithub
      let size: [number, number]
      beforeAll(async () => {
        if (mobile && !onPhone()) {
          size = evalJson(`[...require('@electron/remote').getCurrentWindow().getContentSize()]`)
          evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
          await reloadApp('app.emulateMobile(true)')
        }
        gh = await startFakeGithub()
        enableGithub(gh.origin, !mobile)
      }, 120_000)
      afterAll(async () => {
        try {
          restoreGithub()
        } finally {
          gh?.stop()
          if (size) {
            evalRaw(
              `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
            )
            await reloadApp('app.emulateMobile(false)')
          }
        }
      }, 120_000)

      it.each(['blob', 'diff'])(
        '%s: scrolling pins the path and line jumps clear it',
        (kind) => {
          const url =
            kind === 'blob'
              ? `${gh.web}/blob/main/src/long.ts#L120`
              : `${gh.web}/pull/42/files#diff-${diffHash('src/long.ts')}R150`
          const report = evalAsync<{
            phone: boolean
            anchorGap: number
            anchorVisible: boolean
            nativeGap: number
            positions: number[]
            movement: number
            background: string
            hitHeader: boolean
            sideways: number
          }>(
            `(async () => {
          ${PRELUDE}
          const leaf = await openTab(${JSON.stringify(url)}, false)
          await app.workspace.revealLeaf(leaf)
          try {
            const root = leaf.view.containerEl
            const main = root.querySelector('.abele-github-layout__main')
            const selector = ${JSON.stringify(kind === 'blob' ? '.abele-github-header' : '.abele-github-file[data-path="src/long.ts"] .abele-github-file__head')}
            const head = await until(() => root.querySelector(selector) && root.querySelector('.abele-github-code__line_target') && root.querySelector(selector), 20000)
            if (!head) throw Error('File header and anchor did not load')
            let previous = '', since = Date.now()
            const target = () => root.querySelector('.abele-github-code__line_target')
            if (!(await until(() => {
              const geometry = JSON.stringify([main.scrollTop, main.scrollHeight, target()?.getBoundingClientRect().top])
              if (geometry !== previous) { previous = geometry; since = Date.now() }
              return Date.now() - since >= 900
            }, 15000))) throw Error('Line anchor did not settle')
            const anchorBox = target().getBoundingClientRect()
            const anchorGap = anchorBox.top - head.getBoundingClientRect().bottom
            const anchorVisible = anchorBox.bottom <= main.getBoundingClientRect().bottom
            // A native jump (find or scrollIntoView) must also honour the header's scroll margin.
            main.dispatchEvent(new Event('wheel', { bubbles: true }))
            target().scrollIntoView({ block: 'start' })
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const nativeGap = target().getBoundingClientRect().top - head.getBoundingClientRect().bottom
            const positions = []
            const initial = main.scrollTop
            for (const distance of [180, 360]) {
              main.scrollTop = initial + distance
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              positions.push(head.getBoundingClientRect().top - main.getBoundingClientRect().top)
            }
            const box = head.getBoundingClientRect()
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
            const result = {
              phone: document.body.classList.contains('is-phone'), anchorGap, anchorVisible, nativeGap, positions,
              movement: main.scrollTop - initial,
              background: getComputedStyle(head).backgroundColor,
              hitHeader: head === hit || head.contains(hit),
              sideways: main.scrollWidth - main.clientWidth,
            }
            const path = ${JSON.stringify(shots)} + '/${mobile ? 'phone' : 'desktop'}-${kind}.png'
            if (window.__e2eHost) await window.__e2eHost.shot(path)
            else {
              require('fs').mkdirSync(${JSON.stringify(shots)}, { recursive: true })
              const image = await require('@electron/remote').getCurrentWebContents().capturePage()
              require('fs').writeFileSync(path, image.toPNG())
            }
            return result
          } finally { leaf.detach() }
        })()`,
            90_000
          )
          expect(report.phone).toBe(mobile)
          expect(report.movement).toBeGreaterThan(300)
          for (const top of report.positions) expect(Math.abs(top)).toBeLessThanOrEqual(1)
          expect(report.anchorGap).toBeGreaterThanOrEqual(0)
          expect(report.anchorVisible).toBe(true)
          expect(report.nativeGap).toBeGreaterThanOrEqual(0)
          expect(report.background).not.toBe('rgba(0, 0, 0, 0)')
          expect(report.hitHeader).toBe(true)
          expect(report.sideways).toBe(0)
        },
        120_000
      )
    }
  )
}
