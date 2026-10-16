/**
 * A giant long-lived session over a remote node connection, measured. A real node (the
 * `ABELE_NODE_CLI` build) runs a Claude session through the live fake CLI; tens of thousands of
 * invented events are written into its journal; the app connects as a paired device through a
 * proxy that adds network latency (on the phone, through the device link as well), as a phone on
 * the tailnet would. Opening must show the end fast without replaying the journal, scrolling up
 * must read pages, typing and a streamed answer must stay smooth, and memory must not follow the
 * journal's size. The numbers are printed as `GIANT_SESSION` for the report.
 */
import { afterAll, expect, it } from 'vitest'
import { join } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { startPairedNode } from './helpers/pairedNode'
import { giantJournal } from '../fixtures/giantJournal.mjs'

targets('desktop', 'phone')
const TURNS = Number(process.env.ABELE_GIANT_TURNS ?? 5000)
/** One way, so a round trip costs twice this: a phone on a tailnet away from home. */
const LATENCY_MS = 40

const PRELUDE = `const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,what,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await wait(25)}throw Error(what+' did not happen')};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const chat=()=>[...document.querySelectorAll('.abele-node-chat')].find(r=>r.getBoundingClientRect().width>0);
const heap=()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;
const frame=()=>new Promise(r=>requestAnimationFrame(()=>r(performance.now())));`

let node: Awaited<ReturnType<typeof startPairedNode>> | undefined
afterAll(async () => node?.close())

