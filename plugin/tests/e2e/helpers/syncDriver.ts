import type { VaultCli } from './obsidianCli'
import { waitFor } from './syncVault'
import { captureSyncFailure, captureSyncProgress, SYNC_SNAPSHOT } from './syncDiagnostics'
import { STARTUP_WAIT, waitForStartup, startupWaitFailure } from './startupWait'
import { onPhone } from './target'
import { TOKEN_HOST_READY } from './tokenHostReady'
import { SHARE_SET_PICKER } from './shareSetPicker'
export const SYNC_PRELUDE = `
 ${SYNC_SNAPSHOT}
 ${STARTUP_WAIT}
 const host = app.plugins.plugins.abele.tokenEngines
 if (!host) throw new Error('Token host is not ready')
 const svc = host.ui
 const actionTimeoutMs = window.__abeleSyncActionTimeoutMs || 90000
 const actionDeadline = Date.now() + actionTimeoutMs
 const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
 const textOf = el => el?.textContent?.trim() || ''
 const poll = async (fn, ms = actionTimeoutMs, label = 'expected live state') => { const until=Math.min(actionDeadline,Date.now()+ms);window.__abeleSyncWaiting=label;console.debug('[sync wait]',label,{timeoutMs:Math.max(0,until-Date.now())}); while(Date.now()<until) { if(await fn()) return true; await sleep(100) } throw new Error('Live sync condition did not complete: '+label+'; observed '+JSON.stringify(syncSnapshot())) }
 const buttonIn = (root,text) => [...root.querySelectorAll('button')].find(el=>textOf(el)===text)
 const press = async (root,text) => { let button; await poll(()=> {const container=typeof root==='function'?root():root;button=container&&buttonIn(container,text); return button&&!button.disabled},actionTimeoutMs,'enabled '+text+' button'); button.click(); await sleep(100) }
 const typeInto = (input,text) => { if(!input) throw new Error('Input unavailable'); input.value=text; input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true})) }
 const settingsDoc = () => app.setting.activeTab?.containerEl.ownerDocument || document
 const inWindows = selector => [...new Set([settingsDoc(),document])].map(doc=>doc.querySelector(selector)).find(Boolean)
 const modal = title => [...new Set([document,settingsDoc()])].flatMap(doc=>[...doc.querySelectorAll('.modal')]).find(el=>textOf(el.querySelector('.modal-title'))===title)
 const openSyncTab = async () => { app.setting.open(); app.setting.openTabById('abele'); await sleep(300); let root=app.setting.activeTab.containerEl; if(root.querySelector('.token-sync-settings'))return root; const tab=[...root.querySelectorAll('[role="tab"],.abele-tabs__tab')].find(el=>textOf(el)==='Sync'); if(tab)tab.click(); else app.commands.executeCommandById('abele:sync-log'); await poll(()=>{root=app.setting.activeTab.containerEl;return root.querySelector('.token-sync-settings')},actionTimeoutMs,'sync settings to open'); return root }
 const connectionRow = (root,id) => { const index=svc.rows.value.findIndex(one=>one.id===id); const rows=[...root.querySelectorAll('.abele-sync-row')]; if(index<0||!rows[index]) throw new Error('Connection row unavailable'); return rows[index] }
 // A connection row keeps only sync now on its face: opening it is a click on the row, and the
 // rarer actions sit in its ⋯ menu under the glyph the row once showed.
 const icon = (root,name) => { if(root.classList.contains('abele-sync-row')&&name==='settings') { root.click(); return } if(root.classList.contains('abele-sync-row')&&name!=='refresh-cw'&&name!=='more-horizontal') { icon(root,'more-horizontal'); const item=[...new Set([document,settingsDoc()])].flatMap(doc=>[...doc.querySelectorAll('.menu .menu-item')]).find(el=>el.querySelector('svg.lucide-'+name)); if(!item) throw new Error('Menu action unavailable: '+name); item.click(); return } const el=root.querySelector('svg.lucide-'+name)?.closest('.abele-obsidian-icon'); if(!el||el.classList.contains('abele-obsidian-icon_disabled')) throw new Error('Action unavailable: '+name); el.click() }
 const closeSettings = async () => { app.setting.close(); await sleep(100) }
`
/**
 * How long the call that starts a long action waits for it before polling takes over. Less on a
 * phone, whose driver gives one eval 30 s in all.
 */
