import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

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
    const events = Array.from({length:30000}, (_,i)=>({kind:'event',node_id:'sample-node',stream_id:'sample-session',seq:i+1,
      type:'session.update',actor:{kind:'node'},at:'2026-01-01T00:00:00.000Z',data:{text:'sample output '.repeat(50)+i}}));
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
        while(performance.now()-start<2500){await tick();ticks++;peakHeap=Math.max(peakHeap??0,heap()??0);await wait(25)}
      } finally {IDBObjectStore.prototype.get=original}
      const elapsedMs=performance.now()-start,used=before?cpu.cpuUsage(before):null;
      return {ticks,reads,elapsedMs,heapBefore,heapAfter:heap(),peakHeap,cpuMs:used?(used.user+used.system)/1000:null};
    };
    try {
      // The former production algorithm: the transaction stays alive by repeatedly cloning state.
      const before=await measure(()=>new Promise((resolve,reject)=>{
        const tx=db.transaction('client','readwrite'),object=tx.objectStore('client');let pending=true;
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        const alive=()=>{if(pending){const r=object.get('state');r.onsuccess=alive}};
        const r=object.get('state');r.onsuccess=()=>{alive();setTimeout(()=>{object.put(r.result,'state');pending=false},40)};
      }));
      db.close();db=null;
      store=new window.__abeleTest.NodeClientStore(namespace);
      const kept=await store.read(state=>state.events['sample-session'].length);
      const after=await measure(()=>store.transaction(async()=>{await wait(40)}));
      return JSON.stringify({bytes,events:events.length,kept,before,after});
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
  }
  console.log('NODE_STORE_IDLE ' + JSON.stringify(report))
  expect(report.bytes).toBeGreaterThan(20_000_000)
  expect(report.kept).toBe(400)
  expect(report.before.reads).toBeGreaterThan(report.before.ticks)
  expect(report.after.reads).toBe(report.after.ticks)
}, 240000)
