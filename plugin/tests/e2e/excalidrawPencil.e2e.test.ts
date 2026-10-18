import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'
import { pencilElements, referencePath } from '../helpers/excalidrawInkScene'
import { parseExcalidraw } from '../../src/canvas/excalidraw/source'
import { handwriting } from '../helpers/handwriting'
import { strokePath } from '../../src/ink/stroke'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample pencil migration'
const shots = shotDir('excalidraw-pencil')
// Private acceptance inputs are provided outside Git by the runner; never fixtures.
const acceptance = process.env.ABELE_INK_ACCEPTANCE_FILE
const cases = [
  {
    name: 'invented',
    text:
      '---\nexcalidraw-plugin: parsed\n---\n## Drawing\n```json\n' +
      JSON.stringify({ type: 'excalidraw', elements: pencilElements }) +
      '\n```\n',
  },
  ...(acceptance ? [{ name: 'acceptance', text: readFileSync(acceptance, 'utf8') }] : []),
]

describe.skipIf(!available)('pencil migration through the real command and ink plane', () => {
  let layout: unknown
  let size: number[]
  beforeAll(() => {
    layout = evalAsync('app.workspace.getLayout()')
    size = evalAsync("require('@electron/remote').getCurrentWindow().getContentSize()")
    evalAsync(`(async()=>{
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Fixture folder exists')
      await app.vault.createFolder(${JSON.stringify(DIR)});return true
    })()`)
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

  for (const sample of cases) {
    it(`preserves ${sample.name} source thickness and outline at 100% and fit on both displays`, async () => {
      const source = `${DIR}/${sample.name}.excalidraw.md`
      const target = `${DIR}/${sample.name}.canvas`
      const scene = parseExcalidraw(sample.text, source)
      const elements = scene.elements.filter((el) => el.type === 'freedraw')
      const paths = elements.map((el) =>
        referencePath(el as unknown as (typeof pencilElements)[number])
      )
      const stored = evalAsync<{
        path: string
        unchanged: boolean
        ink: { id: string; points: number[] }[]
      }>(`(async()=>{
        ${WAIT_PRELUDE}
        const file=await app.vault.create(${JSON.stringify(source)},${JSON.stringify(sample.text)})
        await app.workspace.getLeaf('tab').openFile(file)
        await until(()=>app.metadataCache.getFileCache(file)?.frontmatter)
        if(!app.commands.executeCommandById('abele:migrate-excalidraw-drawing'))throw Error('Migration command unavailable')
        const output=await until(()=>app.vault.getAbstractFileByPath(${JSON.stringify(target)}),30000)
        if(!output)throw Error('No migrated canvas')
        await until(()=>app.workspace.getActiveFile()?.path===output.path)
        const first=await app.vault.read(output)
        await app.workspace.getLeaf('tab').openFile(file)
        if(!app.commands.executeCommandById('abele:migrate-excalidraw-drawing'))throw Error('Migration command unavailable')
        const opened=await until(()=>app.workspace.getActiveFile()?.extension==='canvas'&&app.workspace.getActiveFile())
        return {path:opened.path,unchanged:await app.vault.read(output)===first&&await app.vault.read(file)===${JSON.stringify(sample.text)},ink:JSON.parse(await app.vault.read(opened)).abele.ink}
      })()`)
      expect
        .soft(stored.path, 'explicit re-migration creates a fresh canvas')
        .toBe(`${DIR}/${sample.name} 2.canvas`)
      expect(stored.unchanged, 'source and previous canvas bytes').toBe(true)
      expect(stored.ink).toHaveLength(elements.length)
      for (const el of elements) {
        const stroke = stored.ink.find((s) => s.id === el.id)!
        const points = el.points as number[][]
        expect(stroke.points.filter((_, i) => i % 3 !== 2)).toEqual(
          points.flatMap(([x, y]) => [x + el.x, y + el.y])
        )
      }
      // A native hand-sampled stroke beside the migrated drawing must retain its path.
      const handPath = strokePath(handwriting)
      for (const mobile of [false, true]) {
        await reloadApp(`app.emulateMobile(${mobile})`)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390,844' : '1100,800'})`
        )
        const measurements = evalAsync<
          { zoom: number; thickness: number; difference: number }[]
        >(`(async()=>{
          ${WAIT_PRELUDE}
          const file=app.vault.getAbstractFileByPath(${JSON.stringify(stored.path)})
          const leaf=app.workspace.getLeaf('tab')
          try{
            await leaf.setViewState({type:'abele-canvas',state:{file:file.path},active:true})
            await app.workspace.revealLeaf(leaf)
            const v=await until(()=>leaf.view.viewer?.graph?.abele?.ink?.length===${elements.length}&&leaf.view.viewer)
            if(!v)throw Error('Ink viewer not ready')
            const reference=${JSON.stringify(paths)}
            const phase=v.graph.abele.ink[0].freedraw?'after':'before'
            const results=[]
            for(const fit of [false,true]){
              if(fit)v.fit(false)
              else {
                const p=v.graph.abele.ink.flatMap(s=>s.points.filter((_,i)=>i%3!==2))
                const xs=p.filter((_,i)=>i%2===0),ys=p.filter((_,i)=>i%2===1)
                v.setCamera({x:(Math.min(...xs)+Math.max(...xs)-v.stage.clientWidth)/2,y:(Math.min(...ys)+Math.max(...ys)-v.stage.clientHeight)/2,zoom:1})
              }
              v.drawInk()
              await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
              const image=await require('@electron/remote').getCurrentWebContents().capturePage()
              require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(sample.name + '-' + (mobile ? 'phone' : 'desktop'))}+'-'+(fit?'fit':'100')+'-'+phase+'.png',image.toPNG())
              if(phase==='after'){
                // Reconstruct the previous renderer from the same persisted migration.
                // Only this in-memory viewer changes; no canvas file is rewritten.
                const after=v.graph
                const ink=after.abele.ink.map(({freedraw,...stroke})=>stroke)
                v.load({...after,abele:{...after.abele,ink}});v.drawInk()
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
                const before=await require('@electron/remote').getCurrentWebContents().capturePage()
                require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(sample.name + '-' + (mobile ? 'phone' : 'desktop'))}+'-'+(fit?'fit':'100')+'-before.png',before.toPNG())
                v.load(after);v.drawInk()
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
              }
              const plane=v.inkCanvas,expected=document.createElement('canvas')
              expected.width=plane.width;expected.height=plane.height
              const ctx=expected.getContext('2d'),ratio=plane.width/v.stage.clientWidth,c=v.camera
              ctx.setTransform(ratio*c.zoom,0,0,ratio*c.zoom,-c.x*ratio*c.zoom,-c.y*ratio*c.zoom)
              for(const path of reference)ctx.fill(new Path2D(path))
              const a=plane.getContext('2d').getImageData(0,0,plane.width,plane.height).data
              const b=ctx.getImageData(0,0,plane.width,plane.height).data
              let actual=0,total=0,difference=0
              for(let i=3;i<a.length;i+=4){actual+=a[i];total+=b[i];difference+=Math.abs(a[i]-b[i])}
              results.push({zoom:c.zoom,thickness:actual/total,difference:difference/total})
            }
            // Separate native ink canvas, using exactly the existing hand-sampled fixture.
            const nativePath=${JSON.stringify(handPath)}
            const hand=document.createElement('canvas');hand.width=180;hand.height=160
            hand.style.cssText='position:fixed;left:20px;top:120px;background:white;z-index:10000'
            hand.getContext('2d').fill(new Path2D(nativePath));document.body.append(hand)
            try{
              await new Promise(r=>requestAnimationFrame(r))
              const image=await require('@electron/remote').getCurrentWebContents().capturePage()
              require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(sample.name + '-' + (mobile ? 'phone' : 'desktop'))}+'-hand-'+phase+'.png',image.toPNG())
            }finally{hand.remove()}
            return results
          }finally{leaf.detach()}
        })()`)
        for (const measured of measurements) {
          console.log('Pencil outline ratios', sample.name, mobile ? 'phone' : 'desktop', measured)
          expect
            .soft(measured.thickness, 'rendered thickness / source outline')
            .toBeGreaterThanOrEqual(0.85)
          expect.soft(measured.thickness).toBeLessThanOrEqual(1.15)
          expect
            .soft(measured.difference, 'outline coverage including staircase edges')
            .toBeLessThan(0.05)
        }
      }
    }, 180_000)
  }
})
