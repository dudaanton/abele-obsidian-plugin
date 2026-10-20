import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { VaultCli } from './obsidianCli'
import { onPhone } from './target'
import { screenshot } from './phone'
import { transferText } from '../../../src/sync/transferProgress'
import { englishSyncText } from '../../../src/sync/presentation'

/** Synchronous snapshots must remain available while an engine or ledger read is stuck. */
export const SYNC_SNAPSHOT = `
const transferFormatter = ${transferText.toString()};
const englishSyncText = ${englishSyncText.toString()};
const transferText = one => transferFormatter(one, englishSyncText);
const syncSnapshot = () => {
 const host=app.plugins.plugins.abele?.tokenEngines, ui=host?.ui;
 const docs=[...new Set([document,app.setting.activeTab?.containerEl.ownerDocument].filter(Boolean))];
 return {
  driverWaiting:window.__abeleSyncWaiting||null,
  sharePickers:docs.flatMap(doc=>[...doc.querySelectorAll('.modal')].filter(box=>box.querySelector('.abele-share-picker')).map(box=>{
   const picker=box.querySelector('.abele-share-picker');
   return {sheetHtml:box.outerHTML,mode:picker.dataset.sharePickerMode||null,
    flags:{appMobile:!!app.isMobile,bodyMobile:doc.body.classList.contains('is-mobile'),bodyPhone:doc.body.classList.contains('is-phone'),platformMobile:picker.dataset.platformMobile??null,platformPhone:picker.dataset.platformPhone??null},
    query:picker.querySelector('input')?.value||'',inlineRows:picker.querySelectorAll('.abele-share-picker__results .suggestion-item').length,
    source:{count:Number(picker.dataset.sourceCount||0),firstPaths:JSON.parse(picker.dataset.sourcePaths||'[]'),matchingPaths:JSON.parse(picker.dataset.sourceMatches||'[]')}};
  })),
  webViewLoad:{timeOrigin:performance.timeOrigin,loadId:window.__abelePhoneLoadIdentity?.loadId||null},
  tokenHostReady:!!host,
  tokenHostStartup:app.plugins.plugins.abele?.tokenHostStartup||null,
  pluginStartup:{started:performance.getEntriesByName('abele:onload-start').at(-1)?.startTime??null,finished:performance.getEntriesByName('abele:onload-end').at(-1)?.startTime??null},
  attachmentStage:window.__abeleAttachmentStage||null,
  nativeTransport:window.__abeleTest?.nativeSyncTransport?.(),
  externalFiles:window.__abeleTest?.externalFileOperations?.(),
  connectFailure:ui?.connectFailure||null,
  connections:(ui?.rows?.value||[]).map(row=>{
   const activity=ui.activity?.value[row.id]||{}, status=host.live?.get(row.id)?.engine.status;
   const startup=activity.startup, inspection=activity.inspection;
   const statusText=startup?startup.stage+'… '+startup.completed+'/'+startup.total+(startup.outcome==='failed'?' · Needs attention':''):inspection?'Checking the vault… '+inspection.completed+'/'+inspection.total:activity.transfer?transferText(activity.transfer):({idle: "Ready", syncing: "Syncing", paused: "Paused", offline: "Server unavailable", error: "Needs attention", joining: "Connecting", scope_updating: "Updating access", scope_unavailable: "Access unavailable"})[row.status]||row.status;
   return {id:row.id,status:row.status,statusText,transfer:activity.transfer||null,startup:startup||null,inspection:inspection||null,startupTimings:activity.startupTimings||[],paused:row.paused,lastError:activity.error||null,failure:activity.failure||null,reconciliation:activity.reconciliation||null,pending:activity.pending,holds:activity.heldDeletes,deferred:activity.deferred,
    engine:status?{state:status.state,pending:status.pending,heldDeletes:status.heldDeletes,deferred:status.deferred,lastSyncAt:status.lastSyncAt,lastErrorCode:status.lastError?.code,exchange:host.live?.get(row.id)?.trace?.snapshot()}:null};
  }),
  candidates:(ui?.candidates?.value||[]).map(one=>({id:one.id,path:one.path,connectionId:one.source.id})),
  consents:(ui?.questions?.value||[]).map(one=>({path:one.path,connectionId:one.source.id})),
  dialogs:docs.flatMap(doc=>[...doc.querySelectorAll('.modal')].map(box=>({title:box.querySelector('.modal-title')?.textContent?.trim(),errors:[...box.querySelectorAll('[role="alert"]')].map(one=>one.textContent?.trim()),buttons:[...box.querySelectorAll('button')].map(one=>({text:one.textContent?.trim(),disabled:one.disabled}))})))
 };
};`

