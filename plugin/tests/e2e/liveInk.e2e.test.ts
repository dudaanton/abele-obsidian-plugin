import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'
import { strokePath, roundPoint } from '../../src/ink/stroke'
import { StylusSmoother } from '../../src/ink/smoothing'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample live ink'
const shots = shotDir('live-ink')

describe.skipIf(!available)('live pencil input and frame cost', () => {
  let layout: unknown, size: number[]
  beforeAll(() => {
    layout = evalAsync('app.workspace.getLayout()')
    size = evalAsync("require('@electron/remote').getCurrentWindow().getContentSize()")
    evalAsync(
      `(async()=>{if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Fixture folder exists');await app.vault.createFolder(${JSON.stringify(DIR)});return true})()`
    )
  })
  afterAll(async () => {
    evalAsync(`(async()=>{
      const leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
      for(const leaf of leaves)leaf.detach()
      const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)
      return true
    })()`)
    await reloadApp('app.emulateMobile(false)')
    evalAsync(
      `(async()=>{await app.workspace.changeLayout(${JSON.stringify(layout)});return true})()`
    )
    if (size)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size.join(',')})`)
  })

  for (const mobile of [false, true]) {
    it(`draws pen, mouse and finger on ${mobile ? 'phone emulation' : 'desktop'} with a responsive long stroke`, async () => {
      await reloadApp(`app.emulateMobile(${mobile})`)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390,844' : '1100,800'})`
      )
      const result = evalAsync<{
        strokes: {
          tool: 'pen'
          size: number
          points: number[]
          freedraw: { simulatePressure: boolean }
        }[]
        paint95: number
        frame95: number
        maxPaint: number
      }>(
        `(async()=>{
        ${WAIT_PRELUDE}
        app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()
        const file=await app.vault.create(${JSON.stringify(`${DIR}/${mobile ? 'phone' : 'desktop'}.canvas`)},JSON.stringify({nodes:[],edges:[]}))
        const leaf=app.workspace.getLeaf('tab')
        await leaf.setViewState({type:'abele-canvas',state:{file:file.path},active:true});await app.workspace.revealLeaf(leaf)
        const view=await until(()=>leaf.view.editor&&leaf.view.viewer&&leaf.view)
        if(!view)throw Error('Canvas editor not ready')
        view.editor.useTool('pen')
        const v=view.viewer,stage=v.stage,win=stage.ownerDocument.defaultView
        await new Promise(r=>setTimeout(r,250))
        v.setCamera({x:0,y:0,zoom:1})
        const frame=()=>new Promise(r=>win.requestAnimationFrame(r))
        const send=(type,kind,id,x,y,p)=>{
          const rect=stage.getBoundingClientRect()
          stage.dispatchEvent(new win.PointerEvent(type,{bubbles:true,pointerType:kind,pointerId:id,clientX:rect.left+x,clientY:rect.top+y,pressure:p,buttons:type==='pointerup'?0:1,button:0,isPrimary:true}))
        }
        for(const [row,kind] of ['pen','mouse','touch'].entries()){
          // Leave room for the phone's expanded drawing toolbar above all three rows.
          const start=180+row*80
          const finger=view.editor.controls.fingerDraws()
          if(kind==='touch')view.editor.controls.setFingerDraws(true)
          try{
          v.setCamera({x:0,y:0,zoom:1})
          await frame()
          send('pointerdown',kind,row+1,35,start,kind==='pen'?0.05:0.5)
          for(let i=1;i<=120;i++)send('pointermove',kind,row+1,35+i*2,start+18*Math.sin(i/18),kind==='pen'?0.05+0.85*Math.sin(i*Math.PI/120):0.5)
          send('pointerup',kind,row+1,275,start+18*Math.sin(120/18),0)
          if(!await until(()=>v.graph.abele?.ink?.length===row+1&&!view.documentLease.document.session.dirty))throw Error('Stroke not saved: '+kind+'; count='+v.graph.abele?.ink?.length)
          }finally{if(kind==='touch')view.editor.controls.setFingerDraws(finger)}
        }
        const strokes=JSON.parse(await app.vault.read(file)).abele.ink
        v.setCamera({x:0,y:0,zoom:1});v.drawInk()
        await frame();await frame()
        require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(mobile ? 'phone' : 'desktop')}+'-proof.json',JSON.stringify({camera:v.camera,strokes}))
        const shot=async(name)=>{const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(mobile ? 'phone' : 'desktop')}+'-'+name+'.png',image.toPNG())}
        await shot('after')
        const paints=[],intervals=[],paint=v.paintInk
        v.paintInk=function(){const start=performance.now();try{return paint.call(this)}finally{paints.push(performance.now()-start)}}
        const width=Math.max(200,Math.min(900,stage.clientWidth-40)),height=Math.min(380,stage.clientHeight-100)
        let previous=performance.now()
        send('pointerdown','pen',10,width/2+20,height/2+50,0.2)
        try{
          for(let f=0;f<200;f++){
            for(let k=0;k<40;k++){
              const i=f*40+k
              send('pointermove','pen',10,20+width/2+width*.4*Math.sin(i/23),50+height/2+height*.35*Math.sin(i/37),.2+.6*(1+Math.sin(i/47))/2)
            }
            await frame()
            const now=performance.now();intervals.push(now-previous);previous=now
          }
          await frame();await frame();await shot('long-in-progress')
        }finally{
          send('pointerup','pen',10,width/2+20,height/2+50,0)
          v.paintInk=paint
        }
        if(!await until(()=>v.graph.abele?.ink?.length===4&&!view.documentLease.document.session.dirty))throw Error('Long stroke not saved')
        const percentile=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length*.95)]
        return {strokes,paint95:percentile(paints),frame95:percentile(intervals),maxPaint:Math.max(...paints)}
      })()`,
        180_000
      )
      expect(result.strokes.map((s) => s.freedraw?.simulatePressure)).toEqual([false, true, true])
      result.strokes.forEach((s, row) => {
        expect(s.points[0], 'input x stays in the same world frame').toBeCloseTo(35, 5)
        expect(s.points[1], 'each pointer has a separate visible stroke row').toBeCloseTo(
          180 + row * 80,
          5
        )
      })
      console.log('Live ink frame costs', mobile ? 'phone' : 'desktop', {
        paint95: result.paint95,
        frame95: result.frame95,
        maxPaint: result.maxPaint,
      })
      expect.soft(result.paint95, '95th percentile ink paint, milliseconds').toBeLessThan(16.7)
      expect.soft(result.frame95, '95th percentile frame interval, milliseconds').toBeLessThan(25)
      const before = result.strokes.map((stroke, row) => {
        let points: number[] = []
        if (row === 0) {
          const smooth = new StylusSmoother(1)
          for (let i = 0; i < stroke.points.length; i += 3)
            smooth.add(stroke.points[i], stroke.points[i + 1], stroke.points[i + 2])
          points = smooth.points
        } else
          for (let i = 0; i < stroke.points.length; i += 3)
            points.push(...roundPoint(stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]))
        return strokePath({
          ...stroke,
          color: 'black',
          freedraw: undefined,
          linear: row === 0 ? true : undefined,
          points,
        })
      })
      expect(
        evalAsync<boolean>(`(async()=>{
        ${WAIT_PRELUDE}
        const view=app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===${JSON.stringify(`${DIR}/${mobile ? 'phone' : 'desktop'}.canvas`)})?.view
        const v=view.viewer,ctx=v.inkCanvas.getContext('2d'),ratio=v.inkCanvas.width/v.stage.clientWidth
        ctx.resetTransform();ctx.clearRect(0,0,v.inkCanvas.width,v.inkCanvas.height);ctx.scale(ratio,ratio)
        ctx.fillStyle=getComputedStyle(v.el).getPropertyValue('--text-normal')||'#1e1e1e'
        for(const path of ${JSON.stringify(before)})ctx.fill(new Path2D(path))
        await new Promise(r=>requestAnimationFrame(r))
        const image=await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(shots + '/' + (mobile ? 'phone' : 'desktop') + '-before.png')},image.toPNG())
        v.drawInk();return true
      })()`)
      ).toBe(true)
    }, 240_000)
  }
})
