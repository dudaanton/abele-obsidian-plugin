import { settledGeometry } from './settledGeometry'
import { outwardBoxShadowReach } from './focusRingPaint'
import { manualControlReady } from './manualControlReady'
import { restoreConsentOwner } from './restoreConsentOwner'
import { consentCleanupStages } from './consentCleanupStages'

/** Browser side of a staged probe. Native input is deliberately supplied by the host between jobs. */
export function manualKeyConsentProbe(shots: string, token: string, physical: boolean): string {
  return `(async () => {
    if (window.__sampleManualConsent) throw Error('Sample consent fixture already exists')
    const t=window.__abeleTest,config=t.AbeleConfig.getInstance(),store=t.secrets()
    const s=window.__sampleManualConsent={token:${JSON.stringify(token)},physical:${physical},oldAi:config.ai,
      layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id,
      windowBefore:[innerWidth,innerHeight],themeBefore:app.vault.getConfig('theme'),
      panesBefore:app.workspace.getLeavesOfType('abele-ai-sidebar-view').map(leaf=>leaf.id),
      modal:null,keyId:null,installed:false,calls:0,events:[],current:null,baseline:null,
      keys:['abele-key-destinations-v1','abele-key-http-origins-v1'],local:[],out:{outside:[],ringCuts:[],geometry:[]}}
    const origin='http://192.168.42.12:8123',value='fake-native-key-material',name='Sample native key'
    // The App API is vault-specific. Detach objects; never enumerate shared raw storage.
    s.local=s.keys.map(key=>{const value=app.loadLocalStorage(key);return value==null?null:JSON.parse(JSON.stringify(value))})
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
    const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(fn())return;await wait(50)}throw Error('Sample consent operation did not settle')}
    const settle=${settledGeometry.toString()}
    const ready=${manualControlReady.toString()}
    const shadowReach=${outwardBoxShadowReach.toString()}
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
    const primary=()=>[...s.modal.footerEl.querySelectorAll('button')].find(b=>b.textContent==='Allow key and address')
    let fullHeight=innerHeight
    if(Math.abs(screen.width-innerWidth)<2)fullHeight=Math.max(fullHeight,screen.height)
    const keyboard=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height'))||0
    const event=e=>{
      const c=s.current;if(!c)return
      const p=e.touches?.[0]||e.changedTouches?.[0]||e
      const near=Number.isFinite(p.clientX)&&Math.abs(p.clientX-c.point.x)<50&&Math.abs(p.clientY-c.point.y)<50
      if(!s.modal.modalEl.contains(e.target)&&!near)return
      s.events.push({type:e.type,trusted:e.isTrusted,matched:e.target===c.control,focused:document.activeElement===c.control,
        x:Number.isFinite(p.clientX)?p.clientX:null,y:Number.isFinite(p.clientY)?p.clientY:null,
        targetTag:e.target.tagName,targetClass:String(e.target.className||''),at:Date.now(),field:rect(c.control),nativeKeyboard:keyboard()})
    }
    const eventNames=['pointerdown','touchstart','pointerup','touchend','focusin','focusout','click']
    for(const type of eventNames)document.addEventListener(type,event,true)
    s.cleanup=async()=>{
      await (${consentCleanupStages.toString()})([
        {name:'modal-close',run:()=>{s.modal?.close();document.activeElement?.blur()}},
        {name:'transport',run:()=>t.networkSecurity.setRequestTransport(undefined)},
        {name:'fake-key',run:async()=>{if(!s.keyId&&s.installed)s.keyId=config.ai.secrets.find(key=>key.name===name)?.keyId;if(s.keyId&&store.get(s.keyId)===value){store.remove(s.keyId);await store.flush()}}},
        {name:'config',run:async()=>{config.ai=s.oldAi;await config.saveSettings()}},
        ...s.keys.map((key,i)=>({name:'owned-storage-'+i,run:()=>app.saveLocalStorage(key,s.local[i])})),
        {name:'events',run:()=>{for(const type of eventNames)document.removeEventListener(type,event,true)}},
        {name:'modal-settled',run:()=>until(()=>!s.modal?.modalEl.isConnected)},
        {name:'original-owner',run:()=>(${restoreConsentOwner.toString()})(app.workspace,s.active)},
        {name:'keyboard',run:async()=>{document.activeElement?.blur();await settle(()=>({keyboard:keyboard(),inner:[innerWidth,innerHeight],visual:[visualViewport?.height||innerHeight,visualViewport?.offsetTop||0],
          typing:document.activeElement.matches('input,textarea,[contenteditable="true"]')}),()=>wait(50),Date.now,10000,400,
          state=>state.keyboard===0&&!state.typing&&state.visual[0]+state.visual[1]>=innerHeight-1)}},
        {name:'release-probe',run:()=>{delete window.__sampleManualConsent}},
      ])
      const local=s.keys.map(key=>app.loadLocalStorage(key))
      const result={aiRestored:JSON.stringify(config.ai)===JSON.stringify(s.oldAi),localRestored:JSON.stringify(local)===JSON.stringify(s.local),
        keyRemoved:!s.keyId||!store.get(s.keyId),modalClosed:!s.modal?.modalEl.isConnected,activeRestored:app.workspace.activeLeaf?.id===s.active,
        layoutRestored:JSON.stringify(app.workspace.getLayout())===JSON.stringify(s.layout),keyboard:keyboard(),
        windowRestored:JSON.stringify([innerWidth,innerHeight])===JSON.stringify(s.windowBefore),themeRestored:app.vault.getConfig('theme')===s.themeBefore,
        panesRestored:JSON.stringify(app.workspace.getLeavesOfType('abele-ai-sidebar-view').map(leaf=>leaf.id))===JSON.stringify(s.panesBefore)}
      delete window.__sampleManualConsent
      return result
    }
    const field=(label,text)=>{const el=s.modal.bodyEl.querySelector('input[aria-label="'+label+'"]');el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}))}
    const fetchLiteral=()=>t.networkSecurity.buildScriptContext({params:{},signal:new AbortController().signal,logs:[]}).fetch(origin+'/status',{headers:{Authorization:'Bearer '+value}})
    if(s.oldAi.secrets.some(key=>key.name===name))throw Error('Sample consent key name is occupied')
    config.ai={...s.oldAi,providers:[],imageProviders:[],secrets:[],mcpServers:[],braveSearchApiKey:'',
      voice:{...s.oldAi.voice,apiKeyId:'abele-openrouter',endpoint:'https://openrouter.ai/api/v1/chat/completions'}}
    s.installed=true
    app.saveLocalStorage(s.keys[0],{'abele-openrouter':['https://openrouter.ai']});app.saveLocalStorage(s.keys[1],[])
    t.networkSecurity.setRequestTransport(async request=>{s.calls++;s.out.literalUnchanged=request.headers.Authorization==='Bearer '+value;return {status:200,headers:{'content-type':'text/plain'},text:value,arrayBuffer:new ArrayBuffer(0)}})
    try{await fetchLiteral();s.out.blockedBefore=false}catch{s.out.blockedBefore=true}
    s.out.callsBefore=s.calls
    s.modal=t.networkSecurity.reviewKeyDestinations();s.out.empty=!s.modal.bodyEl.querySelector('[data-key-destination]')
    field('Recipient address',origin+'/status')
    const picker=s.modal.bodyEl.querySelector('select[aria-label="Saved key"]')||s.modal.bodyEl.querySelector('select:not(.is-measuring)')
    picker.value='new';picker.dispatchEvent(new Event('change',{bubbles:true}))
    field('New key name',name);field('New key value',value)
    s.out.masked=s.modal.bodyEl.querySelector('input[aria-label="New key value"]').type==='password'
    s.out.summary=s.modal.footerEl.textContent.includes(name)&&s.modal.footerEl.textContent.includes(origin)&&s.modal.footerEl.textContent.includes('Unencrypted')
    s.out.secretAbsentFromText=!s.modal.modalEl.textContent.includes(value)
    await settle(()=>({modal:rect(s.modal.modalEl),primary:rect(primary()),activeTag:document.activeElement.tagName,
      viewport:[innerWidth,innerHeight,visualViewport?.height,visualViewport?.offsetTop],keyboard:keyboard()}),()=>wait(50),Date.now)
    s.controls=[...s.modal.modalEl.querySelectorAll('input,select,button')].map((control,id)=>({control,id,
      label:control.getAttribute('aria-label')||control.textContent,
      kind:control.matches('select.is-measuring[aria-hidden="true"]')?'sizing-copy':control.tagName==='INPUT'?'editable':'noneditable'}))
    const sample=(c,acknowledged=false)=>{
      fullHeight=Math.max(fullHeight,innerHeight)
      const vp=visualViewport,cs=getComputedStyle(c.control),r=rect(c.control),nativeKeyboard=keyboard(),visualTop=vp?.offsetTop||0,visualHeight=vp?.height||innerHeight
      const reach=Math.max(shadowReach(cs.boxShadow),cs.outlineStyle!=='none'?parseFloat(cs.outlineWidth)+parseFloat(cs.outlineOffset||'0'):0)
      const baselineInnerHeight=s.baseline?.innerHeight??innerHeight,baselineVisualHeight=s.baseline?.visualHeight??visualHeight
      const effectiveKeyboard=Math.max(0,nativeKeyboard,baselineInnerHeight-innerHeight,baselineVisualHeight-visualHeight),cuts=[]
      for(let el=c.control.parentElement;reach>0&&el&&el!==document.documentElement;el=el.parentElement){const style=getComputedStyle(el);if(style.overflowX==='visible'&&style.overflowY==='visible')continue;const box=el.getBoundingClientRect(),left=box.left+el.clientLeft;if(Math.max(left-(r.left-reach),r.right+reach-left-el.clientWidth)>.5)cuts.push(c.label)}
      const events=s.events.slice()
      return {label:c.label,kind:c.kind,physical:s.physical,focused:document.activeElement===c.control,
        nativeKeyboard,fullHeight,baselineInnerHeight,baselineVisualHeight,innerHeight,visualTop,visualHeight,keyboard:effectiveKeyboard,acknowledged,
        initialTarget:events.some(e=>(e.type==='pointerdown'||e.type==='touchstart')&&e.trusted&&e.matched),
        trustedFocus:events.some(e=>e.type==='focusin'&&e.trusted&&e.matched&&e.focused),
        field:r,primary:rect(primary()),modal:rect(s.modal.modalEl),reach,cuts,events,
        viewport:{left:vp?.offsetLeft||0,top:visualTop,right:Math.min(innerWidth,(vp?.offsetLeft||0)+(vp?.width||innerWidth)),bottom:Math.min(innerHeight,visualTop+visualHeight,nativeKeyboard>0?fullHeight-nativeKeyboard+visualTop:innerHeight)}}
    }
    s.prepare=async id=>{
      const c=s.controls.find(c=>c.id===id);if(!c)throw Error('Sample control missing')
      s.events=[];s.current=null;s.baseline=null
      if(!s.physical&&c.kind!=='sizing-copy')c.control.focus()
      else if(s.physical&&c.kind==='noneditable')c.control.focus()
      // Editable physical inputs are NEVER script-focused. Ordinary body scrolling is settled first.
      if(s.physical&&c.kind==='editable')c.control.scrollIntoView({block:'center'})
      const before=await settle(()=>sample(c),()=>wait(50),Date.now,10000,400,
        state=>!s.physical||c.kind!=='editable'||(state.nativeKeyboard===0&&!state.focused))
      // A real keyboard-free baseline for this control/window, not a static screen inset.
      s.baseline={innerHeight:before.innerHeight,visualHeight:before.visualHeight,visualTop:before.visualTop}
      const r=before.field,x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y)===c.control
      s.current={...c,point:{x,y}}
      s.events=[]
      return {id,label:c.label,kind:c.kind,x,y,hit:hit&&r.width>0&&r.height>0&&x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight,
        before,frame:{inner:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,visual:[visualViewport?.offsetLeft||0,visualTopForFrame(),visualViewport?.width||innerWidth,visualViewport?.height||innerHeight]}}
    }
    const visualTopForFrame=()=>visualViewport?.offsetTop||0
    s.measure=async(id,acknowledged)=>{
      const c=s.controls.find(c=>c.id===id)
      const geometry=await settle(()=>sample(c,acknowledged),()=>wait(50),Date.now,10000,400,ready)
      const vp=geometry.viewport
      for(const[label,r]of[[c.label,geometry.field],['Allow key and address',geometry.primary]])if(r.left<vp.left||r.right>vp.right||r.top<vp.top||r.bottom>vp.bottom)s.out.outside.push(label)
      s.out.ringCuts.push(...geometry.cuts)
      const r=geometry.field,reach=geometry.reach
      if(r.left-reach<vp.left||r.right+reach>vp.right||r.top-reach<vp.top||r.bottom+reach>vp.bottom)s.out.ringCuts.push(c.label)
      s.out.geometry.push(geometry)
      return geometry
    }
    s.blur=async id=>{const c=s.controls.find(c=>c.id===id);c.control.blur();await settle(()=>sample(c),()=>wait(50),Date.now,10000,400,geometry=>geometry.keyboard===0);return true}
    s.sequence=async()=>{
      s.current=null
      primary().click();await until(()=>s.modal.bodyEl.textContent.includes('Retry the original script'))
      const key=config.ai.secrets.find(key=>key.name===name);s.keyId=key.keyId
      s.out.exactProtectedValue=store.get(s.keyId)===value;s.out.pair=key.allowedOrigins
      s.out.secretAbsentFromSettings=!JSON.stringify(config.exportSettings()).includes(value)
      s.out.secretAbsentFromLocal=!JSON.stringify(s.keys.map(key=>app.loadLocalStorage(key))).includes(value)
      s.out.callsAfterConsent=s.calls
      const result=await fetchLiteral();s.out.retry=result.status===200&&result.text==='[saved key]';s.out.callsAfterRetry=s.calls
      return s.out
    }
    s.remove=async()=>{
      const button=[...s.modal.bodyEl.querySelectorAll('button')].find(b=>b.textContent==='Remove HTTP exception')
      if(!button)throw Error('Sample HTTP exception action missing')
      button.click();await until(()=>!(app.loadLocalStorage(s.keys[1])||[]).includes(origin))
      try{await fetchLiteral();s.out.blockedAfterRemoval=false}catch{s.out.blockedAfterRemoval=true}
      s.out.callsAfterRemoval=s.calls
      return s.out
    }
    s.shot=async name=>{
      const path=${JSON.stringify(shots)}+'/'+name+'.png'
      if(window.__e2eHost)return window.__e2eHost.shot(path)
      const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage();require('fs').writeFileSync(path,image.toPNG());return path
    }
    s.identity=async()=>{
      const dir=app.vault.configDir+'/plugins/abele'
      const assets=await Promise.all(['main.js','styles.css','manifest.json'].map(async name=>{const bytes=await app.vault.adapter.readBinary(dir+'/'+name);return {name,bytes:bytes.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}}))
      return {version:app.plugins.plugins.abele.manifest.version,api:!!window.__abeleTest,assets}
    }
    return s.controls.map(({id,label,kind})=>({id,label,kind}))
  })()`
}