/**
 * Each connection's folder bookkeeping under the live fixture folders, bounded in time: what
 * the core believes the server has, what it is waiting to publish, the collision holds, and
 * what the local folder listing reports. A stuck ledger read answers "timed out" instead.
 */
export const DIRECTORY_SNAPSHOT = `
const directorySnapshot = async () => {
 const host=app.plugins.plugins.abele?.tokenEngines, within=(path)=>path.startsWith('Sync fixtures');
 const bounded=(work)=>Promise.race([work.catch((error)=>({error:String(error?.message||error)})),new Promise((done)=>setTimeout(()=>done({error:'timed out'}),2000))]);
 const result={};
 for (const [id,runtime] of host?.live??[]) {
  const state=runtime.options?.state, fs=runtime.options?.fs;
  result[id]=await bounded((async()=>{
   const doc=JSON.parse((await state.getMeta('v2-directories'))??'{}');
   const local=[];
   if (fs?.listDirectories) for await (const dir of fs.listDirectories()) if (within(dir.path)) local.push(dir.path);
   return {
    pending:doc.pending?.op??null,
    known:(doc.directories??[]).map((one)=>one.path).filter(within),
    incoming:(doc.incoming??[]).map((one)=>one.path),
    removals:(doc.removals??[]).map((one)=>typeof one==='string'?one:one.path),
    holds:JSON.parse((await state.getMeta('normalization-directory-collisions'))??'[]'),
    local,
   };
  })());
 }
 return result;
};`

/** Never evaluate or print the failed command again: it can contain a private pasted token. */
export function captureSyncFailure(cli: VaultCli, label: string): string {
  const directory = resolve(
    process.env.ABELE_SCENARIO_EVIDENCE ||
      process.env.ABELE_E2E_SHOTS ||
      '.scratch/live-wait-failures'
  )
  const base = join(directory, 'wait-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
  mkdirSync(directory, { recursive: true })
  let snapshot: unknown
  try {
    snapshot = cli.evalAwait(
      `(async()=>{${SYNC_SNAPSHOT}${DIRECTORY_SNAPSHOT}const one=syncSnapshot();one.directories=await directorySnapshot();return one})()`
    )
  } catch {
    snapshot = { unavailable: 'Vault did not answer diagnostic evaluation' }
  }
  const artifacts: string[] = []
  try {
    if (onPhone()) {
      screenshot(base + '-0.png')
    } else {
      cli.evalAwait(
        `(async()=>{const fs=require('fs');const docs=[...new Set([document,app.setting.activeTab?.containerEl.ownerDocument].filter(Boolean))];for(let i=0;i<docs.length;i++){const remote=(docs[i].defaultView.require||require)('@electron/remote');fs.writeFileSync(${JSON.stringify(base)}+'-'+i+'.png',(await remote.getCurrentWindow().webContents.capturePage()).toPNG())}return true})()`
      )
    }
    artifacts.push(base + '-0.png')
  } catch {
    artifacts.push('Screenshot unavailable')
  }
  writeFileSync(base + '.json', JSON.stringify({ label, snapshot, artifacts }, null, 2) + '\n')
  return JSON.stringify({ snapshot, evidence: base + '.json', screenshots: artifacts })
}

/** Capture before the runner's timeout starts teardown; no screenshot or app lifecycle changes. */
export function captureSyncProgress(cli: VaultCli, label: string): void {
  const directory = resolve(
    process.env.ABELE_SCENARIO_EVIDENCE ||
      process.env.ABELE_E2E_SHOTS ||
      '.scratch/live-wait-failures'
  )
  const snapshot = cli.evalAwait(`(async()=>{${SYNC_SNAPSHOT}return syncSnapshot()})()`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(
      directory,
      'progress-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json'
    ),
    JSON.stringify({ label, snapshot }, null, 2) + '\n'
  )
}
