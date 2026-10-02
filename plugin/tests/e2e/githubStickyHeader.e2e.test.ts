/** File paths stay at the tab scroller's top; links and native line jumps stay below them. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJsonIdempotent,
  evalLong,
  evalRawIdempotent,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
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
import { BLAME_PROBE } from './helpers/githubBlameProbe'

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
          size = evalJsonIdempotent(
            `[...require('@electron/remote').getCurrentWindow().getContentSize()]`
          )
          evalRawIdempotent(
            `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return 'ok' })()`
          )
          await reloadApp('app.emulateMobile(true)')
        }
        gh = await startFakeGithub({ mode: 'wide-readme' })
        enableGithub(gh.origin, !mobile)
      }, 120_000)
      afterAll(async () => {
        try {
          restoreGithub()
        } finally {
          gh?.stop()
          if (size) {
            evalRawIdempotent(
              `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
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
            const selector = ${JSON.stringify(kind === 'blob' ? '.abele-github-header__title' : '.abele-github-file[data-path="src/long.ts"] .abele-github-file__head')}
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
      it.each(['blob', 'tree'])(
        '%s: only the path stays pinned and wide README content stays inside its boxes',
        async (kind) => {
          const url = `${gh.web}/${kind}/main/src${kind === 'blob' ? '/README.md' : ''}`
          type Report = {
            width: number
            sideways: number
            pathTops: number[]
            pinnedHeight: number
            pathHeight: number
            controlsGone: boolean
            controlsBack: boolean
            blameReachable: boolean
            blameHit: boolean
            blameReady: boolean
            blameState: unknown
            tableScrolls: boolean
            codeScrolls: boolean
            imageFits: boolean
          }
          const report = JSON.parse(
            await evalLong(
              `(async () => {
            ${PRELUDE}
            ${BLAME_PROBE}
            const leaf = await openTab(${JSON.stringify(url)}, false)
            await app.workspace.revealLeaf(leaf)
            try {
              const root = leaf.view.containerEl
              const main = root.querySelector('.abele-github-layout__main')
              const prose = await until(() => root.querySelector(${JSON.stringify(kind === 'blob' ? '.abele-github-md' : '.abele-github-folder__readme .abele-github-text')})?.querySelector('h2'))
              if (!prose) throw Error('Wide README did not render')
              const documentEl = prose.closest('.markdown-rendered')
              // The loopback fixture's image may be held by the remote-image consent button.
              documentEl.querySelector('.abele-remote-image')?.click()
              const image = await until(() => {
                const img = documentEl.querySelector('img')
                return img?.complete && img.naturalWidth === 1600 && img
              })
              if (!image) throw Error('Wide sample image did not load')
              const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              await frame()
              const header = root.querySelector('.abele-github-header')
              const path = header.querySelector('.abele-github-header__title')
              const controls = [...header.querySelectorAll('.abele-github-header__top, .abele-github-blob__toolbar, .abele-github-header__meta')]
              const hasHorizontalBox = el => {
                for (let box = el; box && documentEl.contains(box); box = box.parentElement) {
                  if (getComputedStyle(box).overflowX === 'auto' && box.scrollWidth > box.clientWidth) {
                    box.scrollLeft = 100
                    return box.scrollLeft > 0
                  }
                }
                return false
              }
              const tableScrolls = hasHorizontalBox(documentEl.querySelector('table'))
              const codeScrolls = hasHorizontalBox(documentEl.querySelector('pre'))
              const imageFits = image.getBoundingClientRect().width <= documentEl.getBoundingClientRect().width && image.getBoundingClientRect().height > 0
              main.dispatchEvent(new Event('wheel', { bubbles: true }))
              const pathTops = []
              for (const distance of [700, 1100]) {
                main.scrollTop = distance
                await frame()
                pathTops.push(path.getBoundingClientRect().top - main.getBoundingClientRect().top)
              }
              const top = main.getBoundingClientRect().top
              const visible = [...header.querySelectorAll('*')].map(el => el.getBoundingClientRect()).filter(r => r.height && r.bottom > top && r.top < main.getBoundingClientRect().bottom)
              const pinnedHeight = Math.max(...visible.map(r => r.bottom)) - top
              const controlsGone = controls.every(el => el.getBoundingClientRect().bottom <= top)
              const sideways = Math.max(main.scrollWidth - main.clientWidth, root.scrollWidth - root.clientWidth)
              const capture = async suffix => {
                const shot = ${JSON.stringify(shots)} + '/${mobile ? 'phone' : 'desktop'}-wide-${kind}' + suffix + '.png'
                if (window.__e2eHost) await window.__e2eHost.shot(shot)
                else {
                  require('fs').mkdirSync(${JSON.stringify(shots)}, { recursive: true })
                  const image = await require('@electron/remote').getCurrentWebContents().capturePage()
                  require('fs').writeFileSync(shot, image.toPNG())
                }
              }
              await capture('')
              for (const selector of ['table', 'pre', 'img']) {
                documentEl.querySelector(selector).scrollIntoView({ block: 'center' })
                await frame()
                await capture('-' + selector)
              }
              main.scrollTop = 0
              await frame()
              const controlsBack = controls.every(el => el.getBoundingClientRect().top >= top)
              const blame = ${kind === 'blob'} ? await probeBlame(root, header) :
                { blameHit: true, blameReady: true, blameReachable: true, blameState: null }
              return JSON.stringify({ width: innerWidth, sideways, pathTops, pinnedHeight, pathHeight: path.getBoundingClientRect().height,
                controlsGone, controlsBack, ...blame, tableScrolls, codeScrolls, imageFits })
            } finally { leaf.detach() }
          })()`,
              120_000
            )
          ) as Report
          console.info(JSON.stringify({ kind, mobile, ...report }))
          if (mobile && !onPhone()) expect(report.width).toBe(390)
          expect.soft(report.sideways).toBe(0)
          for (const top of report.pathTops) expect.soft(Math.abs(top)).toBeLessThanOrEqual(1)
          expect.soft(report.pinnedHeight).toBeCloseTo(report.pathHeight, 0)
          expect.soft(report.controlsGone).toBe(true)
          expect(report.controlsBack).toBe(true)
          expect(report.blameHit, JSON.stringify(report.blameState)).toBe(true)
          expect(report.blameReady, JSON.stringify(report.blameState)).toBe(true)
          expect(report.blameReachable).toBe(true)
          expect(report.tableScrolls).toBe(true)
          expect(report.codeScrolls).toBe(true)
          expect(report.imageFits).toBe(true)
        },
        120_000
      )
    }
  )
}
