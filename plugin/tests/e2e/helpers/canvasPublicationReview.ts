import { outwardBoxShadowReach } from '../../helpers/focusRingPaint'
import { canvasControlFailure } from './canvasPublicationDiagnostics'

/** Synthetic file-scoped faults; settlement itself uses only the registered view action. */
export const PUBLICATION_PRELUDE = `
  const fixture = window.__canvasPublicationReviewFixture
  const dir = 'Sample publication review'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (predicate,phase='state') => { for (let i=0;i<60;i++) { if(predicate()) return; await wait(50) } throw Error('Canvas probe ['+phase+']: state did not arrive') }
  const scope = new window.__abeleTest.ScopeResolver(); scope.setFullVaultAccess(true)
  const ctx = { scope, interactive:true, agentId:'sample-agent' }
  const tools = Object.fromEntries(window.__abeleTest.createAgentTools().map(tool => [tool.name,tool]))
  const read = async () => JSON.parse((await tools.canvas_read.execute('sample-read',{path:fixture.path,detail:'full'},undefined,ctx)).content[0].text)
  const modal = () => document.querySelector('.abele-canvas-publication-review')
  const retained = () => JSON.stringify({draft:fixture.session.draft,evidence:fixture.session.publicationEvidence,baseline:fixture.session.committed,history:fixture.session.history,generation:fixture.session.generation});
`

export const PUBLICATION_SETUP = `
  const dir='Sample publication review'
  if (window.__canvasPublicationReviewFixture || app.vault.getAbstractFileByPath(dir)) throw Error('Synthetic Canvas review fixture already exists')
  const fixture=window.__canvasPublicationReviewFixture={layout:app.workspace.getLayout(),owned:false,trusted:[],events:[],captures:{},ids:new WeakMap(),nextId:0}
  await app.vault.createFolder(dir);fixture.owned=true
  fixture.listener = event => {
    if (!(event.target instanceof Element)) return
    const own = event.target.closest('.abele-canvas-publication-review') || fixture.view?.containerEl.contains(event.target)
    if(event.type==='click' && (event.target.closest('.abele-canvas-publication-review button') || event.target.closest('[aria-label="Recover failed canvas change"]')))
      fixture.trusted.push({text:event.target.closest('button')?.textContent ?? 'registered-action',trusted:event.isTrusted})
    if(!fixture.operation || fixture.events.length>=120) return
    const el=event.target, root=el.closest('.abele-canvas-publication-review')
    const identify=value=>{if(!value)return null;if(!fixture.ids.has(value))fixture.ids.set(value,++fixture.nextId);return fixture.ids.get(value)}
    fixture.events.push({index:fixture.events.length,at:performance.now(),operation:fixture.operation,type:event.type,
      trusted:event.isTrusted,x:event.clientX,y:event.clientY,button:event.button,buttons:event.buttons,
      target:{id:identify(el),tag:el.tagName,cls:(el.getAttribute('class')||'').slice(0,120),text:own?el.textContent?.trim().slice(0,100):null},
      path:event.composedPath().filter(node=>node instanceof Element).slice(0,12).map(identify),
      modal:identify(root),ownedModal:!!root&&root===fixture.view?.publicationReviewModal?.modalEl})
  }
  fixture.eventTypes=['pointermove','pointerdown','pointerup','mousedown','mouseup','click']
  fixture.eventTypes.forEach(type=>document.addEventListener(type,fixture.listener,true))
  return true
`

