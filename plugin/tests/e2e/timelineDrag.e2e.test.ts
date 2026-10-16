import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { closeFixtureLeaves } from './helpers/fixtureBoundary'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('timeline-drag')
const RUN_ID = randomUUID()
const probe = (footer: boolean) => String.raw`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => { for (let i = 0; i < 100; i++) { const v = fn(); if (v) return v; await wait(100) } throw Error('timeline not ready') }
  const folder = ${JSON.stringify(`Sample drag probe ${RUN_ID}`)}
  const day = offset => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+offset); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
  const report = {phase:'setup',events:[]}
  const layout=app.workspace.getLayout()
  const picture = async name => {
    const path = ${JSON.stringify(shots)}+'/'+(${footer}?'footer':'sidebar')+'-'+(document.body.classList.contains('is-mobile')?'mobile':'desktop')+'-'+name+'.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else {
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(path,image.toPNG())
    }
  }
  let leaf,owned=false
  const previousLeaf=app.workspace.activeLeaf
  const cleanups=[]
  try {
    if (app.vault.getAbstractFileByPath(folder))throw Error('Owned drag fixture already exists')
    await app.vault.createFolder(folder);owned=true
    const write = async (name, text) => { const f = app.vault.getAbstractFileByPath(folder+'/'+name+'.md'); if (f) await app.vault.modify(f,text); else await app.vault.create(folder+'/'+name+'.md',text) }
    await write('Sample group','Sample group\n')
    const fixture=[['Sample moving',0,false],['Sample past',-1,false],['Sample completed',-2,true],['Sample future',2,false]]
    for (const [name, offset, done] of fixture)
      await write(name,'---\ntype: task\ndate: '+day(offset)+'\n'+(done?'completed: '+day(offset)+'\n':'')+'labels:\n  - sample-drag\ngroups:\n  - "[['+folder+'/Sample group]]"\n---\n'+name+'\n')
    // Every written task is in the store with its date, completion, label and group.
    await until(() => fixture.every(([name, offset, done]) => {
      const task=window.__abeleTest.GlobalStore.getInstance().tasksList.value?.tasks.get(folder+'/'+name+'.md')
      return task?.loaded && task.date?.format('YYYY-MM-DD')===day(offset) && !!task.completedAt===done && task.labels.includes('sample-drag') && task.groups.length
    }))
    leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState(${footer} ? { type:'markdown', state:{file:folder+'/Sample group.md',mode:'source',source:false},active:true } : {type:'abele-timeline-sidebar-view',active:true})
    await app.workspace.revealLeaf(leaf)
    app.workspace.setActiveLeaf(leaf,{focus:true})
    if (${footer}) await until(() => { const s=leaf.view.containerEl.querySelector('.cm-scroller'); if(s) s.scrollTop=s.scrollHeight; return leaf.view.containerEl.querySelector('.abele-timeline') })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-timeline'))
    if (!${footer}) {
      root.querySelector('.abele-task-label-filter').click()
      const option=await until(() => [...document.querySelectorAll('.menu-item')].find(x=>x.textContent.trim().startsWith('sample-drag (')))
      option.click()
    }
    // Only the fixture's rows are mounted (the filter applied), with titles and date labels painted.
    await until(() => !document.querySelector('.menu') && ['Sample moving','Sample future'].every(n=>root.querySelector('[data-abele-anchor="task:'+folder+'/'+n+'.md"]')?.textContent.includes(n)) &&
      [...root.querySelectorAll('.abele-task-view')].every(el=>el.dataset.abeleAnchor?.startsWith('task:'+folder+'/')) &&
      [...root.querySelectorAll('.timeline__date')].every(el=>el.textContent.trim()))
    const scroller=${footer} ? leaf.view.containerEl.querySelector('.cm-scroller') : root.closest('.abele-timeline-sidebar')
    const row=()=>root.querySelector('[data-abele-anchor="task:'+folder+'/Sample moving.md"]')
    const dates=()=>[...root.querySelectorAll('.abele-timeline__date-block')].map(x=>x.dataset.abeleAnchor)
    await until(row)
    const align=()=> { scroller.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1})); scroller.scrollTop+=row().getBoundingClientRect().top-scroller.getBoundingClientRect().top-240 }
    // The aligned row has stopped moving: same scroll and geometry for six painted frames.
    const settle=async()=> {
      let last, steady=0
      for (let i=0; i<300; i++) {
        const now=JSON.stringify([scroller.scrollTop,scroller.scrollHeight,row()?.getBoundingClientRect().top,dates()])
        steady=now===last ? steady+1 : 0
        if (steady>=6) return
        last=now
        await new Promise(r=>requestAnimationFrame(r))
      }
      throw Error('timeline did not come to rest')
    }
    align(); await settle()
    // Start cancellation from natural scroll range, not compensation left by mounting
    // a short list. Then test that this gesture contributes no spacer of its own.
    scroller.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}))
    scroller.scrollTop=0
    scroller.dispatchEvent(new Event('scroll'))
    await wait(900)
    report.initialState={padding:root.querySelector('.abele-timeline__blocks').style.paddingTop,space:root.querySelector('.abele-timeline__anchor-space').style.height}
    const initial=dates()
    const overdueState=()=>{
      const el=root.querySelector('.abele-timeline__overdue')
      return el ? {visibility:getComputedStyle(el).visibility,height:el.getBoundingClientRect().height} : null
    }
    report.overdueBefore=overdueState()
    const labels=()=>[...root.querySelectorAll('.timeline__date')].map(el=>({day:el.closest('.abele-timeline__date-block').dataset.abeleAnchor,text:el.textContent,height:el.getBoundingClientRect().height}))
    const shortWeekdays=()=>labels().every(label=>/^(?:(?:Today|Tomorrow|Yesterday) · )?(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\.\d{2}(?:\.\d{4})?$/.test(label.text.trim()))
    const initialLabels=labels()
    report.initialWeekdays=shortWeekdays()
    report.fitsWidth=[...root.querySelectorAll('.timeline__date')].every(el=>el.scrollWidth<=el.clientWidth+1)
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
    report.overdueDrag=overdueState()
    report.startAnchor=[before,row().getBoundingClientRect().top]
    if (report.range.length < 20) return JSON.stringify(report)
    report.weekdays=shortWeekdays()
    report.stableLabels=initialLabels.every(before=>labels().some(after=>after.day===before.day && after.text===before.text && Math.abs(after.height-before.height)<=1))
    await picture('drag')
    // The month brings the folded past back, but not what the completed switch hides.
    report.hiddenVisible=!root.querySelector('[data-abele-anchor="task:'+folder+'/Sample completed.md"]') && !!root.querySelector('[data-abele-anchor="task:'+folder+'/Sample past.md"]')
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
    report.overdueCancel=overdueState()
    report.cancelState={ padding:root.querySelector('.abele-timeline__blocks').style.paddingTop, space:root.querySelector('.abele-timeline__anchor-space').style.height, ghost:!!document.querySelector('.abele-timeline__drag-card'), source:!!root.querySelector('.abele-timeline__drag-source'), dragging:!!root.querySelector('.abele-timeline__dragging'), target:!!root.querySelector('.abele-timeline__drop-target'), scroll:[initialScroll,scroller.scrollTop] }
    app.workspace.setActiveLeaf(leaf,{focus:true})
    await wait(200)
    await picture('cancel')
    align(); await settle()
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
    report.overdueDrop=overdueState()
    report.extraGone=dates().length===2 && !root.querySelector('[data-abele-anchor="task:'+folder+'/Sample completed.md"]') && !root.querySelector('[data-abele-anchor="task:'+folder+'/Sample past.md"]')
    // Exercise the real WebKit touch path: a fast swipe scrolls, a held swipe drags.
    if (window.__e2eHost) {
      const nativePoint=async()=>{
        let last='',stable=0,point
        await until(()=>{
          const r=row().getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+10),hit=document.elementFromPoint(x,y)
          const signature=JSON.stringify([r.x,r.y,r.width,r.height]),reachable=row().contains(hit)&&y>=0&&y<usableBottom()
          stable=reachable&&signature===last?stable+1:0;last=signature;point={x,y,rect:r.toJSON(),hit:hit?.className}
          return stable>=5
        })
        return point
      }
      const recordTouch=e=>report.events.push({phase:report.phase,type:e.type,x:e.touches[0]?.clientX,y:e.touches[0]?.clientY,target:e.target.className})
      document.addEventListener('touchstart',recordTouch,true)
      cleanups.push(()=>document.removeEventListener('touchstart',recordTouch,true))
      align(); await settle()
      const b=row().getBoundingClientRect(), bx=b.left+b.width/2, by=b.top+10
      let expanded=false, nativeStart, sourceBefore
      let nativeOverdueHidden=false
      const observer=new MutationObserver(()=>{
        if(dates().length>20) expanded=true
        if(dates().length>20 && overdueState()?.visibility==='hidden') nativeOverdueHidden=true
        const ghost=document.querySelector('.abele-timeline__drag-card')
        if(ghost && sourceBefore!==undefined && nativeStart===undefined) nativeStart=[sourceBefore,ghost.getBoundingClientRect().top]
      })
      observer.observe(root,{childList:true,subtree:true})
      cleanups.push(()=>observer.disconnect())
      report.phase='native fast swipe';const fast=await nativePoint()
      await window.__e2eHost.swipe(fast.x,fast.y,fast.x,fast.y-100,{velocity:500})
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
      report.phase='native held drag';const held=await nativePoint()
      await window.__e2eHost.swipe(held.x,held.y,held.x,nativeTarget.top+15,{hold:0.65,velocity:100})
      document.removeEventListener('touchend',record,true); document.removeEventListener('touchmove',beforeMove,true); observer.disconnect(); await wait(1200)
      report.nativeWritten=app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(folder+'/Sample moving.md'))?.frontmatter?.date===day(2)
      report.nativeDrag=expanded
      report.nativeOverdueHidden=nativeOverdueHidden
      report.nativeOverdueRestored=overdueState()?.visibility==='visible'
      report.nativeStart=nativeStart
      report.nativeDrop=[nativeEnd,row()?.getBoundingClientRect().top]
      align(); await settle()
      const edgeRow=row().getBoundingClientRect(), edgeY=usableBottom()-12
      let edgeStart, edgeDistance=0
      const nearEdge=e=>{ if(document.querySelector('.abele-timeline__drag-card') && e.touches[0]?.clientY>edgeY-35) { edgeStart??=scroller.scrollTop; edgeDistance=Math.max(edgeDistance,scroller.scrollTop-edgeStart) } }
      document.addEventListener('touchmove',nearEdge,true)
      cleanups.push(()=>document.removeEventListener('touchmove',nearEdge,true))
      report.phase='native edge drag';const near=await nativePoint()
      await window.__e2eHost.swipe(near.x,near.y,near.x,edgeY,{hold:0.65,velocity:60})
      document.removeEventListener('touchmove',nearEdge,true)
      report.nativeEdgeScroll=edgeDistance
      await wait(1000)
      report.nativeEdgeEnded=!document.querySelector('.abele-timeline__drag-card')
      await window.__e2eHost.shot(${JSON.stringify(shots)}+'/'+(${footer}?'footer':'sidebar')+'.png')
    }
    return JSON.stringify(report)
  } catch(error) {
    throw Error(String(error)+'; timeline delivery='+JSON.stringify(report))
  } finally {
    for(const cleanup of cleanups) cleanup()
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    if(leaf)await (${closeFixtureLeaves.toString()})([leaf])
    await app.workspace.changeLayout(layout)
    if(previousLeaf?.view?.containerEl.isConnected) app.workspace.setActiveLeaf(previousLeaf,{focus:true})
    const dir=owned && app.vault.getAbstractFileByPath(folder)
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
      expect(result.overdueBefore.visibility).toBe('visible')
      expect(result.overdueDrag.visibility).toBe('hidden')
      expect(result.overdueDrag.height).toBe(result.overdueBefore.height)
      expect(result.overdueCancel).toEqual(result.overdueBefore)
      expect(result.overdueDrop).toEqual(result.overdueBefore)
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
      expect(result.initialWeekdays).toBe(true)
      expect(result.fitsWidth).toBe(true)
      expect(result.weekdays).toBe(true)
      expect(result.stableLabels).toBe(true)
      expect(result.written).toBe(true)
      expect(Math.abs(result.dropAnchor[1] - result.dropAnchor[0])).toBeLessThanOrEqual(1)
      expect(result.extraGone).toBe(true)
      if (result.nativeSwipe !== undefined) {
        expect(result.nativeSwipe).toBe(true)
        expect(result.nativeDrag).toBe(true)
        expect(result.nativeOverdueHidden).toBe(true)
        expect(result.nativeOverdueRestored).toBe(true)
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
