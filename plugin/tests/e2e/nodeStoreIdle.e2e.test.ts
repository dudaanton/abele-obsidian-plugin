import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { idleStoreJournal } from '../fixtures/idleStoreJournal.mjs'

targets('desktop', 'phone')

it('measures idle polling before and after migrating a large synthetic client store', async () => {
  const report = JSON.parse(
    await evalLong(
      `(async () => {
    const namespace = 'sample-idle-' + crypto.randomUUID(), name = 'abele-node-' + namespace;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const req = r => new Promise((resolve, reject) => {r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const heap = () => performance.memory?.usedJSHeapSize ?? null;
    const cpu = (()=>{try{return window.require('node:process')}catch{return null}})();
    const events = (${idleStoreJournal.toString()})();
    const initial = {cursors:{'sample-session':events.length},events:{'sample-session':events},outbox:[],results:{}};
    const bytes = JSON.stringify(initial).length;
    const opening=indexedDB.open(name,1);
    opening.onupgradeneeded=()=>opening.result.createObjectStore('client').put(initial,'state');
    let db=await req(opening), store;
    const measure=async(tick)=>{
      const before=cpu?.cpuUsage(),start=performance.now(),heapBefore=heap();
      let ticks=0,reads=0,peakHeap=heapBefore;
      const original=IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get=function(key){if(this.name==='client'&&key==='state')reads++;return original.call(this,key)};
      try {
        while(performance.now()-start<2500){await tick();ticks++;const sampled=heap();if(sampled!==null)peakHeap=Math.max(peakHeap??0,sampled);await wait(25)}
      } finally {IDBObjectStore.prototype.get=original}
      const elapsedMs=performance.now()-start,used=before?cpu.cpuUsage(before):null;
      return {ticks,reads,elapsedMs,heapBefore,heapAfter:heap(),peakHeap,cpuMs:used?(used.user+used.system)/1000:null};
    };
    try {
      // The former production algorithm: the transaction stays alive by repeatedly cloning state.
      const before=await measure(()=>new Promise((resolve,reject)=>{
        const tx=db.transaction('client','readwrite'),object=tx.objectStore('client');let pending=true,ready=false,state;
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        const alive=()=>{if(!pending)return;if(ready){object.put(state,'state');pending=false;return}const r=object.get('state');r.onsuccess=alive};
        const r=object.get('state');r.onsuccess=()=>{state=r.result;alive();queueMicrotask(()=>{ready=true})};
      }));
      db.close();db=null;
      store=new window.__abeleTest.NodeClientStore(namespace);
      const kept=await store.read(state=>state.events['sample-session'].length);
      const after=await measure(()=>store.transaction(()=>{}));
      const awaited=await measure(()=>store.transaction(async()=>{await wait(40)}));
      return JSON.stringify({bytes,events:events.length,kept,before,after,awaited});
    } finally {
      db?.close();store?.close();await wait(50);await req(indexedDB.deleteDatabase(name));
    }
  })()`,
      180000
    )
  ) as {
    bytes: number
    events: number
    kept: number
    before: { ticks: number; reads: number }
    after: { ticks: number; reads: number }
    awaited: { ticks: number; reads: number }
  }
  console.log('NODE_STORE_IDLE ' + JSON.stringify(report))
  expect(report.bytes).toBeGreaterThan(20_000_000)
  expect(report.kept).toBe(400)
  expect(report.before.reads).toBeGreaterThan(report.before.ticks)
  expect(report.after.reads).toBe(report.after.ticks)
  expect(report.awaited.reads).toBe(report.awaited.ticks)
}, 240000)

it.skipIf(onPhone())(
  'soaks idle metadata polling with a large retained artifact cache',
  async () => {
    const report = JSON.parse(
      await evalLong(
        `(async () => {
    const namespace='sample-artifacts-'+crypto.randomUUID(),name='abele-node-'+namespace;
    const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),heap=()=>performance.memory?.usedJSHeapSize??null;
    const cpu=(()=>{try{return window.require('node:process')}catch{return null}})();
    const opening=indexedDB.open(name,2);
    opening.onupgradeneeded=()=>{opening.result.createObjectStore('client');opening.result.createObjectStore('journal')};
    let db=await req(opening),store;
    const artifactData=Object.fromEntries(Array.from({length:160},(_,i)=>['sample-'+i,{text:('sample artifact '+i+' ').repeat(8000)}]));
    const initial={cursors:{sample:400},events:{},outbox:[],results:{},artifactData};
    const tx=db.transaction('client','readwrite');tx.objectStore('client').put(initial,'state');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject});
    const measure=async(ms,tick)=>{
      const start=performance.now(),before=cpu?.cpuUsage(),heapBefore=heap(),samples=[];
      let ticks=0,writes=0,artifactReads=0;
      const put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.put=function(value,key){if(key==='state')writes++;return put.call(this,value,key)};
      IDBObjectStore.prototype.get=function(key){if(key==='artifacts')artifactReads++;return get.call(this,key)};
      try{while(performance.now()-start<ms){await tick();ticks++;if(ticks%50===0)samples.push({ms:performance.now()-start,heap:heap()});await wait(100)}}
      finally{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.get=get}
      const used=before?cpu.cpuUsage(before):null;
      return {ticks,writes,artifactReads,elapsedMs:performance.now()-start,heapBefore,heapAfter:heap(),samples,cpuMs:used?(used.user+used.system)/1000:null};
    };
    try {
      const before=await measure(10000,()=>new Promise((resolve,reject)=>{
        const tx=db.transaction('client','readwrite'),object=tx.objectStore('client'),r=object.get('state');
        r.onsuccess=()=>object.put(r.result,'state');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      }));
      db.close();db=null;store=new window.__abeleTest.NodeClientStore(namespace);
      await store.transaction(()=>{});
      const retained=await store.read(state=>Object.keys(state.artifactData).length);
      const after=await measure(210000,()=>store.transaction(()=>{}));
      return JSON.stringify({artifactBytes:JSON.stringify(artifactData).length,retained,before,after});
    } finally {db?.close();store?.close();await wait(50);await req(indexedDB.deleteDatabase(name))}
  })()`,
        270000
      )
    ) as {
      retained: number
      before: { writes: number }
      after: { writes: number; artifactReads: number }
    }
    console.log('NODE_ARTIFACT_IDLE ' + JSON.stringify(report))
    expect(report.retained).toBe(160)
    expect(report.before.writes).toBeGreaterThan(0)
    expect(report.after.writes).toBe(0)
    expect(report.after.artifactReads).toBe(0)
  },
  300000
)
