import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drawingSvg } from '../../src/drawing/drawingFile'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const directory = `Sample conversion ${randomUUID()}`
const shots = shotDir('drawing-conversion')
const svg = drawingSvg({
  items: [
    {
      id: 'sample-ink',
      type: 'stroke',
      tool: 'pen',
      color: 'blue',
      size: 5,
      linear: true,
      points: [0, 0, 0.5, 120, 80, 0.8, 240, 0, 0.4],
    },
  ],
})

describe.skipIf(!available)('legacy conversion command', () => {
  afterAll(async () => {
    evalAsync(`(async()=>{
      const owned=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(directory + '/')}))owned.push(l)})
      for(const leaf of owned)leaf.detach()
      const folder=app.vault.getAbstractFileByPath(${JSON.stringify(directory)})
      if(folder)await app.vault.delete(folder,true)
      return true
    })()`)
    await reloadApp('app.emulateMobile(false)')
  })
  for (const mobile of [false, true])
    it(`converts without changing originals (${mobile ? 'phone' : 'desktop'})`, async () => {
      await reloadApp(`app.emulateMobile(${mobile})`)
      const result = evalAsync<{
        unchanged: boolean
        duplicate: boolean
        ink: number
        creationRemoved: boolean
      }>(
        `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async fn=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await wait(50)}throw Error('Timed out')}
      const dir=${JSON.stringify(directory)}, source=dir+'/sample.svg', dest=dir+'/sample.canvas'
      if(!app.vault.getAbstractFileByPath(dir))await app.vault.createFolder(dir)
      if(!app.vault.getAbstractFileByPath(source))await app.vault.create(source,${JSON.stringify(svg)})
      // The bulk command must not touch fixtures owned by a different test.
      for(const file of app.vault.getFiles().filter(f=>f.extension==='svg'&&!f.path.startsWith(dir+'/')))
        if((await app.vault.read(file)).includes('data-abele-drawing='))throw Error('Unrelated legacy drawing fixture is present')
      if(!app.commands.executeCommandById('abele:convert-drawings-to-canvases'))throw Error('Missing conversion command')
      await until(()=>app.vault.getAbstractFileByPath(dest))
      await wait(200)
      app.commands.executeCommandById('abele:convert-drawings-to-canvases')
      await wait(300)
      const graph=JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(dest)))
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:dest},active:true});await app.workspace.revealLeaf(leaf)
      await until(()=>leaf.view.viewer?.stage?.clientWidth)
      await wait(600)
      const image=await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(shots)},{recursive:true})
      require('fs').writeFileSync(${JSON.stringify(shots)}+'/${mobile ? 'phone' : 'desktop'}-converted.png',image.toPNG())
      return {unchanged:await app.vault.read(app.vault.getAbstractFileByPath(source))===${JSON.stringify(svg)},
        duplicate:!!app.vault.getAbstractFileByPath(dir+'/sample 2.canvas'),ink:graph.abele.ink.length,
        creationRemoved:!app.commands.commands['abele:new-drawing']&&!app.commands.commands['abele:insert-drawing']}
    })()`,
        120000
      )
      expect(result).toEqual({ unchanged: true, duplicate: false, ink: 1, creationRemoved: true })
    }, 180000)
})
