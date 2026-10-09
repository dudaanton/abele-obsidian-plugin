import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, copyFileSync, chmodSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { evalAsync } from './helpers/githubLive'
import { reloadPlugin } from './helpers/obsidianCli'
import { targets } from './helpers/target'
targets('desktop')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PRELUDE = `const T = window.__abeleTest;
const chats = T.ChatService.getInstance(), nodes = T.NodeService.getInstance();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for(let i=0;i<300;i++){if(fn())return;await wait(50)}throw Error('Delegation UI did not converge: '+fn.toString()) };`

it('a normal plugin agent delegates through owner UI to both fake providers, survives offline completion and opens the child normally', async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built daemon CLI for delegation acceptance')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/d-'))
  const fake = resolve(dir, 'claude.mjs')
  copyFileSync(resolve('tests/fixtures/nodeDelegationClaude.mjs'), fake)
  chmodSync(fake, 0o700)
  const env = {
    ...process.env,
    ABELE_CLAUDE_PATH: fake,
    ABELE_PI_HOST: resolve('tests/fixtures/nodeDelegationPi.mjs'),
  }
  const repo = resolve(dir, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => {
    const r = spawnSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  }
  git('init', '-b', 'main')
  writeFileSync(resolve(repo, 'sample.txt'), 'sample\n')
  git('add', '.')
  git(
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
  const enroll = (label: string) => {
    const r = spawnSync(process.execPath, [cli, 'token', 'create', label, '--state-dir', dir], {
      encoding: 'utf8',
      env,
    })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout).token as string
  }
  const token = enroll('sample-parent'),
    humanToken = enroll('sample-human')
  let daemon: ChildProcess | undefined, human: NodeClient | undefined
  let registration = '',
    parentId = '',
    agentId = ''
  const path = 'sample-node-parent.abchat'
  try {
    daemon = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--state-dir',
        dir,
        '--port',
        '0',
        '--claude-profile',
        'isolated',
        '--pi-profile',
        'isolated',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    )
    let output = '',
      errors = ''
    daemon.stdout!.on('data', (b) => {
      output += b
    })
    daemon.stderr!.on('data', (b) => {
      errors += b
    })
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (daemon.exitCode !== null) throw Error(errors)
      await wait(25)
    }
    const port = JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!).port
    // Independent human transcript reader, not the controller installation or mailbox.
    human = new NodeClient(
      { url: `ws://127.0.0.1:${port}/channel`, profile: 'local-token-v1', token: humanToken },
      new MemoryClientStore()
    )
    await human.connect()
    const project = await human.registerProject(repo, 'trusted')
    const setup = evalAsync<{ registration: string; parent: string; agent: string }>(`(async () => {
      ${PRELUDE}
      if(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))throw Error('Synthetic chat already exists');
      const agent = T.AgentRegistry.getInstance().create({ name: 'Sample node parent', toolModes: { node_delegations: 'auto', node_delegate: 'auto', node_delegation_send: 'auto', node_delegation_status: 'auto', node_delegation_cancel: 'auto' } });
      const file = await app.vault.create(${JSON.stringify(path)}, JSON.stringify({ v:2, k:'meta', type:'abele-chat', agentId:agent.id, providerId:'', modelId:'', title:'Sample parent', created:'2028-01-01' })+'\\n');
      await chats.openChatFile(file); await chats.revealSidebar({focus:false});
      const parent = chats.getSessionByFile(file.path);
      const node = await nodes.add('Sample delegation node', 'http://127.0.0.1:${port}', ${JSON.stringify(token)});
      app.setting.open(); app.setting.openTabById('abele');
      const doc = app.setting.activeTab.containerEl.ownerDocument;
      await until(() => doc.querySelector('.abele-settings__nav .abele-tabs__tab'));
      [...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim()==='Nodes').click();
      await until(() => [...doc.querySelectorAll('.setting-item-name')].some(e=>e.textContent===node.label));
      const row = [...doc.querySelectorAll('.setting-item')].find(r=>r.querySelector('.setting-item-name')?.textContent===node.label);
      [...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='Delegation grants').click();
      // A native settings window owns its modal document, not the main chat window.
      try { await until(() => doc.querySelector('[aria-label="Delegation provider"] option[value="pi"]')) }
      catch(e) { throw Error(String(e) + ' · owner UI status: ' + [...doc.querySelectorAll('.abele-settings__content [role="status"]')].map(p=>p.textContent).join(' · ') + ' · dialog: ' + doc.querySelector('.abele-node-grants')?.textContent) }
      const select=(label,value)=>{const e=doc.querySelector('select[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}))};
      for(const provider of ['claude','pi']) {
        select('Delegation parent chat',parent.delegationParentId); select('Delegation project',${JSON.stringify(project.project_id)}); select('Delegation provider',provider);
        await wait(100); doc.querySelector('[aria-label="Approve delegation actions"]').click(); await wait(100);
        [...doc.querySelectorAll('.abele-node-grants button')].find(b=>b.textContent.trim()==='Approve grant').click();
        await until(() => doc.querySelector('[aria-label="Approve delegation actions"]').getAttribute('aria-checked')==='false');
        await until(() => [...doc.querySelectorAll('.abele-node-grants button')].find(b=>b.textContent.trim()==='Refresh')?.disabled===false);
      }
      doc.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); app.setting.close();
      return JSON.stringify({registration:node.id,parent:parent.delegationParentId,agent:agent.id})
    })()`)
    registration = setup.registration
    parentId = setup.parent
    agentId = setup.agent
    const children = evalAsync<
      { sessionId: string; delegationId: string; mailbox: string }[]
    >(`(async () => {
      ${PRELUDE}
      const session=chats.getSessionByFile(${JSON.stringify(path)}), connection=nodes.connection(${JSON.stringify(registration)});
      const realFetch=window.fetch, endpoint='https://sample-node-model.invalid/v1';
      session.resolveModel=()=>({id:'sample',name:'Sample',baseUrl:endpoint,apiKey:'none',contextWindow:100000,maxTokens:1000,supportsReasoning:false});
      for(const key of ['generateTitle','generateSummary','generateRecap','autoCompactIfNeeded'])session.summarizer[key]=async()=>{};
      let provider, called=false;
      window.fetch=async(url,init)=>{
        if(typeof url!=='string'||!url.startsWith(endpoint))return realFetch(url,init);
        const body=JSON.parse(init.body);
        if(!body.tools.some(t=>t.function.name==='node_delegate'))throw Error('Node tools missing from normal registry');
        const delta=called?{content:'Delegated sample task.'}:{tool_calls:[{index:0,id:'sample-call-'+provider,type:'function',function:{name:'node_delegate',arguments:JSON.stringify({node:${JSON.stringify(registration)},task_key:'sample-'+provider,project_id:${JSON.stringify(project.project_id)},provider,title:'Sample '+provider+' task',text:'Sample offline task'})}}]};
        const finish=called?'stop':'tool_calls';called=true;const enc=new TextEncoder();
        return new Response(new ReadableStream({start(c){for(const chunk of [{choices:[{delta}]},{choices:[{delta:{},finish_reason:finish}]}])c.enqueue(enc.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));c.enqueue(enc.encode('data: [DONE]\\n\\n'));c.close()}}),{status:200,headers:{'Content-Type':'text/event-stream'}});
      };
      try {
        for(provider of ['claude','pi']) {called=false;await session.sendMessage('Delegate sample '+provider+' task');if(session.error.value)throw Error(session.error.value)}
        await session.save(); await connection.refreshDelegations();
        const cards=await connection.delegation.cards(session.delegationParentId);
        if(cards.length!==2)throw Error('Expected two child links: '+JSON.stringify(cards));
        const state=await connection.store.transaction(s=>Object.values(s.delegation.tasks).map(t=>({sessionId:t.child.session_id,delegationId:t.child.delegation_id,mailbox:t.child.mailbox_stream_id})));
        // End all plugin connections, as when Obsidian closes. The node keeps running.
        T.NodeService.destroyCurrent();
        return JSON.stringify(state)
      } finally {window.fetch=realFetch}
    })()`)
    expect(children).toHaveLength(2)
    for (const child of children) {
      await human.subscribe(child.sessionId)
      await expect(human.subscribe(child.mailbox)).rejects.toThrow(/unauthorized/)
    }
    for (let i = 0; i < 600; i++) {
      const histories = await Promise.all(children.map((c) => human!.history(c.sessionId)))
      if (histories.every(h => h.some(e => e.type === 'run.completed'))) break
      if (i === 599 || histories.some(h => h.some(e => ['run.failed', 'input.failed', 'input.delivery_unknown'].includes(e.type))))
        throw Error('Offline delegated tasks did not complete: ' + JSON.stringify(histories))
      await wait(25)
    }
    reloadPlugin()
    const result = evalAsync<{
      states: string[]
      results: string[]
      counts: number[]
    }>(`(async () => {
      ${PRELUDE}
      const parent=chats.getSessionByFile(${JSON.stringify(path)});
      await until(()=>nodes.connection(${JSON.stringify(registration)}).delegationCards.value[${JSON.stringify(parentId)}]?.every(c=>c.state==='completed'));
      chats.switchTab(parent.id);await chats.revealSidebar({focus:false});
      await until(()=>document.querySelectorAll('.abele-node-delegation').length===2);
      const cards=await nodes.connection(${JSON.stringify(registration)}).delegation.cards(parent.delegationParentId);
      return JSON.stringify({states:cards.map(c=>c.state),results:cards.flatMap(c=>c.reports.filter(r=>r.kind==='result').map(r=>r.text)),counts:[...document.querySelectorAll('.abele-node-delegation')].map(c=>c.querySelectorAll('[data-mailbox-seq]').length)})
    })()`)
    expect(result.states).toEqual(['completed', 'completed'])
    expect(result.results).toEqual(['Sample Claude delegated result', 'Sample pi delegated result'])
    expect(result.counts).toEqual([1, 1])
    const opened = evalAsync<string>(`(async () => {
      ${PRELUDE}
      document.querySelector('.abele-node-delegation button').click();
      await until(()=>document.querySelector('.abele-node-chat'));
      const child=chats.getNodeSession(chats.activeTabId.value);
      await until(()=>child.messages.value.some(m=>m.role==='assistant'));
      return JSON.stringify(child.reference.sessionId)
    })()`)
    expect(opened).toBe(children[0].sessionId)
    reloadPlugin()
    const once = evalAsync<number[]>(`(async () => {
      ${PRELUDE}
      await until(()=>nodes.connection(${JSON.stringify(registration)}).delegationCards.value[${JSON.stringify(parentId)}]?.length===2);
      return JSON.stringify((await nodes.connection(${JSON.stringify(registration)}).delegation.cards(${JSON.stringify(parentId)})).map(c=>c.reports.filter(r=>r.kind==='result').length))
    })()`)
    expect(once).toEqual([1, 1])
  } finally {
    try {
      evalAsync(`(async () => {
        ${PRELUDE}
        const fixtureAgent = ${JSON.stringify(agentId)} || chats.getSessionByFile(${JSON.stringify(path)})?.agent.value?.id;
        for(const id of [...chats.tabOrder.value]) {const child=chats.getNodeSession(id),parent=chats.getSession(id);if(child?.reference.registrationId===${JSON.stringify(registration)}||parent?.currentChatFile.value?.path===${JSON.stringify(path)})await chats.closeTab(id)}
        if(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(path)});
        if(fixtureAgent)T.AgentRegistry.getInstance().remove(fixtureAgent);
        for(const n of [...nodes.nodes.value].filter(n=>n.id===${JSON.stringify(registration)}||n.label==='Sample delegation node'))nodes.remove(n.id);
        app.setting.close();return JSON.stringify(true)
      })()`)
    } finally {
      await human?.disconnect()
      if (daemon && daemon.exitCode === null) {
        daemon.kill('SIGTERM')
        await new Promise<void>((r) => daemon!.once('exit', () => r()))
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 180000)
