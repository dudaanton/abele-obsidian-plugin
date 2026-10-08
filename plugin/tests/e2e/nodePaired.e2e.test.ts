import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)); const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await wait(50)}throw Error('Paired UI did not converge: '+fn.toString())}; const api=window.__abeleTest, nodes=api.NodeService.getInstance();`

it('pairs through the real node UI, confirms locally, runs fake prompts and fences a revoked key', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/paired-ui-'))
  const endpoint = 'wss://sample.example.ts.net:8443/channel'
  const config = resolve(dir, 'paired.json')
  writeFileSync(
    config,
    JSON.stringify({
      endpoint,
      backend_port: 0,
      origins: ['app://obsidian.md'],
      allow_missing_origin: false,
      allow_null_origin: false,
    }),
    { mode: 0o600 }
  )
  const env = { ...process.env, ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs') }
  let child: ChildProcess | undefined,
    registration = '',
    tab = ''
  const sockets = new Set<Socket>()
  const proxy = createServer()
  const command = async (...args: string[]) =>
    JSON.parse(
      (await promisify(execFile)(process.execPath, [cli, ...args, '--state-dir', dir], { env }))
        .stdout
    )
  try {
    child = spawn(
      process.execPath,
      [cli, 'start', '--port', '0', '--paired-config', config, '--state-dir', dir],
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (d) => {
      output += d
    })
    child.stderr!.on('data', (d) => {
      errors += d
    })
    for (let i = 0; i < 300 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw Error(errors)
      await wait(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    expect(ready.paired_port).toBeGreaterThan(0)
    // Emulate only Serve's Host forwarding on loopback; preserve the real browser Origin.
    proxy.on('upgrade', (request, socket: Socket, head) => {
      if (request.url !== '/channel') {
        socket.destroy()
        return
      }
      const upstream = connect(ready.paired_port, '127.0.0.1')
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
          `GET /channel HTTP/1.1\r\n${headers.reduce((text, value, i) => text + (i % 2 ? value + '\r\n' : value + ': '), '')}\r\n`
        )
        if (head.length) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const port = (proxy.address() as { port: number }).port
    const invite = await command('pair', 'invite', 'sample-remote-device')
    registration = await evalLong(
      `(async()=>{${prelude}
      api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');
      app.setting.open();app.setting.openTabById('abele');
      const doc=app.setting.activeTab.containerEl.ownerDocument;
      await until(()=>doc.querySelector('.abele-settings__nav .abele-tabs__tab'));
      [...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t=>t.textContent.trim()==='Nodes').click();
      await until(()=>[...doc.querySelectorAll('button')].some(b=>b.textContent.trim()==='Pair remote node'));
      [...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair remote node').click();
      await until(()=>doc.querySelector('textarea[aria-label="Node invitation"]'));
      const input=doc.querySelector('textarea[aria-label="Node invitation"]');input.value=${JSON.stringify(JSON.stringify(invite))};input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);
      const press=text=>[...doc.querySelectorAll('.abele-node-pairing button')].find(b=>b.textContent.trim()===text).click();
      press('Review invitation');await until(()=>doc.querySelector('[aria-label="Node key fingerprint"]'));
      if(doc.querySelector('[aria-label="Node key fingerprint"]').textContent.trim()!==${JSON.stringify(invite.node_fingerprint)})throw Error('Wrong pin shown');
      press('Pair this device');await until(()=>doc.querySelector('[aria-label="Device key fingerprint"]'));
      return nodes.nodes.value.find(n=>n.expectedNodeId===${JSON.stringify(invite.node_id)}).id;})()`,

      60000
    )
    const pending = (await command('pair', 'list')).find(
      (d: { state: string }) => d.state === 'pending'
    )
    const displayed = evalRaw(
      `app.setting.activeTab.containerEl.ownerDocument.querySelector('[aria-label="Device key fingerprint"]').textContent.trim()`
    )
    expect(displayed).toBe(pending.fingerprint)
    await command('pair', 'confirm', pending.installation_id, pending.fingerprint)
    const state = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}
      const doc=app.setting.activeTab.containerEl.ownerDocument;
      await until(()=>doc.querySelector('.abele-node-pairing')?.textContent.includes('Connected over paired WSS'));
      const node=nodes.nodes.value.find(n=>n.expectedNodeId===${JSON.stringify(invite.node_id)});
      doc.querySelector('.modal.abele-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));app.setting.close();
      const client=nodes.connection(node.id).client, session=await client.createSession('Sample remote task');
      const chats=api.ChatService.getInstance();
      const reference={kind:'node-session',nodeId:node.expectedNodeId,registrationId:node.id,sessionId:session.session_id,title:session.title};
      await chats.openNodeSession(reference);await chats.revealSidebar({focus:false});
      const tab='node:'+node.id+':'+session.session_id,presenter=chats.getNodeSession(tab);
      await presenter.send('Sample remote input',[{kind:'permission',ttl_ms:60000},{kind:'echo'}]);
      const chat=()=>[...document.querySelectorAll('.abele-node-chat')].find(root=>root.getBoundingClientRect().width>0);
      await until(()=>chat()?.querySelector('.abele-node-permission button.mod-cta'));
      chat().querySelector('.abele-node-permission button.mod-cta').click();
      await until(()=>chat()?.querySelector('.abele-node-permission')?.textContent.includes('Decision delivered to provider'));
      const resolved=(await client.prompts(session.session_id)).find(p=>p.choice==='allow');
      if(!resolved || resolved.state!=='resolved' || resolved.delivered!==true)throw Error('Fake prompt receipt is not exact');
      return JSON.stringify({registration:node.id,tab,pin:await nodes.deviceFingerprint(node.expectedNodeId)});
    })()`,
        60000
      )
    ) as { registration: string; tab: string; pin: string }
    registration = state.registration
    tab = state.tab
    expect(state.pin).toBe(pending.fingerprint)
    await command('pair', 'revoke', pending.installation_id)
    const revoked = await evalLong(
      `(async()=>{${prelude}const c=nodes.connection(${JSON.stringify(registration)});await c.client.disconnect();try{await c.connect();return 'unexpected admission'}catch{return 'revoked'}})()`,
      60000
    )
    expect(revoked).toBe('revoked')
    const recovery = await command(
      'pair',
      'invite',
      'sample-recovery',
      '--pair-installation',
      pending.installation_id
    )
    const repaired = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const before=nodes.connection(${JSON.stringify(registration)});const node=await nodes.pair('Remote node',${JSON.stringify(recovery)});if(nodes.connection(node.id)!==before || api.ChatService.getInstance().getNodeSession(${JSON.stringify(tab)}).connection!==before)throw Error('Re-pair stranded the open session');return JSON.stringify({id:node.id,installation:node.installationId,pin:await nodes.deviceFingerprint(node.expectedNodeId)})})()`,
        60000
      )
    ) as { id: string; installation: string; pin: string }
    expect(repaired).toEqual({
      id: registration,
      installation: pending.installation_id,
      pin: state.pin,
    })
    await command('pair', 'confirm', pending.installation_id, repaired.pin)
    expect(
      await evalLong(
        `(async()=>{${prelude}await nodes.connection(${JSON.stringify(registration)}).connect();return 'reconnected'})()`,
        60000
      )
    ).toBe('reconnected')
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}const modal=(app.setting.activeTab?.containerEl.ownerDocument ?? document).querySelector('.modal.abele-modal');modal?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));app.setting.close();const chats=api.ChatService.getInstance();for(const candidate of [...chats.tabOrder.value])if(chats.getNodeSession(candidate)?.reference.registrationId===${JSON.stringify(registration)})await chats.closeTab(candidate);for(const node of [...nodes.nodes.value])if(node.id===${JSON.stringify(registration)} || node.url===${JSON.stringify(endpoint)})nodes.remove(node.id);api.NodeService.destroyCurrent();return 'closed'})()`,
        60000
      )
    } finally {
      for (const socket of sockets) socket.destroy()
      if (proxy.listening) await new Promise<void>((r) => proxy.close(() => r()))
      if (child && child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((r) => child!.once('exit', () => r()))
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 180000)
