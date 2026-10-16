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
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { exposeToPhone } from './helpers/phone'
import { giantJournal } from '../fixtures/giantJournal.mjs'

targets('desktop', 'phone')
const cli = process.env.ABELE_NODE_CLI
const TURNS = Number(process.env.ABELE_GIANT_TURNS ?? 5000)
/** One way, so a round trip costs twice this: a phone on a tailnet away from home. */
const LATENCY_MS = 40
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PRELUDE = `const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,what,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await wait(25)}throw Error(what+' did not happen')};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const chat=()=>[...document.querySelectorAll('.abele-node-chat')].find(r=>r.getBoundingClientRect().width>0);
const heap=()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;
const frame=()=>new Promise(r=>requestAnimationFrame(()=>r(performance.now())));`

let child: ChildProcess | undefined
let proxy: Server | undefined
let unexpose: (() => Promise<void>) | undefined
const sockets = new Set<Socket>()
const dir = (() => {
  mkdirSync('../.scratch', { recursive: true })
  return mkdtempSync(resolve('../.scratch/giant-session-'))
})()

afterAll(async () => {
  await evalLong(
    `(async()=>{const chats=window.__abeleTest.ChatService.getInstance(),nodes=window.__abeleTest.NodeService.getInstance();
    for(const id of [...chats.tabOrder.value])if(id.startsWith('node:'))await chats.closeTab(id);
    for(const n of [...nodes.nodes.value])if(n.label==='Sample remote node'){try{nodes.remove(n.id)}catch{}};return '1'})()`,
    60000
  ).catch(() => {})
  await unexpose?.().catch(() => {})
  for (const s of sockets) s.destroy()
  proxy?.close()
  child?.kill('SIGTERM')
  rmSync(dir, { recursive: true, force: true })
})

