/** Invented persisted selections shared by the ordinary-link return probes. */
export const SELECTION_RETURN_SETUP = `(async () => {
  const chats=window.__abeleTest.ChatService.getInstance(), comments=window.__abeleTest.CommentService.getInstance()
  const storage=window.__abeleTest.ChatStorage.getInstance()
  const path='AI/Chats/sample-selection-source.abchat', nested=comments.commentPath('sample-selection-nested')
  const note='sample-selection-backlinks.md'
  for(const p of [path,nested,note])if(app.vault.getAbstractFileByPath(p))throw new Error('Selection fixture already exists: '+p)
  await storage.ensureFolder('AI/Chats');await storage.ensureFolder(nested.slice(0,nested.lastIndexOf('/')))
  const record=(chatId,id,content,text,start,path)=>{
    const reference={chatId,messageId:id,revisionId:'sample-version'}
    const range={space:'rendered',start,end:start+4}, projection={version:'chat-text-v1',text}
    const source={kind:'chat',...reference,role:'assistant',author:'assistant',quote:'echo',range,projectionVersion:projection.version,context:{before:text.slice(0,start),after:text.slice(start+4)}}
    const snapshot={text:'echo',sentence:text,title:'Sample selection',pathHint:path,source}
    return {k:'msg',id,parentId:'root',role:'assistant',content,timestamp:2,selection:{revisionId:reference.revisionId,versions:[{reference,content,projection}],anchors:[{id:'sample-anchor',original:reference,snapshot,placements:[{revision:reference,projectionVersion:projection.version,range}]}]}}
  }
  const meta=(chatId,extra={})=>({v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',chatId,...extra})
  const root={k:'msg',id:'root',role:'user',content:'A sample question.',timestamp:1}
  const answer=record('sample-source','answer','echo **echo**','echo echo',5,path)
  const records=[meta('sample-source',{activeLeafId:'other'}),root,answer,
    {k:'msg',id:'tail',parentId:'answer',role:'user',content:'A later message on the selected branch.',timestamp:3},
    {k:'msg',id:'other',parentId:'root',role:'assistant',content:'Another branch.',timestamp:4}]
  await app.vault.create(path,records.map(JSON.stringify).join('\\n')+'\\n')
  await app.vault.create(nested,[meta('sample-nested',{kind:'comment',anchor:{note:path,message:'answer',quote:'echo',start:5}}),root,
    record('sample-nested','nested-answer','echo echo','echo echo',5,nested)].map(JSON.stringify).join('\\n')+'\\n')
  await app.vault.create(note,'[['+path+'#abele-selection=sample-source/sample-anchor|Return to selection]]\\n\\n[['+nested+'#abele-selection=sample-nested/sample-anchor|Return to nested selection]]')
  return {path,nested,note}
})()`

