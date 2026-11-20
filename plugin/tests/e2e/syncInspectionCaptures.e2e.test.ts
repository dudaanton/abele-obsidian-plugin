import { describe, expect, it } from 'vitest'
import {
  activeVaultName,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  vaultCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { reloadAs, setWindowSize } from './helpers/phoneWindow'
import {
  desktopCaptureErrors,
  withDesktopInspection,
  type DesktopCapture,
} from './helpers/desktopInspection'

const available = process.env.E2E_TARGET !== 'phone' && isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('sync inspection desktop captures', () => {
  it('captures every section and check step at 1200 pixels with pinned actions visible', async () => {
    const vault = vaultCli(activeVaultName())
    await withDesktopInspection(
      {
        snapshot: () =>
          vault.evalAwait(
            `(() => { const [width,height]=require('@electron/remote').getCurrentWindow().getContentSize(); return {mobile:!!app.isMobile,width,height} })()`
          ),
        show: async (width, height, mobile) => {
          await setWindowSize(vault, width, height)
          // reloadAs owns the shared emulation lock and clears the persistent mobile flag.
          await reloadAs(vault, mobile)
        },
      },
      async () => {
        const report = JSON.parse(
          await evalLong(
            `(async () => {
      const remote = require('@electron/remote'), fs = require('fs')
      const win = remote.getCurrentWindow(), contents = win.webContents
      const dir = ${JSON.stringify(shotDir('abele-sync-inspection-desktop'))}
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const names = [...Array.from({length:11},(_,i)=>'sync-sections-'+(i+1)), ...Array.from({length:8},(_,i)=>'sync-check-'+(i+1))]
      const report = []
      const phoneClasses = () => [document.body,document.documentElement].some(el=>['is-mobile','is-phone','is-tablet'].some(name=>el.classList.contains(name)))
      if(app.isMobile || phoneClasses()) throw new Error('Desktop capture requires a desktop host')
      const close = async () => {
        for(let i=0;i<5;i++) {
          const modals=[...document.querySelectorAll('.modal.abele-modal')]
          if(!modals.length) break
          modals.at(-1).querySelector('.modal-close-button,.modal-header-button')?.click()
          await wait(200)
        }
      }
      try {
        fs.mkdirSync(dir,{recursive:true})
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
          const buttons=[...footer.querySelectorAll('button')].map(button=>button.getBoundingClientRect())
          const separated=buttons.length===3&&buttons[1].left-buttons[0].right>32
          const clearance=[]
          if(name==='sync-sections-2') {
            const groups=[
              ['clear','.abele-sections__all'],
              ['count','.abele-sections__tree .tree-item-flair'],
              ['key','.abele-sections__tree [data-keys]'],
            ]
            for(const [kind,selector] of groups) {
              const targets=[...sheet.querySelectorAll(selector)].filter(el=>el.getBoundingClientRect().width>0)
              if(!targets.length) throw new Error('Missing clearance targets: '+kind)
              for(const target of targets) {
                let scroller=target.parentElement
                while(scroller&&!( /auto|scroll/.test(getComputedStyle(scroller).overflowY)&&scroller.scrollHeight>scroller.clientHeight+1)) scroller=scroller.parentElement
                if(!scroller) throw new Error('No overflowing scroller for '+kind)
                const style=getComputedStyle(scroller), box=scroller.getBoundingClientRect()
                const borderLeft=parseFloat(style.borderLeftWidth)||0, borderRight=parseFloat(style.borderRightWidth)||0
                const nativeWidth=Math.max(0,scroller.offsetWidth-scroller.clientWidth-borderLeft-borderRight)
                // Overlay scrollbars occupy no layout width, but still cover the row's end.
                const scrollbarWidth=nativeWidth||12
                const edge=box.right-borderRight-scrollbarWidth
                const right=target.getBoundingClientRect().right
                const label=target.querySelector('.abele-obsidian-button__label')
                clearance.push({kind,scroller:scroller.className,paddingRight:style.paddingRight,marginRight:getComputedStyle(target).marginRight,scrollbarWidth,right,edge,gap:edge-right,unclipped:!label||label.scrollWidth<=label.clientWidth+1})
              }
            }
          }
          const pinned = bounds && bounds.height>0 && bounds.bottom<=innerHeight+1 && bounds.top>=0
          if(body) body.scrollTop=body.scrollHeight
          await wait(50)
          const after=footer?.getBoundingClientRect()
          const stays=!!bounds&&!!after&&Math.abs(bounds.top-after.top)<1
          if(body) body.scrollTop=0
          await wait(50)
          const box=modal.getBoundingClientRect()
          const compactHistory=name!=='sync-check-6'||box.height<innerHeight*0.65
          const centered=box.left>0&&box.top>0&&box.right<innerWidth&&box.bottom<innerHeight&&Math.abs((box.left+box.right)/2-innerWidth/2)<5&&Math.abs((box.top+box.bottom)/2-innerHeight/2)<5
          const image=await contents.capturePage(), pixels=image.getSize()
          // Retina pixels may be 2x CSS pixels; a stale phone frame has a different aspect.
          if(Math.abs(pixels.width/pixels.height-innerWidth/innerHeight)>0.01) throw new Error(name+' captured a stale or cropped frame')
          const png=image.resize({width:1200,height:900}).toPNG({scaleFactor:1})
          const output={width:png.readUInt32BE(16),height:png.readUInt32BE(20)}
          fs.writeFileSync(dir+'/dialog-'+name+'.png',png)
          report.push({name,width:innerWidth,height:innerHeight,imageWidth:output.width,imageHeight:output.height,mobile:!!app.isMobile,phoneClasses:phoneClasses()||['is-mobile','is-phone','is-tablet'].some(c=>modal.classList.contains(c)),centered,pinned:!!pinned,stays,separated,clearance,compactHistory})
        }
      } finally { await close() }
      return JSON.stringify(report)
    })()`,
            120000
          )
        ) as (DesktopCapture & {
          name: string
          pinned: boolean
          stays: boolean
          separated: boolean
          clearance: {
            kind: string
            scroller: string
            paddingRight: string
            marginRight: string
            scrollbarWidth: number
            right: number
            edge: number
            gap: number
            unclipped: boolean
          }[]
          compactHistory: boolean
        })[]
        expect(report).toHaveLength(19)
        for (const capture of report) {
          expect(desktopCaptureErrors(capture), capture.name).toEqual([])
          expect(capture.pinned, capture.name).toBe(true)
          expect(capture.stays, capture.name).toBe(true)
          expect(capture.separated, capture.name).toBe(true)
          if (capture.name === 'sync-sections-2') {
            expect(new Set(capture.clearance.map((item) => item.kind))).toEqual(
              new Set(['clear', 'count', 'key'])
            )
            for (const item of capture.clearance) {
              expect(item.gap, JSON.stringify(item)).toBeGreaterThanOrEqual(8)
              expect(item.unclipped, JSON.stringify(item)).toBe(true)
            }
          }
          expect(capture.compactHistory, capture.name).toBe(true)
        }
      }
    )
  }, 130000)
})
