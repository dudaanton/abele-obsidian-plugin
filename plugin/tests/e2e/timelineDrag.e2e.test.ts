import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('timeline-drag')
const probe = (footer: boolean) => String.raw`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => { for (let i = 0; i < 100; i++) { const v = fn(); if (v) return v; await wait(100) } throw Error('timeline not ready') }
  const folder = 'Sample drag probe'
  const day = offset => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+offset); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
  const report = {}
  const picture = async name => {
    const path = ${JSON.stringify(shots)}+'/'+(${footer}?'footer':'sidebar')+'-'+(document.body.classList.contains('is-mobile')?'mobile':'desktop')+'-'+name+'.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else {
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(path,image.toPNG())
    }
  }
  let leaf
  const previousLeaf=app.workspace.activeLeaf
  const cleanups=[]
  try {
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
    const write = async (name, text) => { const f = app.vault.getAbstractFileByPath(folder+'/'+name+'.md'); if (f) await app.vault.modify(f,text); else await app.vault.create(folder+'/'+name+'.md',text) }
    await write('Sample group','Sample group\n')
    for (const [name, offset, done] of [['Sample moving',0,false],['Sample past',-1,false],['Sample completed',-2,true],['Sample future',2,false]])
      await write(name,'---\ntype: task\ndate: '+day(offset)+'\n'+(done?'completed: '+day(offset)+'\n':'')+'labels:\n  - sample-drag\ngroups:\n  - "[['+folder+'/Sample group]]"\n---\n'+name+'\n')
    await wait(2000)
    leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState(${footer} ? { type:'markdown', state:{file:folder+'/Sample group.md',mode:'source',source:false},active:true } : {type:'abele-timeline-sidebar-view',active:true})
    app.workspace.setActiveLeaf(leaf,{focus:true})
    if (${footer}) await until(() => { const s=leaf.view.containerEl.querySelector('.cm-scroller'); if(s) s.scrollTop=s.scrollHeight; return leaf.view.containerEl.querySelector('.abele-timeline') })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-timeline'))
    if (!${footer}) {
      root.querySelector('.abele-task-label-filter').click()
      const option=await until(() => [...document.querySelectorAll('.menu-item')].find(x=>x.textContent.trim().startsWith('sample-drag (')))
      option.click()
    }
    await wait(1200)
    const scroller=${footer} ? leaf.view.containerEl.querySelector('.cm-scroller') : root.closest('.abele-timeline-sidebar')
    const row=()=>root.querySelector('[data-abele-anchor="task:'+folder+'/Sample moving.md"]')
    const dates=()=>[...root.querySelectorAll('.abele-timeline__date-block')].map(x=>x.dataset.abeleAnchor)
    await until(row)
    const align=()=> { scroller.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1})); scroller.scrollTop+=row().getBoundingClientRect().top-scroller.getBoundingClientRect().top-240 }
    align(); await wait(800)
    // Start cancellation from natural scroll range, not compensation left by mounting
    // a short list. Then test that this gesture contributes no spacer of its own.
    scroller.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}))
    scroller.scrollTop=0
    scroller.dispatchEvent(new Event('scroll'))
    await wait(900)
    report.initialState={padding:root.querySelector('.abele-timeline__blocks').style.paddingTop,space:root.querySelector('.abele-timeline__anchor-space').style.height}
    const initial=dates()
    const initialScroll=scroller.scrollTop
    const initialSource=await app.vault.read(app.vault.getAbstractFileByPath(folder+'/Sample moving.md'))
    await picture('before')
    const r=row().getBoundingClientRect(), x=r.left+r.width/2, y=r.top+10
    const pointer=(type,px,py,target=document)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,clientX:px,clientY:py}))
    pointer('pointerdown',x,y,row()); pointer('pointermove',x+2,y+2); await wait(100)
    report.threshold=JSON.stringify(dates())===JSON.stringify(initial)
    pointer('pointerup',x+2,y+2)
    const before=row().getBoundingClientRect().top
    pointer('pointerdown',x,y,row()); pointer('pointermove',x,y+12)
    await wait(1000)
    report.range=dates()
    report.startAnchor=[before,row().getBoundingClientRect().top]
    if (report.range.length < 20) return JSON.stringify(report)
    report.weekdays=[...root.querySelectorAll('.timeline__date')].every(el => /Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/.test(el.textContent))
    await picture('drag')
    report.hiddenVisible=!!root.querySelector('[data-abele-anchor="task:'+folder+'/Sample completed.md"]') && !!root.querySelector('[data-abele-anchor="task:'+folder+'/Sample past.md"]')
    const usableBottom=()=>Math.min(scroller.getBoundingClientRect().bottom,...[...document.querySelectorAll('.mobile-navbar,.mobile-toolbar')].flatMap(el=>{const r=el.getBoundingClientRect();return r.height && r.top>scroller.getBoundingClientRect().top && r.top<scroller.getBoundingClientRect().bottom?[r.top]:[]}))
    const edge=usableBottom()-8
    pointer('pointermove',x,edge); const start=scroller.scrollTop
    await wait(100); report.edgeDelay=scroller.scrollTop-start
    await wait(500); report.edgeScroll=scroller.scrollTop-start
    pointer('pointermove',x,scroller.getBoundingClientRect().top+240); const stopped=scroller.scrollTop
    await wait(300); report.edgeStopped=scroller.scrollTop-stopped
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    await wait(1000)
    report.cancelled=JSON.stringify(dates())===JSON.stringify(initial) && (await app.vault.read(app.vault.getAbstractFileByPath(folder+'/Sample moving.md')))===initialSource
    report.cancelState={ padding:root.querySelector('.abele-timeline__blocks').style.paddingTop, space:root.querySelector('.abele-timeline__anchor-space').style.height, ghost:!!document.querySelector('.abele-timeline__drag-card'), source:!!root.querySelector('.abele-timeline__drag-source'), dragging:!!root.querySelector('.abele-timeline__dragging'), target:!!root.querySelector('.abele-timeline__drop-target'), scroll:[initialScroll,scroller.scrollTop] }
    app.workspace.setActiveLeaf(leaf,{focus:true})
    await wait(200)
    await picture('cancel')
    align(); await wait(800)
    const a=row().getBoundingClientRect(), ax=a.left+a.width/2, ay=a.top+10
    pointer('pointerdown',ax,ay,row()); pointer('pointermove',ax,ay+12); await wait(900)
    const target=root.querySelector('[data-abele-anchor="date:'+day(1)+'"]')
    const t=target.getBoundingClientRect(), ty=t.top+Math.min(15,t.height/2)
    pointer('pointermove',ax,ty); await wait(100)
    const ghost=document.querySelector('.abele-timeline__drag-card')
    report.dropTop=ghost?.getBoundingClientRect().top
    pointer('pointerup',ax,ty); await wait(1400)
    report.dropAnchor=[report.dropTop,row()?.getBoundingClientRect().top]
    report.written=app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(folder+'/Sample moving.md'))?.frontmatter?.date===day(1)
    report.extraGone=dates().length===2 && !root.querySelector('[data-abele-anchor="task:'+folder+'/Sample completed.md"]') && !root.querySelector('[data-abele-anchor="task:'+folder+'/Sample past.md"]')
    // Exercise the real WebKit touch path: a fast swipe scrolls, a held swipe drags.
    if (window.__e2eHost) {
      align(); await wait(800)
      const b=row().getBoundingClientRect(), bx=b.left+b.width/2, by=b.top+10
      let expanded=false, nativeStart, sourceBefore
      const observer=new MutationObserver(()=>{
        if(dates().length>20) expanded=true
        const ghost=document.querySelector('.abele-timeline__drag-card')
        if(ghost && sourceBefore!==undefined && nativeStart===undefined) nativeStart=[sourceBefore,ghost.getBoundingClientRect().top]
      })
      observer.observe(root,{childList:true,subtree:true})
      cleanups.push(()=>observer.disconnect())
      await window.__e2eHost.swipe(bx,by,bx,by-100,{velocity:500})
      await wait(700); report.nativeSwipe=!expanded
      align(); await wait(600)
      const c=row().getBoundingClientRect()
      const nativeTarget=root.querySelector('[data-abele-anchor="date:'+day(2)+'"]').getBoundingClientRect()
      let nativeEnd
      sourceBefore=c.top
      // Measure the source immediately before the intent-crossing touchmove, not before
      // the long press (native navigation may settle meanwhile). Verify painted geometry.
      const beforeMove=()=> { if(!document.querySelector('.abele-timeline__drag-card')) sourceBefore=row().getBoundingClientRect().top }
      document.addEventListener('touchmove',beforeMove,true)
      cleanups.push(()=>document.removeEventListener('touchmove',beforeMove,true))
      const record=()=> { const g=document.querySelector('.abele-timeline__drag-card'); if(g) nativeEnd=g.getBoundingClientRect().top }
      document.addEventListener('touchend',record,true)
      cleanups.push(()=>document.removeEventListener('touchend',record,true))
      expanded=false
      await window.__e2eHost.swipe(bx,c.top+10,bx,nativeTarget.top+15,{hold:0.65,velocity:100})
      document.removeEventListener('touchend',record,true); document.removeEventListener('touchmove',beforeMove,true); observer.disconnect(); await wait(1200)
      report.nativeWritten=app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(folder+'/Sample moving.md'))?.frontmatter?.date===day(2)
      report.nativeDrag=expanded
      report.nativeStart=nativeStart
      report.nativeDrop=[nativeEnd,row()?.getBoundingClientRect().top]
            align(); await wait(800)
      const edgeRow=row().getBoundingClientRect(), edgeY=usableBottom()-12
      let edgeStart, edgeDistance=0
      const nearEdge=e=>{ if(document.querySelector('.abele-timeline__drag-card') && e.touches[0]?.clientY>edgeY-35) { edgeStart??=scroller.scrollTop; edgeDistance=Math.max(edgeDistance,scroller.scrollTop-edgeStart) } }
      document.addEventListener('touchmove',nearEdge,true)
      cleanups.push(()=>document.removeEventListener('touchmove',nearEdge,true))
      await window.__e2eHost.swipe(edgeRow.left+edgeRow.width/2,edgeRow.top+10,edgeRow.left+edgeRow.width/2,edgeY,{hold:0.65,velocity:60})
      document.removeEventListener('touchmove',nearEdge,true)
      report.nativeEdgeScroll=edgeDistance
      await wait(1000)
      report.nativeEdgeEnded=!document.querySelector('.abele-timeline__drag-card')
      await window.__e2eHost.shot(${JSON.stringify(shots)}+'/'+(${footer}?'footer':'sidebar')+'.png')
    }
    return JSON.stringify(report)
  } finally {
    for(const cleanup of cleanups) cleanup()
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    leaf?.detach()
    if(previousLeaf) app.workspace.setActiveLeaf(previousLeaf,{focus:true})
    const dir=app.vault.getAbstractFileByPath(folder)
    if(dir) await app.vault.delete(dir,true)
  }
})()`

