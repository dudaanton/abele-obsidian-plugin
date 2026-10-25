/**
 * A real node (`ABELE_NODE_CLI`) running Claude sessions through the live fake CLI
 * (`tests/fixtures/nodeClaudeLive.mjs`), reached by the app as a paired remote device through a
 * proxy that can add network latency and counts what crosses it. On the phone the proxy's port is
 * reversed to the device, so the phone talks to the node over its own link.
 *
 * `start()` pairs the app and registers a trusted sample project with a managed worktree;
 * `session(title)` creates a Claude session there. `restart(edit)` stops the node, lets the test
 * change its state directory (its journal), and starts it again on the same pairing.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong } from './obsidianCli'
import { onPhone } from './target'
import { exposeToPhone } from './phone'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LABEL = 'Sample remote node'

export const PAIRED_PRELUDE = `const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,what,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await wait(25)}throw Error(what+' did not happen')};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const chat=()=>[...document.querySelectorAll('.abele-node-chat')].find(r=>r.getBoundingClientRect().width>0);`

export async function startPairedNode(options: { latencyMs?: number; allowBypass?: boolean } = {}) {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  const latency = options.latencyMs ?? 0
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/paired-node-'))
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
  let child: ChildProcess | undefined
  let pairedPort = 0
  let logs = ''
  const sockets = new Set<Socket>()
  let disconnected = false
  const launch = async () => {
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--json',
        '--no-codex',
        ...(options.allowBypass === false ? [] : ['--claude-allow-bypass']),
        // Sessions end with the node: a test leaves no Claude process behind.
        '--claude-detached-ms',
        '0',
        '--node-name',
        LABEL,
        '--port',
        '0',
        '--paired-config',
        config,
        '--state-dir',
        state,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    )
    let output = ''
    child.stdout!.on('data', (d) => {
      output += d
      logs = (logs + d).slice(-20000)
    })
    child.stderr!.on('data', (d) => (logs = (logs + d).slice(-20000)))
    for (let i = 0; i < 500 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw Error(logs)
      await wait(20)
    }
    const line = output.split('\n').find((l) => l.includes('"listening"'))
    if (!line) throw Error('Node did not start: ' + logs)
    pairedPort = JSON.parse(line).paired_port
  }
  const halt = async () => {
    const running = child
    if (!running) return
    running.kill('SIGTERM')
    for (let i = 0; i < 500 && running.exitCode === null && running.signalCode === null; i++)
      await wait(20)
    for (const s of sockets) s.destroy()
  }
  /** Bytes that crossed the proxy: `down` from the node to the app, `up` the other way. */
  const traffic = { down: 0, up: 0 }
  const relay = (from: Socket, to: Socket, count: (n: number) => void) =>
    from.on('data', (chunk) => {
      count(chunk.length)
      if (!latency) to.writable && to.write(chunk)
      else setTimeout(() => to.writable && to.write(chunk), latency)
    })
  await launch()
  const proxy: Server = createServer()
  proxy.on('upgrade', (request, socket: Socket, head) => {
    if (disconnected) return socket.destroy()
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
      relay(socket, upstream, (n) => (traffic.up += n))
      relay(upstream, socket, (n) => (traffic.down += n))
      // A side that closes still has its last chunks on their way: close after them.
      socket.on('close', () => setTimeout(() => upstream.destroy(), latency + 5))
      upstream.on('close', () => setTimeout(() => socket.destroy(), latency + 5))
    })
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
  const port = (proxy.address() as { port: number }).port
  const unexpose = onPhone() ? await exposeToPhone(port) : undefined

  // Pair this app as a remote device and give the node a trusted project with a worktree.
  const invite = await command('pair', 'invite', 'sample-remote-device')
  const pairing = evalLong(
    `(async()=>{${PAIRED_PRELUDE}
    for(const n of [...nodes.nodes.value])if(n.label===${JSON.stringify(LABEL)}){try{nodes.remove(n.id)}catch{}}
    api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');
    return (await nodes.pair(${JSON.stringify(LABEL)},${JSON.stringify(invite)})).id})()`,
    120000
  )
  let pending: { installation_id: string; fingerprint: string } | undefined
  for (let i = 0; i < 300 && !pending; i++) {
    pending = (await command('pair', 'list')).find((d: { state: string }) => d.state === 'pending')
    if (!pending) await wait(100)
  }
  if (!pending) throw Error('The device never asked to pair: ' + logs)
  await command('pair', 'confirm', pending.installation_id, pending.fingerprint)
  const registration = await pairing.catch((error: Error) => {
    throw new Error(`${error.message}\nnode log:\n${logs}`)
  })
  const placed = JSON.parse(
    await evalLong(
      `(async()=>{${PAIRED_PRELUDE}
      const connection=nodes.connection(${JSON.stringify(registration)});
      await until(()=>connection.state.value==='connected','The paired connection');
      const client=connection.client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const job=await client.createWorkspace(project.project_id);
      for(let i=0;i<400;i++){const j=await client.getJob(job.job_id);if(j.state==='succeeded')break;if(j.state==='failed')throw Error('Workspace failed');await wait(50)}
      const list=await client.listWorkspaces(project.project_id);
      const workspace=(list.find(w=>w.kind!=='root')??list[0]).workspace_id;
      return JSON.stringify({workspace,project:project.project_id,node:nodes.nodes.value.find(n=>n.id===${JSON.stringify(registration)}).expectedNodeId})})()`,
      180000
    )
  ) as { workspace: string; project: string; node: string }

  return {
    state,
    registration,
    node: placed.node,
    project: placed.project,
    traffic,
    logs: () => logs,
    /** Drop the transport without stopping the running agent. */
    disconnect() {
      disconnected = true
      for (const socket of sockets) socket.destroy()
    },
    reconnect() {
      disconnected = false
    },
    /** Reload creates a new service; restore only this fixture's transport adapter. */
    async restoreTransport() {
      await evalLong(`(()=>{${PAIRED_PRELUDE}
        api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');
        void nodes.connection(${JSON.stringify(registration)}).connect();return 'restored'})()`)
    },
    /** Another managed worktree of the sample project: a second session works there. */
    async worktree(): Promise<string> {
      return evalLong(
        `(async()=>{${PAIRED_PRELUDE}
        const client=nodes.connection(${JSON.stringify(registration)}).client;
        const before=new Set((await client.listWorkspaces(${JSON.stringify(placed.project)})).map(w=>w.workspace_id));
        const job=await client.createWorkspace(${JSON.stringify(placed.project)});
        for(let i=0;i<400;i++){const j=await client.getJob(job.job_id);if(j.state==='succeeded')break;if(j.state==='failed')throw Error('Workspace failed');await wait(50)}
        return (await client.listWorkspaces(${JSON.stringify(placed.project)})).find(w=>!before.has(w.workspace_id)).workspace_id})()`,
        180000
      )
    },
    /** A Claude session in the sample worktree, or in `workspace`. */
    async session(
      title: string,
      settings?: Record<string, unknown>,
      workspace = placed.workspace
    ): Promise<string> {
      return evalLong(
        `(async()=>{${PAIRED_PRELUDE}
        const client=nodes.connection(${JSON.stringify(registration)}).client;
        return (await client.createSession(${JSON.stringify(title)},${JSON.stringify(workspace)},'claude'${settings ? ',' + JSON.stringify(settings) : ''})).session_id})()`,
        60000
      )
    },
    /** The session's tab, opened as a person opens it from the panel. */
    open(session: string, title: string): Promise<string> {
      return evalLong(
        `(async()=>{${PAIRED_PRELUDE}
        await chats.openNodeSession({kind:'node-session',nodeId:${JSON.stringify(placed.node)},registrationId:${JSON.stringify(registration)},sessionId:${JSON.stringify(session)},title:${JSON.stringify(title)}});
        await chats.revealSidebar({focus:false});return 'node:'+${JSON.stringify(registration)}+':'+${JSON.stringify(session)}})()`,
        60000
      )
    },
    async restart(edit: () => void | Promise<void>) {
      await halt()
      await edit()
      await launch()
    },
    async close() {
      await evalLong(
        `(async()=>{${PAIRED_PRELUDE}
        for(const id of [...chats.tabOrder.value])if(id.startsWith('node:'+${JSON.stringify(registration)}))await chats.closeTab(id);
        try{nodes.remove(${JSON.stringify(registration)})}catch{}return '1'})()`,
        60000
      ).catch(() => {})
      await unexpose?.().catch(() => {})
      await halt()
      proxy.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