it('opens a giant session at its end over a remote connection, pages back, types and streams smoothly with bounded memory', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  const home = join(dir, 'home'),
    state = join(dir, 'state'),
    project = join(dir, 'sample-project')
  for (const d of [home, project]) mkdirSync(d)
  mkdirSync(state, { mode: 0o700 })
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: project,
    })
  await git('init', '--initial-branch=main')
  writeFileSync(join(project, 'sample.txt'), 'Sample project\n')
  await git('add', 'sample.txt')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'sample'
  )
  const claude = join(dir, 'claude-live.mjs')
  copyFileSync(resolve('tests/fixtures/nodeClaudeLive.mjs'), claude)
  chmodSync(claude, 0o700)
  const config = join(state, 'paired.json')
  writeFileSync(
    config,
    JSON.stringify({
      endpoint: 'wss://sample.example.ts.net:8443/channel',
      backend_port: 0,
      origins: ['app://obsidian.md', 'capacitor://localhost'],
      allow_missing_origin: false,
      allow_null_origin: false,
    }),
    { mode: 0o600 }
  )
  const env = { ...process.env, HOME: home, ABELE_CLAUDE_PATH: claude, ABELE_CODEX_PATH: '' }
  const command = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, ...args, '--state-dir', state, '--json'],
          {
            env,
          }
        )
      ).stdout
    )
  let pairedPort = 0
  const start = async () => {
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--json',
        '--no-codex',
        '--claude-allow-bypass',
        '--node-name',
        'Sample remote node',
        '--port',
        '0',
        '--paired-config',
        config,
        '--state-dir',
        state,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (d) => (output += d))
    child.stderr!.on('data', (d) => (errors += d))
    for (let i = 0; i < 500 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw Error(errors)
      await wait(20)
    }
    const line = output.split('\n').find((l) => l.includes('"listening"'))
    if (!line) throw Error('Node did not start: ' + errors)
    pairedPort = JSON.parse(line).paired_port
  }
  const stop = async () => {
    const running = child!
    running.kill('SIGTERM')
    for (let i = 0; i < 500 && running.exitCode === null && running.signalCode === null; i++)
      await wait(20)
    for (const s of sockets) s.destroy()
  }
  /** What reached the app from the node, and requests the app sent, through the proxy. */
  const traffic = { down: 0, up: 0 }
  const delayed = (from: Socket, to: Socket, count: (n: number) => void) =>
    from.on('data', (chunk) => {
      count(chunk.length)
      setTimeout(() => to.writable && to.write(chunk), LATENCY_MS)
    })
  await start()
  proxy = createServer()
  proxy.on('upgrade', (request, socket: Socket, head) => {
    if (request.url !== '/channel') return socket.destroy()
    const upstream = connect(pairedPort, '127.0.0.1')
    for (const s of [socket, upstream]) {
      sockets.add(s)
      s.on('close', () => sockets.delete(s))
      s.on('error', () => {
        socket.destroy()
        upstream.destroy()
      })
    }
    upstream.on('connect', () => {
      const headers = request.rawHeaders.slice()
      for (let i = 0; i < headers.length; i += 2)
        if (headers[i].toLowerCase() === 'host') headers[i + 1] = 'sample.example.ts.net:8443'
      upstream.write(
        `GET /channel HTTP/1.1\r\n${headers.reduce((t, v, i) => t + (i % 2 ? v + '\r\n' : v + ': '), '')}\r\n`
      )
      if (head.length) upstream.write(head)
      delayed(socket, upstream, (n) => (traffic.up += n))
      delayed(upstream, socket, (n) => (traffic.down += n))
      socket.on('close', () => upstream.destroy())
      upstream.on('close', () => socket.destroy())
    })
  })
  await new Promise<void>((r) => proxy!.listen(0, '127.0.0.1', r))
  const port = (proxy.address() as { port: number }).port
  if (onPhone()) unexpose = await exposeToPhone(port)

  // Pair as a remote device, then start a Claude session in a managed worktree.
  const invite = await command('pair', 'invite', 'sample-remote-device')
  const pairing = evalLong(
    `(async()=>{${PRELUDE}
    for(const n of [...nodes.nodes.value])if(n.label==='Sample remote node'){try{nodes.remove(n.id)}catch{}};
    api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');
    const node=await nodes.pair('Sample remote node',${JSON.stringify(invite)});
    return node.id})()`,
    120000
  )
  let pending: { installation_id: string; fingerprint: string } | undefined
  for (let i = 0; i < 300 && !pending; i++) {
    pending = (await command('pair', 'list')).find((d: { state: string }) => d.state === 'pending')
    if (!pending) await wait(100)
  }
  if (!pending) throw Error('The device never asked to pair')
  await command('pair', 'confirm', pending.installation_id, pending.fingerprint)
  const registration = await pairing
  const created = JSON.parse(
    await evalLong(
      `(async()=>{${PRELUDE}
      const connection=nodes.connection(${JSON.stringify(registration)});
      await until(()=>connection.state.value==='connected','The paired connection');
      const client=connection.client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const job=await client.createWorkspace(project.project_id);
      let workspace;for(let i=0;i<400;i++){const j=await client.getJob(job.job_id);if(j.state==='succeeded'){workspace=j.result?.workspace_id??j.workspace_id;break}if(j.state==='failed')throw Error('Workspace failed');await wait(50)}
      if(!workspace){const list=await client.listWorkspaces(project.project_id);workspace=list.find(w=>w.kind!=='root')?.workspace_id??list[0]?.workspace_id}
      const session=await client.createSession('Sample long session',workspace,'claude');
      const node=nodes.nodes.value.find(n=>n.id===${JSON.stringify(registration)});
      return JSON.stringify({session:session.session_id,node:node.expectedNodeId})})()`,
      180000
    )
  ) as { session: string; node: string }

  // The journal grows to a giant one while the node is stopped, as days of work would.
  await stop()
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(state, 'node.sqlite'))
  const head = Number(
    (
      db.prepare('SELECT head_seq FROM streams WHERE stream_id=?').get(created.session) as {
        head_seq: number
      }
    ).head_seq
  )
  const journal = giantJournal({ turns: TURNS, stream: created.session, node: created.node }).slice(
    1
  )
  const insert = db.prepare('INSERT INTO events VALUES(?,?,?)')
  db.exec('BEGIN')
  journal.forEach((event, i) => {
    const seq = head + i + 1
    insert.run(created.session, seq, JSON.stringify({ ...event, seq }))
  })
  db.prepare('UPDATE streams SET head_seq=? WHERE stream_id=?').run(
    head + journal.length,
    created.session
  )
  db.exec('COMMIT')
  db.close()
  const journalBytes = journal.reduce((n, e) => n + JSON.stringify(e).length, 0)
  await start()

  // Open it over the network and measure.
  const before = { ...traffic }
  const opened = JSON.parse(
    await evalLong(
      `(async()=>{${PRELUDE}
      const connection=nodes.connection(${JSON.stringify(registration)});
      await until(()=>connection.state.value==='connected','The reconnection');
      const heapBefore=heap();
      const t0=performance.now();
      await chats.openNodeSession({kind:'node-session',nodeId:${JSON.stringify(created.node)},registrationId:${JSON.stringify(registration)},sessionId:${JSON.stringify(created.session)},title:'Sample long session'});
      await chats.revealSidebar({focus:false});
      const last='Answer ${TURNS}.';
      await until(()=>chat()&&[...chat().querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes(last)),'The latest answer',120000);
      const openMs=Math.round(performance.now()-t0);
      const presenter=chats.getNodeSession('node:'+${JSON.stringify(registration)}+':'+${JSON.stringify(created.session)});
      const kept=(await connection.client.history(${JSON.stringify(created.session)})).length;
      const dom=chat().querySelectorAll('.abele-chat-msg').length;
      return JSON.stringify({openMs,kept,dom,heapBefore,heapOpen:heap(),hasOlder:presenter.hasOlder.value})})()`,
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
      field.value='stream 300 15';field.dispatchEvent(new Event('input',{bubbles:true}));
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      const frames=[];let last=performance.now(),done=false;
      (async()=>{while(!done){const now=await frame();frames.push(now-last);last=now}})();
      const t0=performance.now();
      await until(()=>[...root.querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes('word40 ')),'The streamed answer',60000);
      const firstMs=Math.round(performance.now()-t0);
      const streamingTyping=stats(await type('typed while it answers'));
      await until(()=>[...root.querySelectorAll('.abele-chat-msg')].some(m=>m.textContent.includes('word299')),'The whole streamed answer',120000);
      const streamMs=Math.round(performance.now()-t0);
      done=true;await frame();
      return JSON.stringify({typing,streamingTyping,firstMs,streamMs,frames:stats(frames),heapLive:heap()})})()`,
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
    journal: { events: journal.length, mb: +(journalBytes / 1e6).toFixed(1) },
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
