import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'
import {
  PUBLICATION_SETUP,
  publicationFault,
  PUBLICATION_CASE_CLEANUP,
  PUBLICATION_CLEANUP,
} from './helpers/canvasPublicationReview'

const shots = shotDir('i18n-stream-c')
const fixtures = [
  'book-comment',
  'book-forms',
  'book-repair-many',
  'request-environment',
  'template-review-change',
]

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'localized reader, debugger, scripts and canvas',
  () => {
    it('fits Russian and expanded copy on desktop and phone and retains uncertain Canvas work', async () => {
      async function check(phone: boolean) {
        for (const locale of ['ru', 'en-XA']) {
          const capture = `
          ${WAIT_PRELUDE}
          const fs = require('fs'), win = require('@electron/remote').getCurrentWindow()
          fs.mkdirSync(${JSON.stringify(shots)}, {recursive:true})
          const failures = []
          const shot = async (name, modal) => {
            await new Promise(resolve => setTimeout(resolve, 400))
            for (const el of [modal, ...modal.querySelectorAll('.setting-item, .abele-modal__footer')]) {
              const r=el.getBoundingClientRect()
              if (r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2))
                failures.push({name, cls:el.className, left:r.left, right:r.right, width:el.clientWidth, scroll:el.scrollWidth})
            }
            if (/streamC\\.[a-z0-9]/i.test(modal.textContent)) throw new Error('Missing translation key in '+name)
            fs.writeFileSync(${JSON.stringify(shots + '/' + locale + (phone ? '-phone-' : '-desktop-'))}+name+'.png', (await win.webContents.capturePage()).toPNG())
          }
          const close = async modal => {
            modal.closest('.modal-container').querySelector('.modal-close-button, .modal-header-button:has(svg.lucide-x)')?.click()
            if (!await until(()=>!modal.isConnected)) throw new Error('Localized fixture did not close')
          }
        `
          await evalLong(
            `(async()=>{ await window.__abeleTest.setTestLocale(${JSON.stringify(locale)}); return true })()`
          )
          const fixtureFailures = JSON.parse(
            await evalLong(
              `(async()=>{
          ${capture}
          try {
            for (const name of ${JSON.stringify(fixtures)}) {
              window.__abeleTest.openDialog(name)
              const modal = await until(()=>[...document.querySelectorAll('.modal.abele-modal')].at(-1))
              if (!modal) throw new Error(name+' did not mount')
              if (${JSON.stringify(locale)}==='ru' && name==='template-review-change' && !modal.querySelector('.modal-title')?.textContent?.startsWith('Подтвердить шаблон'))
                throw new Error('Template confirmation title did not translate')
              if (name==='request-environment' && modal.textContent.includes('Add a value'))
                throw new Error('Environment add control did not translate')
              await shot(name,modal)
              const last=modal.querySelector('.abele-modal__footer button:last-child')
              if (last) { last.scrollIntoView({block:'nearest'}); await shot(name+'-footer',modal) }
              await close(modal)
            }
            return JSON.stringify(failures)
          } finally {
            for (const modal of [...document.querySelectorAll('.modal.abele-modal')].reverse()) await close(modal)
          }
        })()`,
              60_000
            )
          ) as unknown[]
          expect(fixtureFailures, `${locale} ${phone ? 'phone' : 'desktop'} fixtures`).toEqual([])
          try {
            await evalLong(`(async()=>{ ${PUBLICATION_SETUP} })()`)
            await evalLong(`(async()=>{ ${publicationFault('unpersisted')} })()`, 45_000)
            const canvas = JSON.parse(
              await evalLong(
                `(async()=>{
            ${capture}
            const fixture=window.__canvasPublicationReviewFixture
            const before=await app.vault.read(fixture.file)
            await fixture.view.recoveryMenu(new MouseEvent('click'))
            const modal=await until(()=>document.querySelector('.abele-canvas-publication-review'))
            if (!modal) throw new Error('Canvas review did not mount')
            await shot('canvas-review',modal)
            const title=modal.querySelector('.modal-title')?.textContent?.trim()
            if (${JSON.stringify(locale)}==='ru' && title!=='Проверить сохранённое изменение холста')
              throw new Error('Russian Canvas title is missing: '+title)
            const warning=modal.querySelector('button.mod-warning')
            if (!warning) throw new Error('Canvas discard confirmation action is missing')
            warning.click()
            await new Promise(resolve=>setTimeout(resolve,100))
            await shot('canvas-confirm',modal)
            modal.querySelector('.abele-modal__footer button')?.click()
            if (!await until(()=>!modal.isConnected)) throw new Error('Canvas Keep did not close the review')
            return JSON.stringify({failures,sourceUnchanged:before===await app.vault.read(fixture.file),retained:!!fixture.session.publicationOutcome,processCalls:fixture.processCalls,ackCalls:fixture.ackCalls})
          })()`,
                45_000
              )
            ) as {
              failures: unknown[]
              sourceUnchanged: boolean
              retained: boolean
              processCalls: number
              ackCalls: number
            }
            expect(canvas).toEqual({
              failures: [],
              sourceUnchanged: true,
              retained: true,
              processCalls: 0,
              ackCalls: 0,
            })
          } finally {
            evalRaw(
              `window.__canvasPublicationReviewFixture?.view?.publicationReviewModal?.close()`
            )
            await evalLong(`(async()=>{ ${PUBLICATION_CASE_CLEANUP} })()`)
            await evalLong(`(async()=>{ ${PUBLICATION_CLEANUP} })()`)
          }
        }
      }
      try {
        await check(false)
        await withEmulatedPhone(() => check(true))
      } finally {
        evalRaw(`window.__abeleTest?.setTestLocale('en')`)
        await reloadApp('app.emulateMobile(false)')
      }
    }, 360_000)
  }
)