export const publicationFault = (fault: string): string => `
  ${PUBLICATION_PRELUDE}
  fixture.path=dir+'/sample-${fault}.canvas'
  await tools.canvas_create.execute('sample-create',{path:fixture.path,from:{graph:{nodes:[{id:'sample-card',kind:'text',label:'Original persisted sample',x:0,y:0}],edges:[]}}},undefined,ctx)
  const leaf=app.workspace.getLeaf('tab')
  await leaf.setViewState({type:'abele-canvas',state:{file:fixture.path},active:true})
  await until(()=>leaf.view.documentLease)
  fixture.view=leaf.view;fixture.file=leaf.view.file;fixture.session=leaf.view.documentLease.document.session
  if(!fixture.view.recoveryMenu.toString().includes('reviewPublication'))throw Error('Loaded Canvas view is not the local-review candidate')
  const approved=await read(), originalProcess=app.vault.process, originalDigest=crypto.subtle.digest
  let digestWrapper
  const processWrapper = async function(target,transform) {
    if(target!==fixture.file) return originalProcess.call(this,target,transform)
    if(${JSON.stringify(fault)}==='unpersisted') {transform(await app.vault.read(target));throw Error('Sample uncertain publication')}
    const published=await originalProcess.call(this,target,transform)
    if(${JSON.stringify(fault)}==='persisted') throw Error('Sample uncertain publication')
    digestWrapper = function(algorithm,data) {
      // Reject only the exact result-revision payload of this synthetic file, never another digest.
      let value
      try {value=JSON.parse(new TextDecoder().decode(data))} catch {}
      if(Array.isArray(value) && value[0]===published && typeof value[1]==='string' &&
         value[1].includes('Retained proposed sample')) {crypto.subtle.digest=originalDigest;return Promise.reject(Error('Sample result digest failure'))}
      return originalDigest.call(this,algorithm,data)
    }
    crypto.subtle.digest=digestWrapper
    return published
  }
  app.vault.process=processWrapper
  let failure
  try {
    await tools.canvas_edit.execute('sample-fault',{path:fixture.path,revision:approved.revision,
      ops:[{op:'update',id:'sample-card',patch:{text:'Retained proposed sample'}}]},undefined,ctx)
  } catch(error) {failure=error.outcome}
  finally {if(app.vault.process===processWrapper)app.vault.process=originalProcess;if(crypto.subtle.digest===digestWrapper)crypto.subtle.digest=originalDigest}
  if(failure!==(${JSON.stringify(fault)}==='digest'?'written-acknowledgment-pending':'unknown')) throw Error('Unexpected source outcome: '+failure)
  fixture.before=await app.vault.read(fixture.file);fixture.retained=retained();fixture.events=[];fixture.operation=null
  fixture.processCalls=0;fixture.ackCalls=0
  fixture.processOriginal=app.vault.process
  fixture.processCounter=function(target,transform){if(target===fixture.file)fixture.processCalls++;return fixture.processOriginal.call(this,target,transform)}
  app.vault.process=fixture.processCounter
  fixture.ackOriginal=fixture.session.acknowledge
  fixture.ackCounter=function(...args){fixture.ackCalls++;return fixture.ackOriginal.apply(this,args)}
  fixture.session.acknowledge=fixture.ackCounter
  return {outcome:failure,source:fixture.before,retained:fixture.retained,status:fixture.view.viewer.status.textContent}
`

export const PUBLICATION_CASE_CLEANUP = `
  ${PUBLICATION_PRELUDE}
  if(fixture.processCounter && app.vault.process===fixture.processCounter)app.vault.process=fixture.processOriginal
  if(fixture.session && fixture.session.acknowledge===fixture.ackCounter)fixture.session.acknowledge=fixture.ackOriginal
  fixture.processCounter=null;fixture.ackCounter=null
  // Failure-only cleanup, not acceptance proof: dispose only this synthetic session's memory.
  if(fixture.session?.dirty && !fixture.session.busy)fixture.session.discardDraft()
  if(fixture.view)fixture.view.leaf.detach()
  await until(()=>!modal())
  fixture.view=null;fixture.session=null;fixture.file=null
  return true
`