const FIRST_ANSWER_MS = onPhone() ? 10_000 : 20_000
const ROWS = `svc.rows.value.map(({id,status,paused,address})=>({id,status,paused,address,error:svc.activity.value[id]?.error}))`
/**
 * Waits in the page until the connections (or one) are idle or paused, or one is in error, and
 * returns the rows as they were at that moment: a watcher cycle starting right after must not
 * turn the observation into "syncing".
 */
const settle = (id?: string, timeoutMs = 90000) =>
  `let seen;await poll(()=>{const rows=${ROWS}.filter(one=>${id ? 'one.id===' + JSON.stringify(id) : 'true'});seen=rows;return rows.some(one=>one.status==='error')||rows.length>0&&rows.every(one=>['idle','paused'].includes(one.status))},${timeoutMs},'token connection to settle');return seen`
export interface SyncStatus {
  id: string
  status: string
  paused: boolean
  address: string
  error?: string
}
export const ASYNC_SYNC_PRELUDE = `${TOKEN_HOST_READY}
window.__abeleSyncWaiting='token host startup';
await tokenHostReady(()=>app.plugins.plugins.abele?.tokenEngines, window.__abeleSyncActionTimeoutMs || 90000, ()=>{
 const started=performance.getEntriesByName('abele:onload-start').at(-1), ended=performance.getEntriesByName('abele:onload-end').at(-1);
 return !!started && !!ended && ended.startTime>=started.startTime;
}, ()=>{const startup=app.plugins.plugins.abele?.tokenHostStartup;return startup?.state==='failed'?(startup.error||'Unknown startup error'):undefined});
${SYNC_PRELUDE}`

