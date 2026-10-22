import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
targets('desktop')

it.skipIf(onPhone())(
  'measures realistic settled receipts before and after incremental storage',
  async () => {
    const report = JSON.parse(
      await evalLong(
        `(async () => {
    const namespace='sample-receipts-'+crypto.randomUUID(),name='abele-node-'+namespace;
    const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const cpu=window.require('node:process');
    const results=Object.fromEntries(Array.from({length:700},(_,i)=>['sample-'+i,{result:'sample output '.repeat(300)}]));
    const initial={cursors:{},events:{},outbox:[],results};
    const bytes=JSON.stringify(initial).length;
    const opening=indexedDB.open(name,2);
    opening.onupgradeneeded=()=>{opening.result.createObjectStore('client');opening.result.createObjectStore('journal')};
    let db=await req(opening),store;
    let tx=db.transaction('client','readwrite');tx.objectStore('client').put(initial,'state');
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject});
    const measure=async tick=>{
      const start=performance.now(),usage=cpu.cpuUsage();let writes=0,ticks=0;
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,key){writes++;return put.call(this,value,key)};
      try {while(performance.now()-start<5000){await tick();ticks++;await wait(100)}}
      finally {IDBObjectStore.prototype.put=put}
      const elapsedMs=performance.now()-start,used=cpu.cpuUsage(usage),cpuMs=(used.user+used.system)/1000;
      return {ticks,writes,elapsedMs,cpuMs,cpuPercent:100*cpuMs/elapsedMs,heap:performance.memory?.usedJSHeapSize??null};
    };
    try {
      const before=await measure(()=>new Promise((resolve,reject)=>{
        const tx=db.transaction('client','readwrite'),s=tx.objectStore('client'),r=s.get('state');
        r.onsuccess=()=>{const state=r.result;JSON.stringify(state);JSON.stringify(state);JSON.stringify(state);s.put(state,'state')};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      }));
      db.close();db=null;store=new window.__abeleTest.NodeClientStore(namespace);
      await store.transaction(()=>{});
      const after=await measure(()=>store.transaction(()=>{}));
      return JSON.stringify({bytes,before,after,retained:await store.read(s=>Object.keys(s.results).length)});
    } finally {db?.close();store?.close();await wait(50);await req(indexedDB.deleteDatabase(name))}
  })()`,
        180000
      )
    )
    console.log('NODE_RECEIPTS_IDLE ' + JSON.stringify(report))
    expect(report.bytes).toBeGreaterThan(2_800_000)
    expect(report.after.writes).toBe(0)
    expect(report.before.writes).toBeGreaterThan(0)
    expect(report.retained).toBe(700)
  },
  240000
)