export const PUBLICATION_CLEANUP = `
  ${PUBLICATION_PRELUDE}
  if(!fixture) return true
  document.querySelector('.abele-canvas-publication-review .modal-close-button')?.click()
  if(fixture.processCounter && app.vault.process===fixture.processCounter)app.vault.process=fixture.processOriginal
  if(fixture.session && fixture.session.acknowledge===fixture.ackCounter)fixture.session.acknowledge=fixture.ackOriginal
  if(fixture.session?.dirty && !fixture.session.busy)fixture.session.discardDraft()
  const leaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.file?.path.startsWith(dir+'/'))leaves.push(leaf)})
  leaves.forEach(leaf=>leaf.detach())
  await until(()=>!modal())
  if(fixture.owned){const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)}
  if(fixture.layout)await app.workspace.changeLayout(fixture.layout)
  fixture.eventTypes.forEach(type=>document.removeEventListener(type,fixture.listener,true))
  delete window.__canvasPublicationReviewFixture
  return {fixtureRemoved:!app.vault.getAbstractFileByPath(dir),layoutRestored:true}
`

export const PUBLICATION_MEASURE = `
  ${PUBLICATION_PRELUDE}
  await until(()=>modal());await wait(150)
  const root=modal(),cuts=[],outside=[]
  const animations=[...root.getAnimations(),...(root.closest('.modal-container')?.getAnimations()??[])]
  await Promise.all(animations.filter(animation=>animation.playState==='running'&&animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))
  const viewport={width:innerWidth,height:innerHeight},bounds=root.getBoundingClientRect()
  if(bounds.left<0 || bounds.right>innerWidth+.5 || bounds.top<0 || bounds.bottom>innerHeight+.5) outside.push('modal')
  for(const field of root.querySelectorAll('button,summary')) {
    field.scrollIntoView({block:'center'});field.focus()
    const cs=getComputedStyle(field), shadow=(${outwardBoxShadowReach.toString()})(cs.boxShadow),
      reach=Math.max(shadow,cs.outlineStyle==='none'?0:parseFloat(cs.outlineWidth)+parseFloat(cs.outlineOffset||'0')),
      r=field.getBoundingClientRect()
    if(r.left<0 || r.right>innerWidth+.5 || r.top<0 || r.bottom>innerHeight+.5)outside.push(field.textContent)
    if(reach>0) for(let el=field.parentElement;el&&el!==document.documentElement;el=el.parentElement) {
      const s=getComputedStyle(el),b=el.getBoundingClientRect(),left=b.left+el.clientLeft,top=b.top+el.clientTop
      if(s.overflowX!=='visible' && Math.max(left-(r.left-reach),r.right+reach-(left+el.clientWidth))>.5)cuts.push(field.textContent+' horizontal')
      if(s.overflowY!=='visible' && Math.max(top-(r.top-reach),r.bottom+reach-(top+el.clientHeight))>.5)cuts.push(field.textContent+' vertical')
    }
    field.blur()
  }
  const paintedCuts=[]
  const baseline=root.querySelector('[data-review="baseline"]')?.parentElement.querySelector('summary')
  if(baseline){
    baseline.scrollIntoView({block:'center'})
    const range=document.createRange();range.selectNodeContents(baseline)
    for(const fragment of range.getClientRects())for(let el=baseline.parentElement;el&&el!==document.documentElement;el=el.parentElement){
      if(getComputedStyle(el).overflowX==='visible')continue
      const box=el.getBoundingClientRect(),left=box.left+el.clientLeft
      if(fragment.left<left-.5||fragment.right>left+el.clientWidth+.5)paintedCuts.push('original baseline text')
    }
  }
  const labels=[...root.querySelectorAll('button')].map(el=>el.textContent)
  return {cuts,outside,viewport,labels,paintedCuts,bodyOverflow:root.querySelector('.abele-modal__body').scrollWidth>root.querySelector('.abele-modal__body').clientWidth+1}
`