export class SyncDriver {
  startupStallMs = 30000
  private retired = false
  get ended(): boolean {
    return this.retired
  }
  retire(): void {
    this.retired = true
  }
  private assertActive(): void {
    if (this.retired) throw new Error('Live sync case has ended; no further UI actions are allowed')
  }
  constructor(
    readonly vault: () => VaultCli,
    public timeoutMs = 90000
  ) {}
  run<T>(body: string, cleanup = false): T {
    if (!cleanup) this.assertActive()
    try {
      return this.vault().evalAwait<T>(
        `(async()=>{window.__abeleSyncActionTimeoutMs=${this.timeoutMs};${SYNC_PRELUDE}\n${body}})()`
      )
    } catch (error) {
      throw this.failure('live sync action', error)
    }
  }
  failure(label: string, error: unknown): Error {
    let observed: string
    try {
      observed = captureSyncFailure(this.vault(), label)
    } catch {
      observed = 'Diagnostic capture unavailable'
    }
    return Object.assign(
      new Error(
        label + ': ' + String((error as Error)?.message ?? error) + '; observed ' + observed,
        { cause: error }
      ),
      { syncDiagnostic: observed }
    )
  }
  async long<T>(
    what: string,
    body: string,
    confidential = false,
    timeoutMs = this.timeoutMs,
    cleanup = false,
    startupProgress = false
  ): Promise<T> {
    if (!cleanup) this.assertActive()
    const key = '__abeleSyncJob' + Math.random().toString(36).slice(2)
    const cli = this.vault()
    const evaluate = confidential ? cli.evalAwaitPrivate.bind(cli) : cli.evalAwait.bind(cli)
    let answer: { ok: boolean; value?: T; error?: string } | null = null
    let nextEvidence = Date.now() + 30000
    const started = Date.now()
    let waiting = 'operation'
    console.debug('[sync action]', what, { timeoutMs })
    try {
      // The job is started and, for up to FIRST_ANSWER_MS, waited for inside the same call: most
      // actions finish well within it and cost one round trip. A longer one is polled as before.
      answer = evaluate(
        `(async()=>{window[${JSON.stringify(key)}]=null;const job=(async()=>{const jobKey=${JSON.stringify(key)};window.__abeleSyncActionTimeoutMs=${timeoutMs};window.__abeleSyncWaiting='starting action';${ASYNC_SYNC_PRELUDE}\n${body}})().then(value=>window[${JSON.stringify(key)}]={ok:true,value:value===undefined?null:value},error=>window[${JSON.stringify(key)}]={ok:false,error:String(error?.message||error),waiting:window.__abeleSyncWaiting});await Promise.race([job,new Promise(resolve=>setTimeout(resolve,${FIRST_ANSWER_MS}))]);const result=window[${JSON.stringify(key)}];if(result)delete window[${JSON.stringify(key)}];return result||null})()`,
        FIRST_ANSWER_MS + 15_000
      )
      const check = () => {
        if (!cleanup) this.assertActive()
        const state = evaluate(
          `(()=>{const result=window[${JSON.stringify(key)}];if(result)delete window[${JSON.stringify(key)}];${SYNC_SNAPSHOT}return {result:result||null,snapshot:syncSnapshot()}})()`
        ) as {
          result: typeof answer
          snapshot: {
            connections: {
              id: string
              startup?: { stage: string; completed: number; total: number }
              startupTimings?: unknown[]
              inspection?: { completed: number; total: number }
              transfer?: { stage: string; completed: number; total?: number; bytes?: number }
              lastError?: string
            }[]
          }
        }
        answer = state.result
        return {
          ready: answer !== null,
          progress: JSON.stringify(
            state.snapshot.connections.map((one) => [
              one.id,
              one.startup?.stage,
              one.startup?.completed,
              one.startup?.total,
              one.startupTimings?.length,
              one.inspection?.completed,
              one.inspection?.total,
              one.transfer?.stage,
              one.transfer?.completed,
              one.transfer?.total,
              one.transfer?.bytes,
            ])
          ),
        }
      }
      if (answer !== null) {
        /* answered within the first call */
      } else if (startupProgress)
        await waitForStartup(check, this.startupStallMs, undefined, undefined, timeoutMs)
      else
        await waitFor(
          what,
          () => {
            if (!cleanup) this.assertActive()
            answer = evaluate(
              `(()=>{const result=window[${JSON.stringify(key)}];if(result)delete window[${JSON.stringify(key)}];return result||null})()`
            )
            if (answer === null && timeoutMs > 90000 && Date.now() >= nextEvidence) {
              nextEvidence = Date.now() + 30000
              try {
                captureSyncProgress(cli, what)
              } catch {
                console.debug('[sync progress] diagnostic capture unavailable')
              }
            }
            return answer !== null
          },
          timeoutMs
        )
      if (!cleanup) this.assertActive()
      const result = answer as unknown as {
        ok: boolean
        value: T
        error?: string
        waiting?: string
      }
      waiting = result.waiting ?? waiting
      if (!result.ok)
        throw new Error(
          confidential
            ? (startupProgress && startupWaitFailure(result.error)) || what + ' failed'
            : what + ': ' + result.error
        )
      return result.value
    } catch (error) {
      // A timed-out native action may still be running. Fail the case rather than retrying it.
      const startupFailure = startupProgress ? startupWaitFailure(error) : undefined
      throw Object.assign(
        this.failure(
          what,
          confidential
            ? new Error(startupFailure ?? what + ' failed while waiting for ' + waiting)
            : error
        ),
        startupFailure ? { startupFailure } : {}
      )
    } finally {
      console.debug('[sync action finished]', what, { elapsedMs: Date.now() - started, timeoutMs })
    }
  }
  rows(): SyncStatus[] {
    return this.run(
      'return svc.rows.value.map(({id,status,paused,address})=>({id,status,paused,address,error:svc.activity.value[id]?.error}))'
    )
  }
  async connect(token: string, qrImage?: string, timeoutMs = this.timeoutMs): Promise<string> {
    return this.long<string>(
      'connect by token',
      `const before=new Set(svc.rows.value.map(one=>one.id)); const root=await openSyncTab(); await press(root,'Connect…'); await poll(()=>modal('Connect to a server')); const box=modal('Connect to a server'); ${qrImage ? `const picture=await (await fetch(${JSON.stringify(qrImage)})).blob();const files=new DataTransfer();files.items.add(new File([picture],'access.png',{type:'image/png'}));const input=box.querySelector('input[type=file]');input.files=files.files;input.dispatchEvent(new input.ownerDocument.defaultView.Event('change',{bubbles:true}));await poll(()=>box.querySelector('input[placeholder="Paste your token"]').value===${JSON.stringify(token)})` : `typeInto(box.querySelector('input[placeholder="Paste your token"]'),${JSON.stringify(token)})`}; await press(box,'Connect'); await poll(()=>!modal('Connect to a server')); const added=svc.rows.value.find(one=>!before.has(one.id)); if(!added) throw new Error('No connection added'); await waitForStartup(()=>{const current=app.plugins.plugins.abele.tokenEngines, ui=current.ui, row=ui.rows.value.find(one=>one.id===added.id), activity=ui.activity.value[added.id]||{}, phase=activity.startup, engine=current.live.get(added.id)?.engine.status;const ready=row?.status==='idle'&&engine?.state==='idle'&&!!engine.lastSyncAt&&!engine.lastError&&(!phase||phase.outcome==='complete');return {ready,progress:JSON.stringify([row?.status,engine?.state,!!engine?.lastSyncAt,phase?.stage,phase?.completed,phase?.total,phase?.outcome,activity.startupTimings?.length,activity.inspection?.completed,activity.inspection?.total,activity.transfer?.stage,activity.transfer?.completed,activity.transfer?.total,activity.transfer?.bytes]),error:ready?undefined:activity.error}},${this.startupStallMs},undefined,undefined,${timeoutMs}); await closeSettings(); return added.id`,
      true,
      timeoutMs,
      false,
      true
    ).catch((error: unknown) => {
      // Only product state is reported; private eval errors may contain the pasted token.
      let details = 'No connection state available'
      try {
        details =
          this.rows()
            .map((one) => one.id + ' (' + one.status + '): ' + (one.error ?? 'No product error'))
            .join('; ') ||
          this.run<string>(
            `const box=modal('Connect to a server');return box?[...box.querySelectorAll('[role="alert"]')].map(textOf).filter(Boolean).join('; ')||'Connection was not added; the connect dialog is still open':'Connection was not added; no connect dialog is open'`,
            true
          )
      } catch {
        /* The vault can be reloading; keep the confidential fallback. */
      }
      const diagnostic = (error as { syncDiagnostic?: string })?.syncDiagnostic
      const startupFailure = (error as { startupFailure?: string })?.startupFailure
      throw new Error(
        'connect by token failed: ' +
          details +
          (startupFailure ? '; ' + startupFailure : '') +
          (diagnostic ? '; observed ' + diagnostic : '')
      )
    })
  }
  /** Syncs the connections (or one) and waits until they settle, in one action in the page. */
  async syncNow(id?: string): Promise<SyncStatus[]> {
    const rows = await this.long<SyncStatus[]>(
      'sync token connections',
      `for(const row of svc.rows.value.filter(one=>!one.paused${id ? '&&one.id===' + JSON.stringify(id) : ''})) await svc.sync(row.id); ${settle(id, this.timeoutMs)}`
    )
    return this.settled(rows, id)
  }
  async waitIdle(id?: string): Promise<SyncStatus[]> {
    return this.settled(
      await this.long<SyncStatus[]>('token connection to settle', settle(id, this.timeoutMs)),
      id
    )
  }
  private settled(all: SyncStatus[], id?: string): SyncStatus[] {
    const rows = all.filter((one) => !id || one.id === id)
    const failed = rows.filter((one) => one.status === 'error')
    if (failed.length)
      throw this.failure(
        'token connection to settle',
        new Error(
          failed
            .map((one) => one.id + ': ' + (one.error ?? 'Token exchange needs attention'))
            .join('; ')
        )
      )
    return rows
  }
  async pause(id: string, paused: boolean): Promise<void> {
    this.run(
      `const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),${JSON.stringify(paused ? 'pause' : 'play')}); await poll(()=>svc.rows.value.find(one=>one.id===${JSON.stringify(id)})?.paused===${paused}); await closeSettings(); return true`
    )
  }
  async disconnect(id: string): Promise<void> {
    this.run(
      `for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button, .modal-header-button:has(svg.lucide-x)')].reverse())button.click(); const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),'unlink'); await poll(()=>modal('Disconnect?')); await press(modal('Disconnect?'),'Disconnect'); await poll(()=>!svc.rows.value.some(one=>one.id===${JSON.stringify(id)})); await closeSettings(); return true`
    )
  }
  async resetTokenState(): Promise<void> {
    await this.long(
      'reset leased pool token state',
      `await poll(()=>Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey).every(key=>window[key]!==null),10000,'previous sync UI jobs to settle');for(const key of Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey))delete window[key];for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button, .modal-header-button:has(svg.lucide-x)')].reverse())button.click();await window.__abeleTest.resetSyncTokenState({vault:app.vault.getName(),confirm:'reset-sync-token-state'});return true`,
      false,
      20000,
      true
    )
  }
  assertTokenStateReset(): void {
    this.run(
      `const registry=app.loadLocalStorage('abele-sync-connections-v2');if(!registry||registry.version!==2||!Array.isArray(registry.records)||registry.records.length||registry.selectedId!==''||(registry.cleanup&&(!Array.isArray(registry.cleanup)||registry.cleanup.length)))throw new Error('Token pool reset left connection records');if(svc.registry.records().length||svc.rows.value.length||svc.candidates.value.length||svc.questions.value.length)throw new Error('Token pool reset left live connection or review state');return true`,
      true
    )
  }
  captureTokenOwnership(): void {
    this.run(`await window.__abeleTest.captureSyncTokenOwnership(app.vault.getName());return true`)
  }
  async forceResetTokenState(): Promise<void> {
    // Same guarded port as the manager's reset. A hung helper job is not a reason to
    // skip it: the port itself drains engines before any database is removed.
    await this.long(
      'guarded pool reset after polite cleanup failed',
      `await window.__abeleTest.resetSyncTokenState({vault:app.vault.getName(),confirm:'reset-sync-token-state'});for(const key of Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey))delete window[key];for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button, .modal-header-button:has(svg.lucide-x)')].reverse())button.click();return true`,
      false,
      60000,
      true
    )
  }
  async share(
    id: string,
    scopeLabel: string,
    label = 'Sample recipient',
    timeoutMs = this.timeoutMs
  ): Promise<string> {
    // The kit rebuilds its native select when choices arrive; never poll the loading node.
    return this.long(
      'issue sharing token',
      `const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),'share-2'); await poll(()=>modal('Share access'),${timeoutMs},'sharing dialog to open'); const box=modal('Share access'); ${SHARE_SET_PICKER} await pickShareItem(box,${JSON.stringify(scopeLabel)}); typeInto(box.querySelector('input[placeholder="A second device, a colleague"]'),${JSON.stringify(label)}); await press(box,'Create token'); await poll(()=>box.querySelector('textarea'),${timeoutMs},'issued sharing token'); const token=box.querySelector('textarea').value; await press(box,'Close'); await closeSettings(); return token`,
      true,
      timeoutMs
    )
  }
  async shareQr(id: string): Promise<{ token: string; image: string }> {
    return this.long(
      'render issued access QR',
      `
      const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'share-2');await poll(()=>modal('Share access'));
      const box=modal('Share access');${SHARE_SET_PICKER} await pickShareItem(box,'Whole vault');
      typeInto(box.querySelector('input[placeholder="A second device, a colleague"]'),'QR recipient');await press(box,'Create token');await poll(()=>box.querySelector('svg.abele-qr'));
      const token=box.querySelector('textarea').value,svg=box.querySelector('svg.abele-qr').cloneNode(true);
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','1024');svg.setAttribute('height','1024');svg.querySelector('rect').setAttribute('fill','white');svg.querySelector('path').setAttribute('fill','black');
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));let image;
      try{const picture=new Image();picture.src=url;await picture.decode();const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;canvas.getContext('2d').drawImage(picture,0,0,1024,1024);image=canvas.toDataURL('image/png')}finally{URL.revokeObjectURL(url)}
      await press(box,'Close');await closeSettings();return {token,image}
    `,
      true
    )
  }
  async shareSet(
    id: string,
    labels: string[],
    label = 'Sample item set'
  ): Promise<{ token: string; image: string }> {
    return this.long(
      'issue a set through the native picker',
      `
      const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'share-2');await poll(()=>modal('Share access'));
      const box=modal('Share access');${SHARE_SET_PICKER}
      for(const label of ${JSON.stringify(labels)}) await pickShareItem(box,label);
      typeInto(box.querySelector('input[placeholder="A second device, a colleague"]'),${JSON.stringify(label)});
      await press(box,'Create token');await poll(()=>box.querySelector('textarea')&&box.querySelector('svg.abele-qr'));
      const token=box.querySelector('textarea').value,svg=box.querySelector('svg.abele-qr').cloneNode(true);
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','1024');svg.setAttribute('height','1024');svg.querySelector('rect').setAttribute('fill','white');svg.querySelector('path').setAttribute('fill','black');
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));let image;
      try{const picture=new Image();picture.src=url;await picture.decode();const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;canvas.getContext('2d').drawImage(picture,0,0,1024,1024);image=canvas.toDataURL('image/png')}finally{URL.revokeObjectURL(url)}
      await press(box,'Close');await closeSettings();return {token,image}
    `,
      true
    )
  }
  create(path: string, text: string): void {
    this.run(
      `const path=${JSON.stringify(path)}; const parts=path.split('/').slice(0,-1); for(let i=1;i<=parts.length;i++){const dir=parts.slice(0,i).join('/'); if(!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)} const file=app.vault.getFileByPath(path); if(file) await app.vault.modify(file,${JSON.stringify(text)}); else await app.vault.create(path,${JSON.stringify(text)}); return true`
    )
  }
  read(path: string): string | null {
    return this.run(
      `const path=${JSON.stringify(path)}; return await app.vault.adapter.exists(path)? await app.vault.adapter.read(path):null`
    )
  }
  exists(path: string): boolean {
    return this.run(`return await app.vault.adapter.exists(${JSON.stringify(path)})`)
  }
  rename(from: string, to: string): void {
    this.run(
      `const file=app.vault.getAbstractFileByPath(${JSON.stringify(from)}); if(!file) throw new Error('Rename source unavailable'); const parts=${JSON.stringify(to)}.split('/').slice(0,-1); for(let i=1;i<=parts.length;i++){const dir=parts.slice(0,i).join('/'); if(!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)} await app.fileManager.renameFile(file,${JSON.stringify(to)}); return true`
    )
  }
  remove(paths: string[], cleanup = false): void {
    this.run(removal(paths), cleanup)
  }
  /** Teardown of a fixture tree, as a tracked long action deleting note by note: a large tree
   * can take longer to delete than one ordinary eval may run. Not for behavioural deletions. */
  async removeTree(
    paths: string[],
    cleanup = false,
    timeoutMs = Math.max(this.timeoutMs, 600_000)
  ): Promise<void> {
    await this.long<boolean>(
      'remove ' + paths.join(', '),
      removal(paths, true),
      false,
      timeoutMs,
      cleanup
    )
  }
  filesUnder(path: string): string[] {
    return this.run(
      `return app.vault.getFiles().map(one=>one.path).filter(one=>one.startsWith(${JSON.stringify(path + '/')})).sort()`
    )
  }
  open(path: string): void {
    this.run(
      `const path=${JSON.stringify(path)},file=app.vault.getFileByPath(path); if(!file) { const cut=path.lastIndexOf('/'),parent=!!app.vault.getAbstractFileByPath(cut<0?'/':path.slice(0,cut));let disk;try{disk=await app.vault.adapter.exists(path)}catch{disk='unavailable'}const pulls=svc.rows.value.slice(0,4).map(row=>{const pull=host.live.get(row.id)?.trace.snapshot().lastPull;return {id:row.id,status:row.status,pull:pull?{...pull,paths:pull.paths.slice(0,4)}:null}}); throw new Error('Note unavailable: '+JSON.stringify({disk,parent,pulls})); } await closeSettings(); await app.workspace.getLeaf(false).openFile(file); return true`
    )
  }
  async review(path: string, decision: 'Approve' | 'Reject', beforeRuntime = false): Promise<void> {
    this.run(
      `await svc.refreshReviews(); const candidate=svc.candidates.value.find(one=>one.path===${JSON.stringify(path)});const delayed=${beforeRuntime}?svc.runtimes.get(candidate?.source.id):null;const retry=svc.retryConnection;if(${beforeRuntime}&&!delayed)throw new Error('Runtime missing before registration test');if(delayed){svc.runtimes.delete(candidate.source.id);svc.retryConnection=async()=>{}}try{ const root=await openSyncTab(); const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)}); if(!row) throw new Error('Incoming candidate unavailable'); icon(row,'eye'); await poll(()=>modal('Review incoming code')); const box=modal('Review incoming code'); if(!box.querySelector('.token-sync-content')&&!textOf(box).includes('deleted')) throw new Error('No reviewed content'); await press(box,${JSON.stringify(decision)});if(delayed){await poll(()=>svc.approvalStatus.value[candidate.id]?.startsWith('Approved'),30000,'approval saved before runtime registration');if(svc.runtimes.has(candidate.source.id))throw new Error('Runtime registered before approval');svc.bind(candidate.source.id,delayed);svc.retryConnection=retry} ${decision === 'Approve' ? "await poll(()=>textOf(box.querySelector('[role=status]'))==='Approved and installed.',30000,'reviewed version installed');await press(box,'Close');" : ''} await poll(()=>!modal('Review incoming code')); await closeSettings(); return true}finally{svc.retryConnection=retry;if(delayed&&!svc.runtimes.has(candidate.source.id))svc.bind(candidate.source.id,delayed)}`
    )
  }
  async consent(decision: 'Allow' | 'Deny'): Promise<void> {
    this.run(
      `await poll(()=>modal('Share a private file?')); await press(modal('Share a private file?'),${JSON.stringify(decision)}); await poll(()=>!modal('Share a private file?')); return true`
    )
  }
  async history(path: string): Promise<void> {
    this.open(path)
    this.run(
      `app.commands.executeCommandById('file-explorer:reveal-active-file'); let file;await poll(()=>file=document.querySelector('.nav-file-title[data-path='+CSS.escape(${JSON.stringify(path)})+']'));file.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}));let action;await poll(()=>{const ours=[...document.querySelectorAll('.menu-item')].filter(one=>textOf(one).startsWith('Open version history · '));if(ours.length>1)throw new Error('Several Abele version history items: '+ours.map(textOf).join(', '));return action=ours[0]},20000,'Abele version history menu item');action.click();await poll(()=>inWindows('.abele-version-history__row'));return true`
    )
  }
  async trash(): Promise<void> {
    this.run(
      `await closeSettings();for(const doc of new Set([document,settingsDoc()]))for(const box of doc.querySelectorAll('.abele-deleted-files'))box.closest('.modal')?.querySelector('.modal-close-button, .modal-header-button:has(svg.lucide-x)')?.click();await poll(()=>!inWindows('.abele-deleted-files'),20000,'previous trash dialog to close');const root=await openSyncTab();icon(connectionRow(root,svc.rows.value[0].id),'trash-2');await poll(()=>{const box=inWindows('.abele-deleted-files');return box&&!textOf(box).includes('Reading what has been deleted…')});return true`
    )
  }
  async restore(selector: string, name: string): Promise<void> {
    this.run(
      `const root=inWindows(${JSON.stringify(selector)});let row;const history=${selector === '.abele-version-history'};await poll(()=>row=[...root.querySelectorAll(history?'.abele-version-history__row':'.abele-deleted-files__row')].find(one=>history?'#'+one.dataset.version===${JSON.stringify(name)}:one.dataset.path===${JSON.stringify(name)}));if(history){if(!row.classList.contains('is-active'))row.click();await press(row,'Restore');await poll(()=>inWindows('.abele-confirm__message'));await press(inWindows('.abele-confirm__message').closest('.modal').querySelector('.abele-modal__footer'),'Restore')}else{icon(row,'rotate-ccw')}return true`
    )
  }
  candidates(): {
    id: string
    path: string
    mtime: number
    receivedAt: number
    source: { id: string; address: string }
  }[] {
    return this.run(
      'await svc.refreshReviews(); return svc.candidates.value.map(({id,path,mtime,receivedAt,source})=>({id,path,mtime,receivedAt,source:{id:source.id,address:source.address}}))'
    )
  }
  questions(): { path: string; source: { id: string } }[] {
    return this.run(
      'await svc.refreshReviews(); return svc.questions.value.map(({path,source})=>({path,source:{id:source.id}}))'
    )
  }
}
export async function shaOf(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Buffer.from(digest).toString('hex')
}

