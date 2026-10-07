import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { SELECTION_RETURN_SETUP, SELECTION_RETURN_CLEANUP, selectionReturnProbe } from './helpers/selectionReturn'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('reply-return')
const script = `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
  const until = async fn => { for(let i=0;i<100;i++){const value=fn();if(value)return value;await wait(30)}throw new Error('Expected return UI did not appear') }
  const chats=window.__abeleTest.ChatService.getInstance(), comments=window.__abeleTest.CommentService.getInstance()
  const PATH='AI/Chats/sample-return-passage.abchat', active=chats.activeTabId.value, layout=app.workspace.getLayout()
  const made=[], ids=[], report={}
  const shoot=async name=>{
    const path=${JSON.stringify(shots)}+'/'+name+'.png'
    if(window.__e2eHost)return window.__e2eHost.shot(path)
    const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage();require('fs').writeFileSync(path,image.toPNG())
  }
  const measure=()=>{
    const box=document.querySelector('.abele-ai-chat__messages'), marks=[...box.querySelectorAll('[data-reply-return]')], message=box.querySelector('[data-message-id="sample-reply"]')
    const b=box.getBoundingClientRect(), r=marks[0]?.getBoundingClientRect(), m=message?.getBoundingClientRect()
    return {quote:marks.map(el=>el.textContent).join(''), visible:!!r&&r.top>=b.top&&r.bottom<=b.bottom, wholeMessageMarked:message?.classList.contains('abele-footnote-flash'), fromMessage:r&&m?Math.round(r.top-m.top):0, scroll:box.scrollTop}
  }
  try {
    for(const dir of ['AI','AI/Chats'])if(!app.vault.getAbstractFileByPath(dir)){await app.vault.createFolder(dir);made.unshift(dir)}
    if(app.vault.getAbstractFileByPath(PATH))throw new Error('Fixture already exists')
    const prefix=Array.from({length:30},(_,i)=>'Invented background paragraph '+i+' describes a quiet garden and its paths.').join('\\n\\n')
    const source='The distant lantern glows.\\n\\n'+prefix+'\\n\\nAt the lower gate the **distant lantern glows** beside the path.\\n\\n'+prefix
    const plain='The distant lantern glows.'+prefix.replace(/\\n/g,'')+'At the lower gate the distant lantern glows beside the path.'+prefix.replace(/\\n/g,'')
    // Obtain the actual rendered offset instead of assuming block-separator whitespace.
    const records=[{v:2,k:'meta',type:'abele-chat',title:'Sample passage return',providerId:'',modelId:'',created:''},{k:'msg',id:'sample-reply',role:'assistant',content:source,timestamp:1}]
    const file=await app.vault.create(PATH,records.map(r=>JSON.stringify(r)).join('\\n')+'\\n')
    await chats.openChatFile(file);await chats.revealSidebar();const parent=chats.getSessionByFile(PATH)
    const md=await until(()=>document.querySelector('[data-ask-message="sample-reply"] strong'))
    await wait(100)
    const root=md.closest('[data-ask-message]'), walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
    let node,text='';while(node=walker.nextNode())text+=node.textContent
    const quote='distant lantern glows', start=text.lastIndexOf(quote)
    report.occurrences=text.split(quote).length-1
    const child=await comments.createOnMessage(parent,'sample-reply',quote,start);ids.push(child.commentId)
    await child.addUserNote('An invented side question about these words.')
    const back=await until(()=>document.querySelector('.abele-ai-chat__header .lucide-corner-up-left'))
    back.closest('.abele-obsidian-icon').click()
    await until(()=>document.querySelector('[data-reply-return]'));await wait(250)
    report.back=measure();await shoot('back-to-selected-passage')
    const nested=await comments.createOnMessage(parent,'sample-reply',quote,start);ids.push(nested.commentId)
    await nested.addUserNote('Another invented side question.')
    const crumb=await until(()=>document.querySelector('.abele-comment-trail .abele-breadcrumbs__item:not(.abele-breadcrumbs__item_current)'))
    crumb.click();await until(()=>document.querySelector('[data-reply-return]'));await wait(250)
    report.trail=measure();await shoot('trail-to-selected-passage')
    await wait(2700)
    report.cleared=!document.querySelector('[data-reply-return]')
  } catch(error) {report.error=String(error.stack||error)} finally {
    for(const id of ids)if(id)await comments.remove(id)
    const session=chats.getSessionByFile(PATH);if(session)await chats.closeTab(session.id)
    const file=app.vault.getAbstractFileByPath(PATH);if(file)await app.vault.delete(file)
    for(const dir of made){const f=app.vault.getAbstractFileByPath(dir);if(f&&!f.children.length)await app.vault.delete(f)}
    if(active)chats.switchTab(active)
    await app.workspace.changeLayout(layout)
  }
  return report
})()`