describe.skipIf(!available)('timeline drag in native scroll panes', () => {
  let originalSize: number[] = []
  let originalMobile = false
  beforeAll(async () => {
    if (!onPhone()) {
      originalSize = JSON.parse(
        evalRaw("require('@electron/remote').getCurrentWindow().getContentSize()")
      )
      originalMobile = evalRaw("document.body.classList.contains('is-mobile')") === 'true'
    }
    await reloadApp('app.emulateMobile(false)')
  })
  afterAll(async () => {
    if (!onPhone()) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${originalSize[0]},${originalSize[1]})`
      )
      await reloadApp(`app.emulateMobile(${originalMobile})`)
    }
  })
  it.each(
    onPhone()
      ? [
          [false, false],
          [true, false],
        ]
      : [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ]
  )(
    'anchors expansion and drop, scrolls only near an edge and restores filters (footer=%s, mobile=%s)',
    async (footer, mobile) => {
      if (!onPhone()) {
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390,844' : originalSize.join(',')})`
        )
        await reloadApp(`app.emulateMobile(${mobile})`)
      }
      const raw = await evalLong(probe(footer), 120_000)
      if (raw.startsWith('Error:')) throw new Error(raw)
      const result = JSON.parse(raw)
      console.log(JSON.stringify(result))
      expect(result.initialState).toEqual({ padding: '', space: '' })
      expect(result.threshold).toBe(true)
      expect(result.range.length).toBeGreaterThanOrEqual(59)
      expect(result.range.length).toBeLessThanOrEqual(63)
      expect(Math.abs(result.startAnchor[1] - result.startAnchor[0])).toBeLessThanOrEqual(1)
      expect(result.hiddenVisible).toBe(true)
      expect(result.edgeDelay).toBe(0)
      expect(result.edgeScroll).toBeGreaterThan(0)
      expect(result.edgeStopped).toBe(0)
      expect(result.cancelled).toBe(true)
      expect(result.cancelState).toMatchObject({
        padding: '',
        space: '',
        ghost: false,
        source: false,
        dragging: false,
        target: false,
      })
      expect(
        Math.abs(result.cancelState.scroll[1] - result.cancelState.scroll[0])
      ).toBeLessThanOrEqual(1)
      expect(result.weekdays).toBe(true)
      expect(result.written).toBe(true)
      expect(Math.abs(result.dropAnchor[1] - result.dropAnchor[0])).toBeLessThanOrEqual(1)
      expect(result.extraGone).toBe(true)
      if (result.nativeSwipe !== undefined) {
        expect(result.nativeSwipe).toBe(true)
        expect(result.nativeDrag).toBe(true)
        expect(result.nativeWritten).toBe(true)
        expect(result.nativeEdgeScroll).toBeGreaterThan(0)
        expect(result.nativeEdgeEnded).toBe(true)
        expect(Math.abs(result.nativeStart[1] - result.nativeStart[0])).toBeLessThanOrEqual(1)
        expect(Math.abs(result.nativeDrop[1] - result.nativeDrop[0])).toBeLessThanOrEqual(1)
      }
    },
    180_000
  )
})
