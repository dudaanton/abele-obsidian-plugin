import { nodeAgentTurn as chatTurn, type NodeAgentTurn as Turn } from './helpers/nodeAgentTurn'
import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { enterPhone, evalRaw, reloadApp } from './helpers/obsidianCli'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Every node tool an agent can be given in its settings, both groups, as a person who
// switched them all on would have them.
const NODE_TOOLS = [
  'node_nodes',
  'node_folders',
  'list_node_worktrees',
  'node_ls',
  'node_read',
  'node_edit',
  'node_replace',
  'node_write',
  'node_mv',
  'node_cp',
  'node_rm',
  'node_search',
  'node_git_status',
  'node_git_diff',
  'node_git_branches',
  'node_git_log',
  'node_git_blame',
  'node_worktree_switch',
  'node_views',
  'node_tree',
  'node_file',
  'node_changes',
  'node_commits',
  'node_commit',
  'node_compare',
  'node_grep',
  'node_blame',
  'node_open',
  'node_propose_edit',
]

async function exercise(label: string) {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = realpathSync(mkdtempSync(resolve('../.scratch/agent-files-'))),
    repo = resolve(dir, 'repo'),
    state = resolve(dir, 'state')
  mkdirSync(repo)
  writeFileSync(resolve(repo, 'sample.txt'), 'first line\nsecond line\n')
  const git = (...args: string[]) => {
    const r = spawnSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' })
    if (r.status) throw Error(r.stderr)
  }
  git('init', '-b', 'main')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture'
  )
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const token = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(token.status, token.stderr).toBe(0)
  const credential = JSON.parse(token.stdout) as { token: string }
  const chat = `Sample node files ${Date.now()}.abchat`
  let child: ChildProcess | undefined,
    registration = '',
    agentId = ''
  try {
    child = spawn(
      process.execPath,
      [cli, 'start', '--state-dir', state, '--port', '0', '--claude-path', fake, '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (b) => (output += b))
    child.stderr!.on('data', (b) => (errors += b))
    for (let i = 0; !output.includes('"listening"'); i++) {
      if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
      await wait(20)
    }
    const info = JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as {
      port: number
    }
    const setup = evalAsync<{
      registration: string
      project: string
      worktree: string
      agent: string
    }>(`(async()=>{
      const T=window.__abeleTest,nodes=T.NodeService.getInstance(),chats=T.ChatService.getInstance(),wait=ms=>new Promise(r=>setTimeout(r,ms));
      const node=await nodes.add('Sample files node','http://127.0.0.1:${info.port}',${JSON.stringify(credential.token)}),client=nodes.connection(node.id).client;
      for(let i=0;i<200&&!client.connected;i++)await wait(50);
      const project=await client.registerProject(${JSON.stringify(repo)},'untrusted');
      const worktree=(await client.repository.worktrees({project_id:project.project_id})).entries[0];
      const agent=T.AgentRegistry.getInstance().create({name:'Sample node files agent',toolModes:Object.fromEntries(${JSON.stringify(NODE_TOOLS)}.map(n=>[n,'auto']))});
      await chats.openChatFile(await app.vault.create(${JSON.stringify(chat)},JSON.stringify({v:2,k:'meta',type:'abele-chat',agentId:agent.id,providerId:'',modelId:'',title:'Sample node files',created:'2026-01-01'})+'\\n'));
      const session=chats.getSessionByFile(${JSON.stringify(chat)});session.permissionMode.value='allow-all';
      return JSON.stringify({registration:node.id,project:project.project_id,worktree:worktree.worktree_id,agent:agent.id})
    })()`)
    registration = setup.registration
    agentId = setup.agent

    // Without node access the node section stays closed until the model opens it, the way a
    // model reads its description; then the tools are offered, and each must say what is
    // missing and how the person gives it, rather than an empty list or a bare refusal.
    const without = evalAsync<Turn>(
      chatTurn(
        chat,
        `[()=>({name:'open_nodes',params:{}}),()=>({name:'node_nodes',params:{}}),()=>({name:'node_read',params:{path:'sample.txt'}})]`
      )
    )
    expect(without.error).toBeUndefined()
    expect(without.tools).toEqual(expect.arrayContaining(['node_nodes', 'node_read', 'node_edit']))
    expect(without.calls.map((c) => c.name)).toEqual(['open_nodes', 'node_nodes', 'node_read'])
    expect(without.calls[0].result, JSON.stringify(without)).toMatch(/Give a chat access/)
    for (const call of without.calls.slice(1))
      expect(call.result, JSON.stringify(without)).toMatch(/access/i)
    for (const call of without.calls.slice(1))
      expect(call.result, JSON.stringify(without)).toMatch(/Give a chat access/)

    // The access the node panel's row menu gives: one worktree, read and edit.
    evalAsync(`(async()=>{
      const T=window.__abeleTest,session=T.ChatService.getInstance().getSessionByFile(${JSON.stringify(chat)});
      await T.giveNodeChatAccess(session,{kind:'target',node_id:${JSON.stringify(registration)},project_id:${JSON.stringify(setup.project)},target:{kind:'worktree',worktree_id:${JSON.stringify(setup.worktree)}},access:'edit'});
      return JSON.stringify(true)
    })()`)

    // A model starts from the path it was told about, with no IDs: the one target this chat
    // was given is where it reads. Then it discovers the IDs and edits with them.
    const withAccess = evalAsync<Turn>(
      chatTurn(
        chat,
        `[
        ()=>({name:'node_read',params:{path:'sample.txt'}}),
        ()=>({name:'node_nodes',params:{}}),
        r=>({name:'node_folders',params:{node:JSON.parse(r.at(-1))[0].node}}),
        r=>{const f=JSON.parse(r.at(-1))[0];return {name:'node_read',params:{node:JSON.parse(r.at(-2))[0].node,project:f.project,workspace:f.worktrees[0].worktree_id,target_kind:'worktree',path:'sample.txt'}}},
        r=>{const read=JSON.parse(r.at(-1)),prev=JSON.parse(r.at(-2))[0];return {name:'node_edit',params:{node:JSON.parse(r.at(-3))[0].node,project:prev.project,workspace:prev.worktrees[0].worktree_id,target_kind:'worktree',path:'sample.txt',expected_content_id:read.content_id,old_text:'second line',new_text:'edited line'}}},
      ]`
      )
    )
    expect(withAccess.error, JSON.stringify(withAccess)).toBeUndefined()
    expect(withAccess.calls.map((c) => c.name)).toEqual([
      'node_read',
      'node_nodes',
      'node_folders',
      'node_read',
      'node_edit',
    ])
    expect(withAccess.calls[0].result, JSON.stringify(withAccess)).toContain('first line')
    expect(withAccess.calls[3].result, JSON.stringify(withAccess)).toContain('second line')
    expect(withAccess.calls[4].result, JSON.stringify(withAccess)).toMatch(/saved/)
    expect(readFileSync(resolve(repo, 'sample.txt'), 'utf8')).toBe('first line\nedited line\n')
    evalAsync(
      `(async()=>{await window.__abeleTest.ChatService.getInstance().revealSidebar({focus:false});return JSON.stringify(true)})()`
    )
    columnShot(`${shotDir('abele-node-agent-files')}/${label}.png`)
  } finally {
    evalRaw(`(async()=>{
      const T=window.__abeleTest,chats=T.ChatService.getInstance(),s=chats.getSessionByFile(${JSON.stringify(chat)});
      if(s){s.abort();await chats.closeTab(s.id)}
      if(app.vault.getAbstractFileByPath(${JSON.stringify(chat)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(chat)});
      if(${JSON.stringify(agentId)})T.AgentRegistry.getInstance().remove(${JSON.stringify(agentId)});
      if(${JSON.stringify(registration)})T.NodeService.getInstance().remove(${JSON.stringify(registration)});
      return true
    })()`)
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
      child.kill('SIGTERM')
      await stopped
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

it('lets an ordinary chat find, read and edit project files on a node once the chat has node access', async () => {
  await exercise('desktop')
  try {
    await enterPhone()
    await exercise('phone-emulated')
  } finally {
    await reloadApp('app.emulateMobile(false)')
  }
}, 240000)
