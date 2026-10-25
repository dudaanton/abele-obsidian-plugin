/** A growing session, not merely a large session opened once. All work is invented. */
import { afterAll, expect, it } from 'vitest'
import { join } from 'node:path'
import { evalLong, reloadApp } from './helpers/obsidianCli'
import { PAIRED_PRELUDE, startPairedNode } from './helpers/pairedNode'
import { targets, onPhone } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'
import { giantJournal } from '../fixtures/giantJournal.mjs'

targets('desktop', 'phone')
let node: Awaited<ReturnType<typeof startPairedNode>> | undefined
afterAll(async () => node?.close())

interface Segment {
  openMs: number
  firstMs: number[]
  turnMs: number[]
  typingP95: number
  longTasks: number
  longMs: number
  heap: number | null
  heapRaw: number | null
  events: number
  visible: number
  messages: number
  bytes: number
  tx: number
  txMs: number
  idbBytes: number
  idbTx: number
  idbTxMs: number
  fetchedEvents: number
  duplicates: number
  follows: boolean
}

it('keeps hundreds of streamed work turns bounded through disconnect, restart, reload and compact', async () => {
  node = await startPairedNode({ latencyMs: 40 })
  const session = await node.session('Sample endurance session')
  let seeded = 0
  await node.restart(async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(node!.state, 'node.sqlite'))
    try {
      const row = db.prepare('SELECT head_seq FROM streams WHERE stream_id=?').get(session) as {
        head_seq: number
      }
      const events = giantJournal({
        turns: 1800,
        toolsPerTurn: 4,
        compactEvery: 800,
        stream: session,
        node: node!.node,
      }).slice(1)
      const insert = db.prepare('INSERT INTO events VALUES(?,?,?)')
      db.exec('BEGIN')
      for (const [i, event] of events.entries()) {
        const seq = row.head_seq + i + 1
        insert.run(session, seq, JSON.stringify({ ...event, seq }))
      }
      db.prepare('UPDATE streams SET head_seq=? WHERE stream_id=?').run(
        row.head_seq + events.length,
        session
      )
      db.exec('COMMIT')
      seeded = events.length
    } finally {
      db.close()
    }
  })
  const key = 'node:' + node.registration + ':' + session
  const prelude = `${PAIRED_PRELUDE}
    const connection=nodes.connection(${JSON.stringify(node.registration)}),client=connection.client;
    const key=${JSON.stringify(key)},sid=${JSON.stringify(session)};
    const presenter=()=>chats.getNodeSession(key);
    const frame=()=>new Promise(r=>requestAnimationFrame(r));`
  const shots = shotDir('node-endless')
  const reports: (Segment & { segment: number; down: number; up: number })[] = []
  const run = async (segment: number) => {
    const before = { ...node!.traffic }
    const result = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}
      await until(()=>connection.state.value==='connected','Connection');
      const opened=performance.now();
      await chats.openNodeSession({kind:'node-session',nodeId:${JSON.stringify(node!.node)},registrationId:${JSON.stringify(node!.registration)},sessionId:sid,title:'Sample endurance session'});
      await chats.revealSidebar({focus:false});
      const latest=${JSON.stringify(segment === 0 ? 'Answer 1800.' : `segment${segment - 1}turn74 word11:`)};
      await until(()=>chat()&&[...chat().querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes(latest)),'Latest messages');
      const openMs=performance.now()-opened;
      const probe={tx:0,txMs:0,longTasks:0,longMs:0,idbTx:0,idbTxMs:0,fetchedEvents:0};
      const store=client.store,original=store.transaction;
      const stopEvents=client.onEvent(e=>{if(e.stream_id===sid)probe.fetchedEvents++});
      const idbTransaction=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(...args){const t=performance.now(),tx=idbTransaction.apply(this,args);tx.addEventListener('complete',()=>{probe.idbTx++;probe.idbTxMs+=performance.now()-t},{once:true});return tx};
      store.transaction=async function(work){const t=performance.now();try{return await original.call(this,work)}finally{probe.tx++;probe.txMs+=performance.now()-t}};
      let observer;try{observer=new PerformanceObserver(l=>{for(const e of l.getEntries()){probe.longTasks++;probe.longMs+=e.duration}});observer.observe({type:'longtask'})}catch{}
      const firstMs=[],turnMs=[],typing=[];
      try {
        for(let turn=0;turn<75;turn++){
          const tag='segment${segment}turn'+turn;
          const list=chat().querySelector('.abele-ai-chat__messages');list.scrollTop=list.scrollHeight;
          const started=performance.now();
          const sending=presenter().send('work '+tag+' 12 60');
          await until(()=>[...chat().querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes(tag+' word0:')),'First streamed words');
          firstMs.push(performance.now()-started);
          if(turn===37&&!${onPhone()}) {
            const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage();
            require('fs').writeFileSync(${JSON.stringify(join(shots, `segment-${segment}-mid-stream.png`))},image.toPNG());
          }
          const field=chat().querySelector('.abele-chat-input textarea');
          for(const c of 'sample draft') {const t=performance.now();field.value+=c;field.dispatchEvent(new Event('input',{bubbles:true}));await frame();typing.push(performance.now()-t)}
          field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));
          await sending;
          await until(()=>presenter().messages.value.some(m=>m.content?.includes(tag+' word11:'))&&!presenter().isStreaming.value,'Completed streamed turn');
          turnMs.push(performance.now()-started);
        }
        await presenter().refresh();await frame();
        const state=await store.read(s=>({events:s.events[sid]??[],bytes:JSON.stringify(s).length}));
        const db=await store.open();let idbBytes=0;
        for(const name of db.objectStoreNames){const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();const values=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});idbBytes+=new TextEncoder().encode(JSON.stringify(values)).length}
        const messages=presenter().messages.value;
        const ids=messages.map(m=>m.id),list=chat().querySelector('.abele-ai-chat__messages');
        typing.sort((a,b)=>a-b);
        const heapRaw=performance.memory?.usedJSHeapSize??null;
        const measured={...probe};observer?.disconnect();
        // Raw heap includes uncollected allocations and changes sharply on a reload. Keep
        // reporting it, but compare retained heap at the same GC boundary in each segment.
        // The emulated phone uses the same renderer probe; a real phone has no CDP heap API.
        let heap=null;
        if(!${onPhone()}) {
          const debuggerApi=require('@electron/remote').getCurrentWindow().webContents.debugger;
          const owned=!debuggerApi.isAttached();
          try {
            if(owned)debuggerApi.attach('1.3');
            await debuggerApi.sendCommand('HeapProfiler.collectGarbage');
            heap=(await debuggerApi.sendCommand('Runtime.getHeapUsage')).usedSize;
          } finally {if(owned)debuggerApi.detach()}
        }
        return JSON.stringify({openMs,firstMs,turnMs,typingP95:typing[Math.floor(typing.length*.95)],...measured,
          heap,heapRaw,events:state.events.length,bytes:state.bytes,idbBytes,
          visible:presenter().visibleEvents.size,messages:messages.length,duplicates:ids.length-new Set(ids).size,
          follows:list.scrollHeight-list.scrollTop-list.clientHeight<100});
      }finally{store.transaction=original;IDBDatabase.prototype.transaction=idbTransaction;stopEvents();observer?.disconnect()}
    })()`,
        600000
      )
    ) as Segment
    reports.push({
      ...result,
      segment,
      down: node!.traffic.down - before.down,
      up: node!.traffic.up - before.up,
    })
    console.log('ENDLESS_SEGMENT ' + JSON.stringify(reports.at(-1)))
    columnShot(
      join(
        shots,
        `${onPhone() ? 'phone' : segment === 3 ? 'emulated-phone' : 'desktop'}-segment-${segment}-end.png`
      )
    )
    expect(result.events).toBeLessThanOrEqual(400)
    expect(result.visible).toBeLessThan(1600)
    expect(result.duplicates).toBe(0)
    expect(result.follows).toBe(true)
    expect(result.typingP95).toBeLessThan(400)
    expect(result.openMs).toBeLessThan(15000)
  }
  try {
    await run(0)
    // The provider continues while the connection is absent: verify its one final message.
    await evalLong(`(async()=>{${prelude}await presenter().send('pause 1200');return 'sent'})()`)
    node.disconnect()
    await new Promise((r) => setTimeout(r, 1800))
    node.reconnect()
    await evalLong(
      `(async()=>{${prelude}await until(()=>connection.state.value==='connected','Reconnect');await until(()=>presenter().messages.value.filter(m=>m.content==='after-pause').length===1,'Exactly one recovered answer');return 'recovered'})()`,
      120000
    )
    await run(1)
    await node.restart(() => {})
    await run(2)
    await reloadApp()
    await node.restoreTransport()
    const finish = async () => {
      await node!.restoreTransport()
      await node!.open(session, 'Sample endurance session')
      await evalLong(
        `(async()=>{${prelude}await presenter().control.compact('sample summary');await until(()=>[...chat().querySelectorAll('.abele-session-mark__label')].some(m=>m.textContent.includes('Compacted')),'Compaction');return 'compacted'})()`,
        120000
      )
      await run(3)
    }
    if (onPhone()) await finish()
    else await withEmulatedPhone(finish)
    const first = reports[0],
      last = reports[3]
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    expect(median(last.turnMs)).toBeLessThan(median(first.turnMs) * 2 + 500)
    expect(last.bytes).toBeLessThan(first.bytes * 2 + 1_000_000)
    expect(last.idbBytes).toBeLessThan(first.idbBytes * 2 + 1_000_000)
    if (first.heap !== null && last.heap !== null)
      expect(last.heap - first.heap).toBeLessThan(128 * 1048576)
    console.log('ENDLESS_SESSION ' + JSON.stringify({ seeded, turns: 300, reports }))
  } finally {
    node.reconnect()
  }
}, 2400000)