/** Bounded, read-only application observation; diagnostic ids live only in the test fixture. */
export const PUBLICATION_DIAGNOSTICS = `
  const f=window.__canvasPublicationReviewFixture
  const identify=node=>{if(!node||!f)return null;if(!f.ids.has(node))f.ids.set(node,++f.nextId);return f.ids.get(node)}
  const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
  const owner=f?.view?.publicationReviewModal?.modalEl??null
  const describe=node=>node instanceof Element?{id:identify(node),tag:node.tagName,cls:(node.getAttribute('class')||'').slice(0,120),connected:node.isConnected,
    text:node.closest('.abele-canvas-publication-review')||f?.view?.containerEl.contains(node)?node.textContent?.trim().slice(0,120):null,rect:rect(node)}:null
  const animations=root=>root?[...root.getAnimations(),...(root.closest('.modal-container')?.getAnimations()??[])].slice(0,8).map(a=>({state:a.playState,time:a.currentTime,iterations:a.effect?.getTiming().iterations})):[]
  const snapshot=element=>({
    at:performance.now(),operation:f?.operation??null,viewport:{width:innerWidth,height:innerHeight},
    owner:{modal:identify(owner),closed:f?.view?.closed??null,path:f?.file?.path??null,viewFileSame:!!f?.file&&f.view?.file===f.file,
      requestedFileSame:!!f?.file&&f.view?.requestedFile===f.file,generation:f?.session?.generation??null,
      documentSame:!!f?.session&&f.view?.documentLease?.document.session===f.session,
      incarnation:f?.view?.documentLease?.document.incarnation??null},
    control:describe(element),active:describe(document.activeElement),
    modals:[...document.querySelectorAll('.abele-canvas-publication-review')].slice(0,4).map(root=>({id:identify(root),owned:root===owner,connected:root.isConnected,rect:rect(root),
      text:root.textContent.slice(0,2400),buttons:[...root.querySelectorAll('button')].slice(0,8).map(describe),
      animations:animations(root),pointerEvents:getComputedStyle(root).pointerEvents,transform:getComputedStyle(root).transform})),
    events:f?.events?.slice(-40)??[],captures:Object.entries(f?.captures??{}).slice(-8).map(([id,job])=>({id,stage:job.stage,done:job.done??false,error:job.error??null,path:job.path,bytes:job.bytes??null})),process:f?.processCalls??null,ack:f?.ackCalls??null,history:f?.session?.history??null,
    dirty:f?.session?.dirty??null,outcome:f?.session?.publicationOutcome??null
  });
`

export function publicationControlPreparation(selector: string, label: string): string {
  return `
    ${PUBLICATION_DIAGNOSTICS}
    const modal=()=>document.querySelector('.abele-canvas-publication-review')
    const canvasControlFailure=${canvasControlFailure.toString()}
    const pause=()=>new Promise(resolve=>setTimeout(resolve,50))
    let last=null,previous=null
    for(let i=0;i<60;i++){
      const element=(${selector}), r=rect(element), x=r?r.left+r.width/2:0,y=r?r.top+r.height/2:0,
        hit=r?document.elementFromPoint(x,y):null,
        root=element?.closest('.abele-canvas-publication-review'),
        finite=animations(root).filter(a=>a.state==='running'&&a.iterations!==Infinity),
        state={present:!!element,connected:!!element?.isConnected,
          owned:!!element&&(root?root===owner:!!f?.view?.containerEl.contains(element)),
          animating:finite.length>0,inViewport:!!r&&r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
          hittable:!!element&&element.contains(hit)}
      const phase=canvasControlFailure(state)
      last={ready:false,phase:phase??'animation',state,snapshot:{...snapshot(element),point:{x,y},hit:describe(hit)}}
      // Two unchanged observations within the existing readiness budget, not a second gesture.
      const stable=JSON.stringify({id:identify(element),r,modal:identify(root)})
      if(!phase&&previous===stable){
        f.operation=${JSON.stringify(label)}
        return {...last,ready:true,phase:null,point:{x,y},target:identify(element),modal:identify(root)}
      }
      previous=phase?null:stable
      await pause()
    }
    return last
  `
}
