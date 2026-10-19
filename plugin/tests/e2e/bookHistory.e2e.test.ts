import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning, phoneEntry, reloadApp } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('book-history')
const run = Date.now().toString(36)

describe.runIf(available)('reader jump history', () => {
  for (const device of ['desktop', 'phone']) {
    describe(device, () => {
      beforeAll(async () => {
        await reloadApp(device === 'phone' ? phoneEntry(390, 844) : 'app.emulateMobile(false)')
        // Recover only byte-identical fixtures left by an interrupted earlier probe.
        const fixtures = [
          ['sample-history-epub.epub', Buffer.from(buildRichEpub()).toString('base64')],
          ['sample-history-pdf.pdf', Buffer.from(buildPlainPdf()).toString('base64')],
        ]
        evalAsync(`(async () => {
          for (const [path, expected] of ${JSON.stringify(fixtures)}) {
            const file = app.vault.getAbstractFileByPath(path)
            if (!file) continue
            const actual = new Uint8Array(await app.vault.readBinary(file))
            const bytes = Uint8Array.from(atob(expected), c => c.charCodeAt(0))
            if (actual.length === bytes.length && actual.every((byte, i) => byte === bytes[i]))
              await app.vault.delete(file, true)
          }
          return true
        })()`)
      }, 180_000)
      afterAll(async () => {
        if (device === 'phone') await reloadApp('app.emulateMobile(false)')
      }, 180_000)
      for (const [kind, bytes] of [
        ['epub', buildRichEpub()],
        ['pdf', buildPlainPdf()],
      ] as const) {
        it(`returns exactly to the place left and exposes forward in ${kind} on ${device}`, () => {
          const result = evalAsync<{ error?: string; back: boolean; forward: boolean }>(
            `(async () => {
        ${WAIT_PRELUDE}
        const path = 'sample-history-${run}-${device}-${kind}.' + ${JSON.stringify(kind)}
        const data = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}), c => c.charCodeAt(0))
        const file = await app.vault.createBinary(path, data.buffer)
        const leaf = app.workspace.getLeaf('tab')
        try {
          await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
          await app.workspace.revealLeaf(leaf)
          const view = leaf.view
          if (!await until(() => view.model?.status === 'ready' && view.engine?.lastLocation?.cfi))
            throw new Error('Reader did not open')
          await wait(800)
          const origin = view.engine.lastLocation.cfi
          await view.engine.goTo(1)
          await wait(400)
          await view.engine.goTo(2)
          await wait(400)
          const destination = view.engine.lastLocation.cfi
          view.engine.history.back()
          if (!await until(() => view.model.canGoBack && view.model.canGoForward))
            throw new Error('Both history actions did not appear')
          await wait(500)
          const footer = view.contentEl.querySelector('.abele-book-reader__footer')
          if (footer.querySelectorAll('button').length < 3) throw new Error('History controls absent')
          const image = await require('@electron/remote').getCurrentWebContents().capturePage()
          require('fs').writeFileSync(${JSON.stringify(shots)} + '/${device}-${kind}-back-forward.png', image.toPNG())
          view.engine.history.back()
          if (!await until(() => view.engine.lastLocation.cfi === origin))
            throw new Error('Back did not restore the exact original place')
          view.engine.history.forward()
          await wait(400)
          view.engine.history.forward()
          if (!await until(() => view.engine.lastLocation.cfi === destination))
            throw new Error('Forward did not restore the destination')
          return { back: view.model.canGoBack, forward: view.model.canGoForward }
        } catch (e) { return { error: String(e) } }
        finally {
          leaf.detach()
          await app.vault.delete(file, true)
        }
      })()`,
            90_000
          )
          expect(result.error).toBeUndefined()
          expect(result.back).toBe(true)
          expect(result.forward).toBe(false)
        }, 100_000)
      }
    })
  }
})
