import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas layers',
  SHOTS = shotDir('canvas-layers')
const run = <T>(code: string) =>
  evalAsync<T>(
    `(async () => {
  const path = ${JSON.stringify(`${DIR}/sample.canvas`)}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  ${code}
})()`,
    120_000
  )
describe.skipIf(!available)('mixed live/painted card compositing', () => {
  beforeAll(
    () =>
      run(`
    if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw Error('Synthetic folder already exists')
    window.__canvasLayersLayout = app.workspace.getLayout()
    window.__canvasLayersPreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer
    window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
    await app.vault.createFolder(${JSON.stringify(DIR)}); window.__canvasLayersOwned = true
    await app.vault.create(${JSON.stringify(`${DIR}/sample-image.svg`)}, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#44bb66"/></svg>')
    await app.vault.create(path, JSON.stringify({ nodes: [
      { id: 'alpha', type: 'text', text: ${JSON.stringify('# LOWER SAMPLE TEXT\n\nLOWER SAMPLE TEXT')}, x: 0, y: 0, width: 400, height: 160 },
      { id: 'beta', type: 'text', text: '', x: 0, y: 0, width: 400, height: 160 },
    ], edges: [] }))
    const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath(path)); await app.workspace.revealLeaf(leaf); await wait(700)
    return true
  `),
    120_000
  )
  afterAll(
    () =>
      run(`
    const leaves = []; app.workspace.iterateAllLeaves(l => { if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) }); leaves.forEach(l=>l.detach())
    if(window.__canvasLayersOwned) { const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if(dir) await app.vault.delete(dir,true) }
    if(window.__canvasLayersPreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer=window.__canvasLayersPreference
    if(window.__canvasLayersLayout) await app.workspace.changeLayout(window.__canvasLayersLayout)
    delete window.__canvasLayersLayout; delete window.__canvasLayersPreference; delete window.__canvasLayersOwned
    return true
  `),
    120_000
  )
  it('occludes lower live text with upper empty and image cards, then follows an external stacking reorder', () => {
    const result = run<{ blank: number; image: number; raised: number }>(`
      const view = app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path).view
      const file = app.vault.getAbstractFileByPath(path)
      const sample = async name => {
        view.viewer.setCamera({x:-30,y:-30,zoom:1}); await wait(500)
        const frame = view.contentEl.querySelector('[data-card-id="alpha"]').getBoundingClientRect()
        const image = await require('@electron/remote').getCurrentWebContents().capturePage({ x:Math.round(frame.x+20),y:Math.round(frame.y+58),width:300,height:40 })
        require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())
        const pixels=image.getBitmap(), colors=new Set()
        for(let i=0;i<pixels.length;i+=4) colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]+','+pixels[i+3])
        return colors.size
      }
      const blank = await sample('blank-over-text')
      const graph=JSON.parse(await app.vault.read(file))
      graph.nodes[1]={...graph.nodes[1],type:'file',file:${JSON.stringify(`${DIR}/sample-image.svg`)}}; delete graph.nodes[1].text
      await app.vault.modify(file,JSON.stringify(graph)); await wait(500)
      const image=await sample('image-over-text')
      graph.nodes.reverse(); await app.vault.modify(file,JSON.stringify(graph)); await wait(300)
      return {blank,image,raised:await sample('text-raised')}
    `)
    expect(result.blank).toBe(1)
    expect(result.image).toBe(1)
    expect(result.raised).toBeGreaterThan(1)
  }, 120_000)
})
