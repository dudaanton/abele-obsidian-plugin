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
    'does not run the first slide when a show starts on a later slide',
    async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const view=leaf.view,viewer=view.viewer,file=view.file
      await viewer.go(2)
      const source=${JSON.stringify(SOURCE.replace('# Intro', '```slide-script\nscript: Sample slide counter\nrefresh: enter\n```'))}
      await app.vault.modify(file,source)
      const until=async(fn)=>{for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('update timed out')}
      await until(()=>viewer.model?.slides[0]?.regions[0]?.blocks[0]?.type==='script')
      const runs=window.__abeleTest.ScriptRuns.getInstance()
      const count=()=>runs.runs.value.filter(r=>r.path===${JSON.stringify(scriptPath)}).length
      const before=count()
      try {
        await view.startPresenter()
        return JSON.stringify({extra:count()-before,index:view.show.index})
      } finally {view.show?.end();await app.vault.modify(file,${JSON.stringify(SOURCE)})}
    })()`)
      ) as { extra: number; index: number }
      expect(result).toEqual({ extra: 0, index: 2 })
    }
  )

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

  it('asks once per deck before enabling HTTPS resources in a frame', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const viewer=leaf.view.viewer,file=leaf.view.file
      const key='abele-slide-network:'+file.path
      app.saveLocalStorage(key,null)
      await viewer.go(0)
      await app.vault.modify(file,${JSON.stringify(SOURCE.replace('type: presentation', 'type: presentation\nhtmlNetwork: true').replace('---\n# End', '```slide-html\n<h2>Parallel frame</h2>\n```\n---\n# End'))})
      try {
        const until=async(fn)=>{for(let i=0;i<50;i++){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,100))}return null}
        await until(()=>viewer.model?.settings.properties.htmlNetwork===true)
        const pending=viewer.go(1)
        const button=await until(()=>[...document.querySelectorAll('.modal-container button')].find(b=>b.textContent?.includes('Allow network')))
        const asked=!!button
        const dialogs=document.querySelectorAll('.modal-container').length
        button?.click()
        await pending
        await until(()=>viewer.viewport.querySelectorAll('.abele-slide:not([hidden]) iframe').length===2)
        const frames=[...viewer.viewport.querySelectorAll('.abele-slide:not([hidden]) iframe')]
        const allowed=frames.length===2 && frames.every(f=>f.srcdoc.includes('connect-src https:') && f.getAttribute('sandbox')==='allow-scripts')
        await viewer.go(0)
        await viewer.go(1)
        const remembered=viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')?.srcdoc.includes('connect-src https:') && !document.querySelector('.modal-container')
        return JSON.stringify({asked,dialogs,allowed,remembered})
      } finally {
        await viewer.go(0)
        await app.vault.modify(file,${JSON.stringify(SOURCE)})
        app.saveLocalStorage(key,null)
      }
    })()`)
    ) as Record<string, boolean>
    expect(result).toEqual({ asked: true, dialogs: 1, allowed: true, remembered: true })
  })

  it('refuses offline script execution and declarative navigation on mobile and desktop', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const viewer=leaf.view.viewer,file=leaf.view.file
      let executed=false
      const onMessage=e=>{if(e.data==='sample-offline-script')executed=true}
      window.addEventListener('message',onMessage)
      const attack='---\\ntype: presentation\\n---\\n# Offline sample\\n'+String.fromCharCode(96).repeat(3)+'slide-html\\n<h2>Static table</h2><script>parent.postMessage("sample-offline-script","*");location.replace("https://sample.example.test/leak")</script><meta http-equiv="refresh" content="0;url=https://sample.example.test/leak"><a href="https://sample.example.test/leak">Link</a>\\n'+String.fromCharCode(96).repeat(3)
      try {
        await viewer.go(0);await app.vault.modify(file,attack)
        for(let i=0;i<50 && viewer.model?.slides[0]?.title!=='Offline sample';i++)await new Promise(r=>setTimeout(r,100))
        await viewer.ready;await new Promise(r=>setTimeout(r,1000))
        const frame=viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')
        const parsed=new DOMParser().parseFromString(frame.srcdoc,'text/html')
        return JSON.stringify({executed,static:frame.getAttribute('sandbox')==='',safe:!parsed.querySelector('script,a[href],meta[http-equiv="refresh"]'),content:parsed.querySelector('h2')?.textContent})
      } finally {window.removeEventListener('message',onMessage);await app.vault.modify(file,${JSON.stringify(SOURCE)})}
    })()`)
    ) as Record<string, unknown>
    expect(result).toEqual({ executed: false, static: true, safe: true, content: 'Static table' })
  })

  it.skipIf(onPhone())(
    'blocks offline self-navigation before any request leaves the browser',
    async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      const viewer=leaf.view.viewer,file=leaf.view.file
      let requests=0
      const server=require('http').createServer((req,res)=>{requests++;res.end('<p>network reached</p>')})
      await new Promise(r=>server.listen(0,'127.0.0.1',r))
      const url='http://127.0.0.1:'+server.address().port+'/sample-offline-leak'
      const attack='# Attack\\n\\n'+String.fromCharCode(96).repeat(3)+'slide-html\\n<h2>Offline sample</h2><script>location.replace('+JSON.stringify(url)+')</script><meta http-equiv="refresh" content="0;url='+url+'"><a href="'+url+'" ping="'+url+'">Link</a>\\n'+String.fromCharCode(96).repeat(3)
      try {
        await viewer.go(0)
        await app.vault.modify(file,'---\\ntype: presentation\\n---\\n'+attack)
        for(let i=0;i<50 && viewer.model?.slides[0]?.title!=='Attack';i++)await new Promise(r=>setTimeout(r,100))
        await viewer.ready
        await new Promise(r=>setTimeout(r,1500))
        const frame=viewer.viewport.querySelector('.abele-slide:not([hidden]) iframe')
        return JSON.stringify({requests,static:frame?.getAttribute('sandbox')==='',label:viewer.viewport.textContent.includes('scripts disabled')})
      } finally {
        await app.vault.modify(file,${JSON.stringify(SOURCE)})
        await new Promise(r=>server.close(r))
      }
    })()`)
      ) as { requests: number; static: boolean; label: boolean }
      expect(result).toEqual({ requests: 0, static: true, label: true })
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
      // Offline mode deliberately has no executable capability, a stronger guarantee than CSP alone.
      const isolated=frame?.getAttribute('sandbox')==='' && policy.includes("connect-src 'none'") && policy.includes("script-src 'none'")
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