export function selectionReturnProbe(shots: string): string {
  return `(async () => {
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const until=async fn=>{for(let i=0;i<120;i++){const value=fn();if(value)return value;await wait(40)}throw new Error('Selection return UI did not appear')}
  const chats=window.__abeleTest.ChatService.getInstance(), comments=window.__abeleTest.CommentService.getInstance()
  const path='AI/Chats/sample-selection-source.abchat', moved='AI/Chats/sample-selection-moved.abchat', copy='AI/Chats/sample-selection-copy.abchat'
  const nested=comments.commentPath('sample-selection-nested'), note='sample-selection-backlinks.md', report={}
  let leaf
  const shoot=async name=>{const target=${JSON.stringify(shots)}+'/'+name+'.png';if(window.__e2eHost)return window.__e2eHost.shot(target);const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage();require('fs').writeFileSync(target,image.toPNG())}
  const keyboard=()=>['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable===true
  const close=async p=>{const s=chats.getSessionByFile(p);if(s)await chats.closeTab(s.id)}
  const click=async n=>{await leaf.setViewState({type:'markdown',state:{file:note,mode:'preview'},active:true});const links=await until(()=>{const all=leaf.view.containerEl.querySelectorAll('a.internal-link');return all.length===2&&all});links[n].click()}
  const measure=()=>{const s=chats.activeSession.value, root=document.querySelector('[data-ask-message="'+(s?.kind==='comment'?'nested-answer':'answer')+'"]');const marks=[...(root?.querySelectorAll('[data-selection-return]')||[])];const box=document.querySelector('.abele-ai-chat__messages')?.getBoundingClientRect(), mark=marks[0]?.getBoundingClientRect();return {quote:marks.map(m=>m.textContent).join(''),firstUnmarked:root?.firstElementChild?.firstChild?.textContent,branch:s?.messages.value.map(m=>m.id),kind:s?.kind,keyboard:keyboard(),visible:!!mark&&!!box&&mark.top>=box.top&&mark.bottom<=box.bottom}}
  try {
    await close(path)
    const file=app.vault.getAbstractFileByPath(path);await app.vault.rename(file,moved)
    await app.vault.create(path,JSON.stringify({v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',chatId:'replacement'})+'\\n')
    leaf=app.workspace.getLeaf('tab')
    await click(0);await until(()=>document.querySelector('[data-selection-return]'));report.renamed=measure();await shoot('selection-return-renamed')
    await wait(2700);report.cleared=!document.querySelector('[data-selection-return]')
    if(window.__e2eHost){
      const root=document.querySelector('[data-ask-message="answer"]'), word=root.querySelector('strong'), bounds=word.getBoundingClientRect()
      await window.__e2eHost.longPress(bounds.left+bounds.width/2,bounds.top+bounds.height/2)
      const button=await until(()=>[...document.querySelectorAll('.abele-chat-selection_placed button')].find(button=>button.textContent.trim()==='Copy link to selection'))
      report.native={quote:document.getSelection()?.toString(),copied:false}
      await shoot('selection-native-handles')
      const write=navigator.clipboard.writeText.bind(navigator.clipboard)
      try {
        navigator.clipboard.writeText=async link=>{await write(link);report.native.copied=true;report.native.link=link}
        const r=button.getBoundingClientRect();await window.__e2eHost.tap(r.left+r.width/2,r.top+r.height/2)
        await until(()=>report.native.copied)
      } finally {navigator.clipboard.writeText=write;document.getSelection()?.removeAllRanges()}
    }
    await close(moved)
    const duplicate=await app.vault.create(copy,await app.vault.read(file))
    await click(0);await until(()=>document.querySelector('.modal-title')?.textContent==='Choose selection source')
    report.disambiguated=!document.querySelector('[data-selection-return]')
    await wait(600);await shoot('selection-return-copies')
    const choice=[...document.querySelectorAll('.modal button')].find(b=>b.textContent===moved);choice.click()
    await until(()=>document.querySelector('[data-selection-return]'));report.chosen=measure()
    await app.vault.delete(duplicate);await close(moved)
    const records=(await app.vault.read(file)).trim().split('\\n').map(line=>JSON.parse(line))
    const original=records.find(r=>r.k==='msg'&&r.id==='answer')
    await app.vault.append(file,JSON.stringify({...original,content:'echo changed echo',selection:{...original.selection,revisionId:'changed-version'}})+'\\n')
    await click(0);await until(()=>document.querySelector('.abele-anchor-history'))
    report.historical={explanation:document.querySelector('.abele-anchor-history').textContent,quote:document.querySelector('.abele-anchor-history blockquote')?.textContent,editable:!!document.querySelector('.abele-anchor-history input, .abele-anchor-history textarea'),keyboard:keyboard(),currentHighlighted:document.querySelector('[data-message-id="answer"]')?.classList.contains('abele-footnote-flash')||!!document.querySelector('[data-ask-message="answer"] [data-selection-return]')}
    await shoot('selection-return-history')
    ;[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Close').click()
    await click(1);await until(()=>chats.activeSession.value?.kind==='comment'&&document.querySelector('[data-selection-return]'))
    await wait(600);report.nested=measure();await shoot('selection-return-nested')
    await close(nested);await close(moved);await app.vault.delete(file)
    await click(0);await until(()=>[...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('selection source')))
    report.missing={notice:[...document.querySelectorAll('.notice')].map(n=>n.textContent).join(' '),replacementOpened:chats.activeSession.value?.currentChatFile.value?.path===path}
  } catch(error){report.error=String(error.stack||error)} finally {leaf?.detach()}
  return report
})()`
}

export const SELECTION_RETURN_CLEANUP = `(async () => {
  const chats=window.__abeleTest.ChatService.getInstance(), comments=window.__abeleTest.CommentService.getInstance()
  await comments.remove('sample-selection-nested')
  for(const path of ['AI/Chats/sample-selection-source.abchat','AI/Chats/sample-selection-moved.abchat','AI/Chats/sample-selection-copy.abchat','sample-selection-backlinks.md']){
    const s=chats.getSessionByFile(path);if(s)await chats.closeTab(s.id)
    const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.delete(file)
  }
  return true
})()`