describe.runIf(available)('returning from a comment to its reply passage', () => {
  let size: number[] = [],
    report: any
  beforeAll(async () => {
    if (!onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
    }
    report = JSON.parse(await evalLong(script, 70_000))
  }, 150_000)
  afterAll(async () => {
    if (!onPhone()) {
      if (size.length)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
        )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 90_000)
  it('completes without errors', () => expect(report.error).toBeUndefined())
  it.each(['back', 'trail'])(
    '%s returns to the selected repeated passage, not the reply start',
    (action) => {
      expect(report.occurrences).toBe(2)
      expect(report[action].quote).toBe('distant lantern glows')
      expect(report[action].visible).toBe(true)
      expect(report[action].fromMessage).toBeGreaterThan(500)
      expect(report[action].scroll).toBeGreaterThan(500)
      expect(report[action].wholeMessageMarked).toBe(false)
    }
  )
  it('briefly marks the passage and removes that mark afterward', () =>
    expect(report.cleared).toBe(true))
})

describe.runIf(available)('ordinary backlinks to durable selections', () => {
  let size: number[] = [], report: any
  beforeAll(async () => {
    if (!onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
    }
    await evalLong(SELECTION_RETURN_SETUP)
    await reloadApp('window.location.reload()')
    report = JSON.parse(await evalLong(selectionReturnProbe(shots), 70_000))
  }, 180_000)
  afterAll(async () => {
    await evalLong(SELECTION_RETURN_CLEANUP)
    if (!onPhone()) {
      if (size.length) evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`)
      await reloadApp('app.emulateMobile(false)')
    }
  }, 90_000)
  it('completes after a reload without errors', () => expect(report.error).toBeUndefined())
  it('uses chat identity after rename and path reuse and switches to a containing descendant', () => {
    expect(report.renamed.quote).toBe('echo')
    expect(report.renamed.firstUnmarked).toBe('echo ')
    expect(report.renamed.branch).toEqual(['root', 'answer', 'tail'])
    expect(report.renamed.visible).toBe(true)
    expect(report.renamed.keyboard).toBe(false)
    expect(report.cleared).toBe(true)
  })
  it.runIf(onPhone())('keeps native touch selection and copies its durable link on the phone', () => {
    expect(report.native.quote).toBe('echo')
    expect(report.native.copied).toBe(true)
    expect(report.native.link).toContain('#abele-selection=sample-source/sample-anchor')
  })
  it('reconciles a newly synced anchor while keeping the conversation open', () => {
    expect(report.syncedAnchor.sameSession).toBe(true)
    expect(report.syncedAnchor.available).toBe(true)
    expect(report.syncedAnchor.quote).toBe('echo')
  })
  it('shows an edit synced into an already-open reply historically, without marking the cached reply', () => {
    expect(report.syncedEdit.sameSession).toBe(true)
    expect(report.syncedEdit.content).toBe('echo edited elsewhere echo')
    expect(report.syncedEdit.explanation).toContain('earlier version')
    expect(report.syncedEdit.currentHighlighted).toBe(false)
  })
  it('requires an explicit choice between duplicate copies', () => {
    expect(report.disambiguated).toBe(true)
    expect(report.chosen.quote).toBe('echo')
  })
  it('shows the retained earlier version read-only without opening the keyboard', () => {
    expect(report.historical.explanation).toContain('earlier version')
    expect(report.historical.quote).toBe('echo')
    expect(report.historical.editable).toBe(false)
    expect(report.historical.keyboard).toBe(false)
    expect(report.historical.currentHighlighted).toBe(false)
  })
  it('returns into a nested discussion at the exact selected occurrence', () => {
    expect(report.nested.quote).toBe('echo')
    expect(report.nested.firstUnmarked).toBe('echo ')
    expect(report.nested.kind).toBe('comment')
    expect(report.nested.visible).toBe(true)
    expect(report.nested.keyboard).toBe(false)
  })
  it('reports a deleted source instead of opening the replacement at its old path', () => {
    expect(report.missing.notice).toContain('selection source')
    expect(report.missing.replacementOpened).toBe(false)
  })
})