it('opens a giant session at its end over a remote connection, pages back, types and streams smoothly with bounded memory', async () => {
  node = await startPairedNode({ latencyMs: LATENCY_MS })
  const { registration, traffic } = node
  const created = { session: await node.session('Sample long session'), node: node.node }

  // The journal grows to a giant one while the node is stopped, as days of work would.
  let journalBytes = 0,
    events = 0
  await node.restart(async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(node!.state, 'node.sqlite'))
    const head = Number(
      (
        db.prepare('SELECT head_seq FROM streams WHERE stream_id=?').get(created.session) as {
          head_seq: number
        }
      ).head_seq
    )
    const journal = giantJournal({
      turns: TURNS,
      stream: created.session,
      node: created.node,
    }).slice(1)
    const insert = db.prepare('INSERT INTO events VALUES(?,?,?)')
    db.exec('BEGIN')
    journal.forEach((event, i) => {
      const seq = head + i + 1
      const body = JSON.stringify({ ...event, seq })
      journalBytes += body.length
      insert.run(created.session, seq, body)
    })
    db.prepare('UPDATE streams SET head_seq=? WHERE stream_id=?').run(
      head + journal.length,
      created.session
    )
    db.exec('COMMIT')
    db.close()
    events = journal.length
  })

  // Open it over the network and measure.
  const before = { ...traffic }
  const opened = JSON.parse(
    await evalLong(
      `(async()=>{${PRELUDE}
      const connection=nodes.connection(${JSON.stringify(registration)});
      await until(()=>connection.state.value==='connected','The reconnection');
      const heapBefore=heap();
      const store=connection.client.store,tx=store.transaction.bind(store);
      window.__giantProbe={tx:0,txMs:0,longTasks:0,longMs:0};
      store.transaction=async(work)=>{const t=performance.now();try{return await tx(work)}finally{window.__giantProbe.tx++;window.__giantProbe.txMs+=performance.now()-t}};
      try{new PerformanceObserver(l=>{for(const e of l.getEntries()){window.__giantProbe.longTasks++;window.__giantProbe.longMs+=e.duration}}).observe({type:'longtask'})}catch{}
      const t0=performance.now();
      await chats.openNodeSession({kind:'node-session',nodeId:${JSON.stringify(created.node)},registrationId:${JSON.stringify(registration)},sessionId:${JSON.stringify(created.session)},title:'Sample long session'});
      await chats.revealSidebar({focus:false});
      const last='Answer ${TURNS}.';
      await until(()=>chat()&&[...chat().querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes(last)),'The latest answer',120000);
      const openMs=Math.round(performance.now()-t0);
      const presenter=chats.getNodeSession('node:'+${JSON.stringify(registration)}+':'+${JSON.stringify(created.session)});
      const kept=(await connection.client.history(${JSON.stringify(created.session)})).length;
      const dom=chat().querySelectorAll('.abele-chat-msg').length;
      const probe={...window.__giantProbe,txMs:Math.round(window.__giantProbe.txMs),longMs:Math.round(window.__giantProbe.longMs)};
      Object.assign(window.__giantProbe,{tx:0,txMs:0,longTasks:0,longMs:0});
      return JSON.stringify({openMs,kept,dom,heapBefore,heapOpen:heap(),hasOlder:presenter.hasOlder.value,probe})})()`,
      180000
    )
  ) as {
    openMs: number
    kept: number
    dom: number
    heapBefore: number | null
    heapOpen: number | null
    hasOlder: boolean
  }
  const openTraffic = { down: traffic.down - before.down, up: traffic.up - before.up }
  console.log('GIANT_SESSION_OPEN ' + JSON.stringify({ ...opened, traffic: openTraffic }))

  // Scroll back through five earlier pages.
  const paged = JSON.parse(
    await evalLong(
      `(async()=>{${PRELUDE}
      const presenter=chats.getNodeSession('node:'+${JSON.stringify(registration)}+':'+${JSON.stringify(created.session)});
      const list=chat().querySelector('.abele-ai-chat__messages');
      const pages=[];
      for(let i=0;i<5;i++){
        const count=presenter.messages.value.length,t=performance.now();
        list.scrollTop=0;list.dispatchEvent(new Event('scroll'));
        await until(()=>presenter.messages.value.length>count&&presenter.olderState.value==='idle','An earlier page');
        await frame();
        pages.push({ms:Math.round(performance.now()-t),added:presenter.messages.value.length-count,keptPlace:list.scrollTop>0});
      }
      return JSON.stringify({pages,dom:chat().querySelectorAll('.abele-chat-msg').length,heapPaged:heap()})})()`,
      180000
    )
  ) as {
    pages: { ms: number; added: number; keptPlace: boolean }[]
    dom: number
    heapPaged: number | null
  }

  console.log('GIANT_SESSION_PAGED ' + JSON.stringify(paged))

  // Typing, then a streamed answer with typing under it; frames are timed throughout.
  const live = JSON.parse(
    await evalLong(
      `(async()=>{${PRELUDE}
      const root=chat(),field=root.querySelector('.abele-chat-input textarea');
      const list=root.querySelector('.abele-ai-chat__messages');list.scrollTop=list.scrollHeight;
      const type=async(words)=>{const gaps=[];field.focus();for(const c of words){const t=performance.now();field.value+=c;field.dispatchEvent(new Event('input',{bubbles:true}));await frame();gaps.push(performance.now()-t)}return gaps};
      const stats=g=>{const s=[...g].sort((a,b)=>a-b);return{median:Math.round(s[Math.floor(s.length/2)]),p95:Math.round(s[Math.floor(s.length*0.95)]),max:Math.round(s[s.length-1])}};
      const typing=stats(await type('Sample words typed into a long session'));
      field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));
      const presenter=chats.getNodeSession('node:'+${JSON.stringify(registration)}+':'+${JSON.stringify(created.session)});
      void presenter.send('stream 300 15');
      const frames=[];let last=performance.now(),done=false;
      (async()=>{while(!done){const now=await frame();frames.push(now-last);last=now}})();
      const t0=performance.now();
      await until(()=>[...root.querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes('word40 ')),'The streamed answer',60000);
      const firstMs=Math.round(performance.now()-t0);
      const streamingTyping=stats(await type('typed while it answers'));
      try{await until(()=>[...root.querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes('word299')),'The whole streamed answer',120000)}
      catch(e){const text=[...root.querySelectorAll('.abele-chat-msg')].map(m=>m.textContent).join(' ');const words=(text.match(/word\d+/g)??[]).length;throw Error(e.message+' '+JSON.stringify({words,probe:window.__giantProbe,frames:frames.length}))}
      const streamMs=Math.round(performance.now()-t0);
      done=true;await frame();
      const probe={...window.__giantProbe,txMs:Math.round(window.__giantProbe.txMs),longMs:Math.round(window.__giantProbe.longMs)};
      const client=nodes.connection(${JSON.stringify(registration)}).client;
      probe.store=await client.store.transaction(st=>{const size=v=>JSON.stringify(v??null).length;return{total:size(st),streams:Object.fromEntries(Object.entries(st.events).map(([k,v])=>[k.slice(0,12),{events:v.length,kB:Math.round(size(v)/1024)}])),resultsKB:Math.round(size(st.results)/1024),results:Object.keys(st.results).length,artifactKB:Math.round(size(st.artifactData)/1024),outbox:st.outbox.length}});
      const heapLive=heap();await wait(8000);return JSON.stringify({typing,streamingTyping,firstMs,streamMs,frames:stats(frames),heapLive,heapSettled:heap(),probe})})()`,
      240000
    )
  ) as {
    typing: { median: number; p95: number; max: number }
    streamingTyping: { median: number; p95: number; max: number }
    firstMs: number
    streamMs: number
    frames: { median: number; p95: number; max: number }
    heapLive: number | null
  }

  const report = {
    target: onPhone() ? 'phone' : 'desktop',
    journal: { events, mb: +(journalBytes / 1e6).toFixed(1) },
    latencyMs: LATENCY_MS * 2,
    open: { ...opened, kB: Math.round(openTraffic.down / 1024) },
    paged,
    live,
  }
  console.log('GIANT_SESSION ' + JSON.stringify(report))
  // The journal is never replayed: what opening brings is a window, not the session.
  expect(opened.kept).toBeLessThanOrEqual(400)
  expect(openTraffic.down).toBeLessThan(journalBytes / 10)
  expect(opened.hasOlder).toBe(true)
  expect(opened.openMs).toBeLessThan(15000)
  for (const page of paged.pages) {
    expect(page.added).toBeGreaterThan(0)
    expect(page.keptPlace).toBe(true)
  }
  // Smooth enough to be used, with room for a loaded machine: no frame held for a second.
  expect(live.typing.p95).toBeLessThan(250)
  expect(live.streamingTyping.p95).toBeLessThan(400)
  expect(live.frames.max).toBeLessThan(1000)
  if (opened.heapOpen !== null && opened.heapBefore !== null)
    expect(opened.heapOpen - opened.heapBefore).toBeLessThan(150)
}, 900000)
