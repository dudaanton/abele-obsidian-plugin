import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'sample-live-deck.md'
const SOURCE = `---
type: presentation
---
# Intro
---
\`\`\`slide-html
<button onclick="this.textContent='Clicked'">Click</button>
<script>document.body.dataset.loaded='yes'</script>
\`\`\`
---
# End
---
\`\`\`slide-script
script: Sample slide counter
refresh: enter
\`\`\``
const SCRIPT = `// @name Sample slide counter
const v = view({ title: 'Sample counter' })
const label = new Badge('Fresh value')
await show('## Sample markdown')
v.body = [label, new Button({ text: 'Update', onClick: () => { label.text = 'Updated value' } })]
await v.open()
`
let scriptPath: string
let layout: unknown
beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  scriptPath = JSON.parse(
    await evalLong(`(async()=>{
    const t=window.__abeleTest,folder=t.AbeleConfig.getInstance().ai.scriptsFolder,path=folder+'/Sample slide counter.js'
    if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder)
    if(app.vault.getAbstractFileByPath(path))throw Error('sample script fixture exists')
    await app.vault.create(path,${JSON.stringify(SCRIPT)})
    await t.ScriptService.getInstance().discover()
    const script=t.ScriptService.getInstance().get(path)
    if(!script)throw Error('sample script not indexed')
    t.ScriptService.getInstance().confirm(script)
    return JSON.stringify(path)
  })()`)
  ) as string
  expect(
    await evalLong(`(async()=>{
    if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))throw Error('sample fixture exists')
    const file=await app.vault.create(${JSON.stringify(PATH)},${JSON.stringify(SOURCE)})
    const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);return leaf.view.getViewType()
  })()`)
  ).toBe('abele-deck')
})
afterAll(async () => {
  if (!available) return
  evalRaw(`(async()=>{
    for(const leaf of app.workspace.getLeavesOfType('abele-deck'))if(leaf.view.file?.path===${JSON.stringify(PATH)})leaf.detach()
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(file)await app.vault.delete(file)
    const script=app.vault.getAbstractFileByPath(${JSON.stringify(scriptPath)});if(script)await app.vault.delete(script)
    await app.workspace.changeLayout(${JSON.stringify(layout)});return true
  })()`)
})
describe.skipIf(!available)('live slide lifecycle', () => {
  it('mounts a trusted script view and releases its controls on slide exit', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const viewer=leaf.view.viewer;await viewer.ready;await viewer.go(3)
      const until=async(fn)=>{for(let i=0;i<30;i++){if(fn())return true;await new Promise(r=>setTimeout(r,100))}return false}
      const ready=await until(()=>viewer.viewport.querySelector('.abele-slide:not([hidden]) .abele-script-view_live button'))
      const button=viewer.viewport.querySelector('.abele-slide:not([hidden]) .abele-script-view_live button')
      button?.click()
      const updated=await until(()=>viewer.viewport.textContent.includes('Updated value'))
      const markdown=!!viewer.viewport.querySelector('.abele-slide:not([hidden]) h2')
      await viewer.go(2)
      const stopped=!button?.isConnected
      await viewer.go(3)
      const rebuilt=await until(()=>viewer.viewport.querySelector('.abele-slide:not([hidden]) .abele-script-view_live button')!==button)
      return JSON.stringify({ready,updated,markdown,stopped,rebuilt})
    })()`)
    ) as Record<string, boolean>
    expect(result.ready, JSON.stringify(result)).toBe(true)
    expect(result.updated, JSON.stringify(result)).toBe(true)
    expect(result.markdown, JSON.stringify(result)).toBe(true)
    expect(result.stopped, JSON.stringify(result)).toBe(true)
    expect(result.rebuilt, JSON.stringify(result)).toBe(true)
  })

  it.skipIf(onPhone())(
    'runs live blocks in the audience popout but never in presenter previews',
    async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const view=leaf.view;await view.viewer.go(1);await view.startPresenter()
      try {
        const audience=app.workspace.getLeavesOfType('abele-deck').find(l=>l!==leaf && l.view.show===view.show)
        if(!audience)throw Error('no audience popout')
        const viewer=audience.view.viewer;await viewer.ready
        const frame=viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')
        const preview=view.presenter.current.viewport.querySelector('iframe')
        await viewer.go(3)
        const live=await (async()=>{for(let i=0;i<30;i++){if(viewer.viewport.querySelector('.abele-slide:not([hidden]) .abele-script-view_live button'))return true;await new Promise(r=>setTimeout(r,100))}return false})()
        return JSON.stringify({frame:!!frame,preview:!!preview,live,scriptPreview:!!view.presenter.current.viewport.querySelector('.abele-script-view_live')})
      } finally {view.show?.end()}
    })()`)
      ) as Record<string, boolean>
      expect(result).toEqual({ frame: true, preview: false, live: true, scriptPreview: false })
    }
  )

  it('runs a closed frame only on entry and ends it on departure', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const viewer=leaf.view.viewer
      await viewer.ready
      const before=viewer.viewport.querySelector('iframe')===null
      await viewer.go(1)
      const frame=viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')
      const policy=frame?.srcdoc ?? ''
      const isolated=frame?.getAttribute('sandbox')==='allow-scripts' && policy.includes("connect-src 'none'")
      await viewer.go(2)
      const removed=!frame.isConnected
      await viewer.go(1)
      return JSON.stringify({before,isolated,removed,restarted:viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')!==frame,phone:!!app.isMobile})
    })()`)
    ) as Record<string, boolean>
    expect(result.before).toBe(true)
    expect(result.isolated).toBe(true)
    expect(result.removed).toBe(true)
    expect(result.restarted).toBe(true)
    expect(result.phone).toBe(onPhone())
  })
})
