import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('sync inspection desktop captures', () => {
  it('captures every section and check step at 1200 pixels with pinned actions visible', async () => {
    const report = JSON.parse(
      await evalLong(
        `(async () => {
      const remote = require('@electron/remote'), fs = require('fs')
      const win = remote.getCurrentWindow(), contents = win.webContents
      const original = win.getContentSize(), dir = ${JSON.stringify(shotDir('abele-sync-inspection-desktop'))}
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const names = [...Array.from({length:11},(_,i)=>'sync-sections-'+(i+1)), ...Array.from({length:8},(_,i)=>'sync-check-'+(i+1))]
      const report = []
      if(document.body.classList.contains('is-mobile')) throw new Error('Desktop capture requires a desktop host')
      const close = async () => {
        for(let i=0;i<5;i++) {
          const modals=[...document.querySelectorAll('.modal.abele-modal')]
          if(!modals.length) break
          modals.at(-1).querySelector('.modal-close-button,.modal-header-button')?.click()
          await wait(200)
        }
      }
      try {
        win.setContentSize(1200,900); await wait(300); fs.mkdirSync(dir,{recursive:true})
        for(const name of names) {
          await close()
          void window.__abeleTest.openDialog(name)
          await wait(600)
          contents.sendInputEvent({type:'mouseMove',x:0,y:0})
          await wait(100)
          const modal=[...document.querySelectorAll('.modal.abele-modal')].at(-1)
          if(!modal) throw new Error(name+' did not open')
          // History and the version-choice prompt sit above the connection sheet.
          const sheet=[...document.querySelectorAll('.modal.abele-modal')].find(one=>one.querySelector('.abele-modal__footer'))
          const footer=sheet?.querySelector('.abele-modal__footer'), bounds=footer?.getBoundingClientRect()
          const body=sheet?.querySelector('.abele-modal__body')
          const pinned = bounds && bounds.height>0 && bounds.bottom<=innerHeight+1 && bounds.top>=0
          if(body) body.scrollTop=body.scrollHeight
          await wait(50)
          const after=footer?.getBoundingClientRect()
          const stays=!!bounds&&!!after&&Math.abs(bounds.top-after.top)<1
          if(body) body.scrollTop=0
          await wait(50)
          fs.writeFileSync(dir+'/dialog-'+name+'.png',(await contents.capturePage()).toPNG())
          report.push({name,width:innerWidth,pinned:!!pinned,stays})
        }
      } finally { await close(); win.setContentSize(...original) }
      return JSON.stringify(report)
    })()`,
        120000
      )
    ) as { name: string; width: number; pinned: boolean; stays: boolean }[]
    expect(report).toHaveLength(19)
    for (const capture of report) {
      expect(capture.width, capture.name).toBe(1200)
      expect(capture.pinned, capture.name).toBe(true)
      expect(capture.stays, capture.name).toBe(true)
    }
  }, 130000)
})