/**
 * Deletes paths in the page. A behavioural action deletes a folder the way a user does, with
 * Obsidian's own folder deletion. Teardown (`incremental`) deletes a fixture tree note by note,
 * deepest first, then the emptied folders, yielding to the page as it goes: Obsidian's folder
 * deletion updates links for every deleted note across the whole vault in one synchronous run,
 * so deleting a very large tree in one call can block the page.
 */
function removal(paths: string[], incremental = false): string {
  const tree = incremental
    ? `if(file.children){const notes=[],folders=[];const walk=folder=>{for(const child of [...folder.children]){if(child.children){walk(child);folders.push(child)}else notes.push(child)}};walk(file);
for(const one of [...notes,...folders]){if(app.vault.getAbstractFileByPath(one.path)===one)await app.vault.delete(one,true);if(Date.now()-lastYield>=50){await yieldPage();lastYield=Date.now()}}}`
    : ''
  const prelude = incremental
    ? 'const yieldPage=()=>new Promise(resolve=>setTimeout(resolve,0));let lastYield=Date.now();'
    : ''
  return `${prelude}for(const path of ${JSON.stringify(paths)}){const file=app.vault.getAbstractFileByPath(path);
if(file){${tree}await app.vault.delete(file,true)}
else {const stat=await app.vault.adapter.stat(path);if(stat?.type==='file')await app.vault.adapter.remove(path);else if(stat)throw new Error('Unindexed directory requires explicit cleanup: '+path);if(await app.vault.adapter.exists(path))throw new Error('Deletion did not complete: '+path)}} return true`
}
