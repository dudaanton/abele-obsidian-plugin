import type { VaultCli } from './obsidianCli'
import { waitFor } from './syncVault'
export const SYNC_PRELUDE = `
 const host = app.plugins.plugins.abele.tokenEngines
 if (!host) throw new Error('Token host is not ready')
 const svc = host.ui
 const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
 const textOf = el => el?.textContent?.trim() || ''
 const poll = async (fn, ms = 20000, label = 'expected live state') => { const until=Date.now()+ms; while(Date.now()<until) { if(await fn()) return true; await sleep(100) } throw new Error('Live sync condition did not complete: '+label) }
 const buttonIn = (root,text) => [...root.querySelectorAll('button')].find(el=>textOf(el)===text)
 const press = async (root,text) => { let button; await poll(()=> {const container=typeof root==='function'?root():root;button=container&&buttonIn(container,text); return button&&!button.disabled},20000,'enabled '+text+' button'); button.click(); await sleep(100) }
 const typeInto = (input,text) => { if(!input) throw new Error('Input unavailable'); input.value=text; input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true})) }
 const settingsDoc = () => app.setting.activeTab?.containerEl.ownerDocument || document
 const inWindows = selector => [...new Set([settingsDoc(),document])].map(doc=>doc.querySelector(selector)).find(Boolean)
 const modal = title => [...new Set([document,settingsDoc()])].flatMap(doc=>[...doc.querySelectorAll('.modal')]).find(el=>textOf(el.querySelector('.modal-title'))===title)
 const openSyncTab = async () => { app.setting.open(); app.setting.openTabById('abele'); await sleep(300); let root=app.setting.activeTab.containerEl; if(root.querySelector('.token-sync-settings'))return root; const tab=[...root.querySelectorAll('[role="tab"],.abele-tabs__tab')].find(el=>textOf(el)==='Sync'); if(tab)tab.click(); else app.commands.executeCommandById('abele:sync-log'); await poll(()=>{root=app.setting.activeTab.containerEl;return root.querySelector('.token-sync-settings')}); return root }
 const connectionRow = (root,id) => { const index=svc.rows.value.findIndex(one=>one.id===id); const rows=[...root.querySelectorAll('.setting-item')].filter(one=>one.querySelector('svg.lucide-unlink')); if(index<0||!rows[index]) throw new Error('Connection row unavailable'); return rows[index] }
 const icon = (root,name) => { const el=root.querySelector('svg.lucide-'+name)?.closest('.abele-obsidian-icon'); if(!el||el.classList.contains('abele-obsidian-icon_disabled')) throw new Error('Action unavailable: '+name); el.click() }
 const closeSettings = async () => { app.setting.close(); await sleep(100) }
`
export interface SyncStatus {
  id: string
  status: string
  paused: boolean
  address: string
}
export class SyncDriver {
  constructor(readonly vault: () => VaultCli) {}
  run<T>(body: string): T {
    return this.vault().evalAwait<T>(`(async()=>{${SYNC_PRELUDE}\n${body}})()`)
  }
  async long<T>(what: string, body: string, confidential = false, timeoutMs = 90000): Promise<T> {
    const key = '__abeleSyncJob' + Math.random().toString(36).slice(2)
    const cli = this.vault()
    const evaluate = confidential ? cli.evalAwaitPrivate.bind(cli) : cli.evalAwait.bind(cli)
    evaluate(
      `(()=>{window[${JSON.stringify(key)}]=null;(async()=>{const jobKey=${JSON.stringify(key)};${SYNC_PRELUDE}\n${body}})().then(value=>window[${JSON.stringify(key)}]={ok:true,value:value===undefined?null:value},error=>window[${JSON.stringify(key)}]={ok:false,error:String(error?.message||error)});return true})()`
    )
    let answer: { ok: boolean; value?: T; error?: string } | null = null
    try {
      await waitFor(
        what,
        () => {
          answer = evaluate(
            `(()=>{const result=window[${JSON.stringify(key)}];if(result)delete window[${JSON.stringify(key)}];return result||null})()`
          )
          return answer !== null
        },
        timeoutMs
      )
      const result = answer as unknown as { ok: boolean; value: T; error?: string }
      if (!result.ok) throw new Error(confidential ? what + ' failed' : what + ': ' + result.error)
      return result.value
    } catch (error) {
      // A timed-out native action may still be running. Fail the case rather than retrying it.
      throw confidential ? new Error(what + ' failed') : error
    }
  }
  rows(): SyncStatus[] {
    return this.run(
      'return svc.rows.value.map(({id,status,paused,address})=>({id,status,paused,address}))'
    )
  }
  async connect(token: string): Promise<string> {
    return this.long(
      'connect by token',
      `const before=new Set(svc.rows.value.map(one=>one.id)); const root=await openSyncTab(); await press(root,'Connect…'); await poll(()=>modal('Connect to a server')); const box=modal('Connect to a server'); typeInto(box.querySelector('input[placeholder="Paste your token"]'),${JSON.stringify(token)}); await press(box,'Connect'); await poll(()=>!modal('Connect to a server')); const added=svc.rows.value.find(one=>!before.has(one.id)); if(!added) throw new Error('No connection added'); await poll(()=>svc.runtimes.has(added.id)); await closeSettings(); return added.id`,
      true
    )
  }
  async syncNow(id?: string): Promise<void> {
    await this.long(
      'sync token connections',
      `for(const row of svc.rows.value.filter(one=>!one.paused${id ? '&&one.id===' + JSON.stringify(id) : ''})) await svc.sync(row.id); return true`
    )
    await this.waitIdle(id)
  }
  async waitIdle(id?: string): Promise<void> {
    await waitFor(
      'token connection to settle',
      () => {
        const rows = this.rows().filter((one) => !id || one.id === id)
        if (rows.some((one) => one.status === 'error'))
          throw new Error('Token exchange needs attention')
        return rows.length > 0 && rows.every((one) => ['idle', 'paused'].includes(one.status))
      },
      60000
    )
  }
  async pause(id: string, paused: boolean): Promise<void> {
    this.run(
      `const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),${JSON.stringify(paused ? 'pause' : 'play')}); await poll(()=>svc.rows.value.find(one=>one.id===${JSON.stringify(id)})?.paused===${paused}); await closeSettings(); return true`
    )
  }
  async disconnect(id: string): Promise<void> {
    this.run(
      `for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button')].reverse())button.click(); const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),'unlink'); await poll(()=>modal('Disconnect?')); await press(modal('Disconnect?'),'Disconnect'); await poll(()=>!svc.rows.value.some(one=>one.id===${JSON.stringify(id)})); await closeSettings(); return true`
    )
  }
  async resetTokenState(): Promise<void> {
    await this.long(
      'reset leased pool token state',
      `await poll(()=>Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey).every(key=>window[key]!==null),10000,'previous sync UI jobs to settle');for(const key of Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey))delete window[key];for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button')].reverse())button.click();await window.__abeleTest.resetSyncTokenState({vault:app.vault.getName(),confirm:'reset-sync-token-state'});return true`,
      false,
      20000
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
      `await window.__abeleTest.resetSyncTokenState({vault:app.vault.getName(),confirm:'reset-sync-token-state'});for(const key of Object.keys(window).filter(key=>key.startsWith('__abeleSyncJob')&&key!==jobKey))delete window[key];for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button')].reverse())button.click();return true`,
      false,
      60000
    )
  }
  async share(id: string, scopeLabel: string, label = 'Sample recipient'): Promise<string> {
    return this.long(
      'issue sharing token',
      `const root=await openSyncTab(); icon(connectionRow(root,${JSON.stringify(id)}),'share-2'); await poll(()=>modal('Share access')); const box=modal('Share access'); const select=box.querySelector('select'); await poll(()=>select.options.length>0); const option=[...select.options].find(one=>one.textContent.trim()===${JSON.stringify(scopeLabel)}); if(!option) throw new Error('Scope choice unavailable'); select.value=option.value; select.dispatchEvent(new select.ownerDocument.defaultView.Event('change',{bubbles:true})); typeInto(box.querySelector('input[placeholder="For a new device or a collaborator"]'),${JSON.stringify(label)}); await press(box,'Get token'); await poll(()=>box.querySelector('textarea')); const token=box.querySelector('textarea').value; await press(box,'Close'); await closeSettings(); return token`,
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
  remove(paths: string[]): void {
    this.run(
      `for(const path of ${JSON.stringify(paths)}){const file=app.vault.getAbstractFileByPath(path); if(file) await app.vault.delete(file,true)} return true`
    )
  }
  filesUnder(path: string): string[] {
    return this.run(
      `return app.vault.getFiles().map(one=>one.path).filter(one=>one.startsWith(${JSON.stringify(path + '/')})).sort()`
    )
  }
  open(path: string): void {
    this.run(
      `const file=app.vault.getFileByPath(${JSON.stringify(path)}); if(!file) throw new Error('Note unavailable'); await closeSettings(); await app.workspace.getLeaf(false).openFile(file); return true`
    )
  }
  async review(path: string, decision: 'Approve' | 'Reject'): Promise<void> {
    this.run(
      `await svc.refreshReviews(); const root=await openSyncTab(); const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)}); if(!row) throw new Error('Incoming candidate unavailable'); icon(row,'eye'); await poll(()=>modal('Review incoming code')); const box=modal('Review incoming code'); if(!box.querySelector('.token-sync-content')&&!textOf(box).includes('deleted')) throw new Error('No reviewed content'); await press(box,${JSON.stringify(decision)}); await poll(()=>!modal('Review incoming code')); await closeSettings(); return true`
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
      `app.commands.executeCommandById('file-explorer:reveal-active-file'); let file;await poll(()=>file=document.querySelector('.nav-file-title[data-path='+CSS.escape(${JSON.stringify(path)})+']'));file.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}));let action;await poll(()=>action=[...document.querySelectorAll('.menu-item')].find(one=>textOf(one).includes('Open version history (Abele)')));action.click();await poll(()=>document.querySelector('.abele-version-history .abele-card'));return true`
    )
  }
  async trash(): Promise<void> {
    this.run(
      `await closeSettings();app.commands.executeCommandById('abele:sync-deleted-files');await poll(()=>document.querySelector('.abele-deleted-files'));return true`
    )
  }
  async restore(selector: string, name: string): Promise<void> {
    this.run(
      `const root=document.querySelector(${JSON.stringify(selector)});let row;await poll(()=>row=[...root.querySelectorAll('.abele-card')].find(one=>textOf(one.querySelector('.abele-card__name'))===${JSON.stringify(name)}));await press(row,'Restore');if(${selector === '.abele-version-history'}){await poll(()=>document.querySelector('.abele-confirm__message'));await press(document.querySelector('.abele-confirm__message').closest('.modal'),'Restore')}return true`
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
