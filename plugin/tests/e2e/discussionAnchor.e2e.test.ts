import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-discussion-anchor')

/** Only synthetic saved conversations: opening a discussion never starts a provider. */
const probe = (layout: string) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for (let i=0; i<120; i++) { if (fn()) return; await wait(50) } throw Error('Discussion state did not appear: ' + fn.toString()) }
  const comments = window.__abeleTest.CommentService.getInstance()
  const chats = window.__abeleTest.ChatService.getInstance()
  const panel = () => [...document.querySelectorAll('.abele-discussion-anchor')].find(el => el.getClientRects().length)
  const ids = [], files = [], dirs = [], result = []
  const sourcePath = 'sample-anchor-source.abchat'
  const notePath = 'sample-anchor-note.md'
  const quote = 'Keep the soil moist until the seedlings emerge.'
  const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Growing seedlings', created: '2024-01-01' }
  const msg = (id,role,content,parentId) => ({ k:'msg',id,role,content,parentId,timestamp:1704110400000 })
  const log = (metadata,messages) => [metadata,...messages].map(JSON.stringify).join('\\n')+'\\n'
  const make = async (path,text) => { if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic fixture already exists'); const file=await app.vault.create(path,text); files.push(file); return file }
  const show = async (id, anchor, messages = []) => {
    const path=comments.commentPath(id)
    const segments=path.split('/').slice(0,-1)
    for(let i=1;i<=segments.length;i++){const dir=segments.slice(0,i).join('/');if(!app.vault.getAbstractFileByPath(dir)){await app.vault.createFolder(dir);dirs.unshift(dir)}}
    ids.push(id)
    const file=await make(path,log({...meta,kind:'comment',title:undefined,anchor},messages))
    const session=await comments.load(id,file)
    await comments.showInSidebar(id)
    await until(()=>panel()?.textContent.includes(anchor.quote))
    return session
  }
  const capture = async name => {
    const el=panel()
    el.closest('.abele-ai-chat__messages').scrollTop=0
    document.activeElement?.blur()
    await wait(450)
    const r=el.getBoundingClientRect()
    if(r.left<0 || r.right>innerWidth+1) throw Error('Discussion anchor overflows viewport')
    const path=${JSON.stringify(SHOTS + '/')}+${JSON.stringify(layout)}+'-'+name+'.png'
    if(window.__e2eHost) await window.__e2eHost.shot(path)
    else {const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(path,image.toPNG())}
    result.push(name)
  }
  const expand = async () => { panel().querySelector('.abele-discussion-anchor__context [aria-expanded]').click(); await until(()=>panel().querySelector('.abele-discussion-anchor__items')) }
  try {
    const source=await make(sourcePath,log(meta,[msg('q','user','How should I start seedlings?'),msg('a','assistant',quote,'q')]))
    await show('ask001',{note:sourcePath,message:'a',quote})
    if(panel().querySelector('.abele-discussion-anchor__items')) throw Error('Context must start folded')
    await capture('01-answer')
    await expand()
    if(!panel().textContent.includes('words only, no tool calls')) throw Error('Conversation context missing')
    await capture('02-context')
    await show('ask002',{note:sourcePath,message:'a',quote},[msg('u','user','How often should I water?'),msg('r','assistant','Check the surface each morning.','u')])
    await capture('03-after-qa')
    const long=Array.from({length:12},()=>quote).join(' ')
    await app.vault.modify(source,log(meta,[msg('q','user','How should I start seedlings?'),msg('a','assistant',long,'q')]))
    await show('ask003',{note:sourcePath,message:'a',quote:long})
    if(!panel().querySelector('.abele-quote__text_preview')) throw Error('Long quote must fold')
    await capture('04-long')
    const code='function water(seedling) {\\n  return seedling.soil.isDry ? "water" : "wait"\\n}'
    await app.vault.modify(source,log(meta,[msg('a','assistant','\\x60\\x60\\x60js\\n'+code+'\\n\\x60\\x60\\x60')]))
    await show('ask004',{note:sourcePath,message:'a',quote:code,code:true})
    if(!panel().querySelector('.abele-discussion-anchor__quote_code')) throw Error('Code typography missing')
    await capture('05-code')
    const note=await make(notePath,'# Growing seedlings\\n\\n'+quote+'%%c:ask005%%\\n\\nUse a bright windowsill.\\n')
    await show('ask005',{note:notePath,quote})
    await expand()
    if(!panel().textContent.includes('asking first')) throw Error('Selection permission missing')
    await capture('06-note')
    await app.vault.modify(source,log(meta,[msg('a','assistant',quote)]))
    const parent=await show('ask006',{note:sourcePath,message:'a',quote},[msg('u','user','How much light is enough?'),msg('r','assistant','A bright windowsill is suitable.','u')])
    await show('ask007',{note:parent.currentChatFile.value.path,message:'r',quote:'A bright windowsill'})
    await expand()
    if(!panel().textContent.includes('Where this discussion began')) throw Error('Nested lineage missing')
    await capture('07-nested')
    await comments.showInSidebar('ask001')
    await until(()=>panel()?.textContent.includes(quote))
    await app.vault.modify(source,log(meta,[msg('a','assistant','Let the soil dry slightly between watering.')]))
    await until(()=>panel()?.textContent.includes('changed since'))
    await capture('08-changed')
    await comments.showInSidebar('ask005')
    await until(()=>panel()?.textContent.includes('Growing seedlings') || panel()?.textContent.includes(quote))
    await app.vault.delete(note)
    await until(()=>panel()?.textContent.includes('deleted'))
    if(panel().querySelector('a.abele-discussion-anchor__back')) throw Error('Deleted source must have no link')
    await expand()
    await capture('09-deleted')
    return result
  } finally {
    for(const id of ids.reverse()) await comments.remove(id)
    for(const file of files.reverse()) if(app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
    for(const dir of dirs){const folder=app.vault.getAbstractFileByPath(dir);if(folder?.children?.length===0)await app.vault.delete(folder,true)}
  }
})()`

describe.runIf(available)('discussion anchor in real chat panes', () => {
  it('shows all nine states on desktop and phone geometry', async () => {
    const run = async (layout: string) => {
      const states = JSON.parse(await evalLong(probe(layout), 120_000)) as string[]
      expect(states).toHaveLength(9)
    }
    if (onPhone()) await run('phone')
    else {
      await run('desktop')
      await withEmulatedPhone(() => run('phone-emulated'))
    }
  }, 300_000)
})
