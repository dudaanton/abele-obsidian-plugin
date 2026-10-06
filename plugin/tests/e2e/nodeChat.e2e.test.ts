import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { evalRaw, reloadPlugin } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const PRELUDE = `const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i=0; i<200; i++) { if (fn()) return; await wait(50) } throw new Error('Node UI did not converge: ' + fn.toString()) };
const chats = window.__abeleTest.ChatService.getInstance();
const nodes = window.__abeleTest.NodeService.getInstance();`

it('adds a node through settings, sends and answers a prompt, then restores offline outbox and history after reload', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI for node live acceptance')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/n-'))
  const fakeClaude = resolve(dir, 'fixture-claude.mjs')
  copyFileSync(resolve('tests/fixtures/nodeClaude.mjs'), fakeClaude)
  chmodSync(fakeClaude, 0o700)
  const env = { ...process.env, ABELE_CLAUDE_PATH: fakeClaude }
  const projectsRoot = mkdtempSync('/tmp/abele-node-ui-')
  const projectPaths = ['one', 'two'].map((name) => resolve(projectsRoot, name))
  for (const path of projectPaths) {
    mkdirSync(path)
    const git = (args: string[]) => {
      const result = spawnSync('/usr/bin/git', args, { cwd: path, encoding: 'utf8' })
      if (result.status) throw new Error(result.stderr)
    }
    git(['init', '--initial-branch=main'])
    writeFileSync(resolve(path, 'sample.txt'), 'before\n')
    git(['add', 'sample.txt'])
    git([
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'sample',
    ])
  }
  let child: ChildProcess | undefined
  let port = 0
  let registrationId = ''
  const start = async () => {
    child = spawn(process.execPath, [cli, 'start', '--state-dir', dir, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 200 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await wait(20)
    }
    const ready = JSON.parse(
      output
        .trim()
        .split('\n')
        .find((line) => line.includes('"listening"'))!
    )
    port = ready.port
  }
  const stop = async () => {
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  }
  try {
    const credential = spawnSync(
      process.execPath,
      [cli, 'token', 'create', 'sample-desktop', '--state-dir', dir],
      { encoding: 'utf8', env }
    )
    expect(credential.status, credential.stderr).toBe(0)
    const { token } = JSON.parse(credential.stdout)
    await start()

    // Measure a real browser WebSocket Origin without intercepting shared Electron listeners.
    // No authentication or token is ever sent to this one-request observer.
    const observer = createServer()
    const origin = new Promise<string | undefined>((resolve) =>
      observer.once('upgrade', (request, socket) => {
        resolve(request.headers.origin)
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      })
    )
    await new Promise<void>((resolve) => observer.listen(0, '127.0.0.1', resolve))
    try {
      const observerPort = (observer.address() as { port: number }).port
      evalRaw(
        `(() => { const socket = new WebSocket('ws://127.0.0.1:${observerPort}/'); socket.onerror = () => socket.close(); return 'started' })()`
      )
      const actualOrigin = await Promise.race([
        origin,
        wait(5000).then(() => {
          throw new Error('No browser Origin captured')
        }),
      ])
      console.info('Desktop Obsidian WebSocket Origin:', actualOrigin)
      expect(actualOrigin).toBe('app://obsidian.md')
    } finally {
      await new Promise<void>((resolve) => observer.close(() => resolve()))
    }

    registrationId = evalAsync<string>(`(async () => {
      ${PRELUDE}
      app.setting.open(); app.setting.openTabById('abele');
      const settingsDoc = app.setting.activeTab.containerEl.ownerDocument;
      await until(() => settingsDoc.querySelector('.abele-settings__nav .abele-tabs__tab'));
      [...settingsDoc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Nodes').click();
      await until(() => settingsDoc.querySelector('input[aria-label="Node URL"]'));
      const fill = (label, value) => { const field = settingsDoc.querySelector('input[aria-label="' + label + '"]'); field.value = value; field.dispatchEvent(new Event('input', {bubbles:true})) };
      fill('Node label', 'Sample acceptance node'); fill('Node URL', 'http://127.0.0.1:${port}'); fill('Node installation token', ${JSON.stringify(token)});
      await wait(100);
      [...settingsDoc.querySelectorAll('.abele-settings__content button')].find(b => b.textContent.trim() === 'Add node').click();
      await until(() => nodes.nodes.value.some(n => n.label === 'Sample acceptance node'));
      const node = nodes.nodes.value.find(n => n.label === 'Sample acceptance node');
      const row = [...settingsDoc.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === node.label);
      [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open session').click();
      await until(() => document.querySelector('.suggestion-item'));
      [...document.querySelectorAll('.suggestion-item')].find(item => item.textContent.includes('Create new fake session')).click();
      await until(() => document.querySelector('.abele-node-chat'));
      const permission = [...document.querySelectorAll('.abele-node-chat .setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === 'Ask for permission');
      permission.querySelector('.checkbox-container').click();
      const field = document.querySelector('.abele-node-chat textarea');
      field.value = 'Sample permission question'; field.dispatchEvent(new Event('input',{bubbles:true}));
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));
      await until(() => [...document.querySelectorAll('.abele-node-chat button')].some(b => b.textContent.trim() === 'Allow'));
      [...document.querySelectorAll('.abele-node-chat button')].find(b => b.textContent.trim() === 'Allow').click();
      await until(() => chats.getNodeSession(chats.activeTabId.value).messages.value.some(m => m.role === 'assistant' && m.content === 'Sample permission question'));
      permission.querySelector('.checkbox-container').click();
      return JSON.stringify(node.id)
    })()`)

    await stop()
    const offline = evalAsync<{ queued: number; local: boolean }>(`(async () => {
      ${PRELUDE}
      const presenter = chats.getNodeSession(chats.activeTabId.value);
      await until(() => presenter.connection.state.value === 'offline');
      const field = document.querySelector('.abele-node-chat textarea');
      field.value = 'Sample offline follow-up'; field.dispatchEvent(new Event('input',{bubbles:true}));
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));
      await until(() => presenter.queued.value.length === 1);
      return JSON.stringify({ queued: presenter.queued.value.length, local: chats.activeSession.value !== null })
    })()`)
    expect(offline).toEqual({ queued: 1, local: false })
    reloadPlugin()
    const restored = evalAsync<{ queued: number; users: number }>(`(async () => {
      ${PRELUDE}
      await until(() => chats.getNodeSession(chats.activeTabId.value)?.queued.value.length === 1);
      const presenter = chats.getNodeSession(chats.activeTabId.value);
      return JSON.stringify({ queued: presenter.queued.value.length, users: presenter.messages.value.filter(m => m.role === 'user').length })
    })()`)
    expect(restored).toEqual({ queued: 1, users: 1 })
    await start()
    evalAsync(`(async () => {
      ${PRELUDE}
      const presenter = chats.getNodeSession(chats.activeTabId.value);
      await until(() => presenter.messages.value.some(m => m.role === 'assistant' && m.content === 'Sample offline follow-up'));
      await until(() => presenter.queued.value.length === 0);
      return JSON.stringify(true)
    })()`)
    reloadPlugin()
    const final = evalAsync<{
      users: string[]
      replies: number
      prompt: string
      controls: string[]
    }>(`(async () => {
      ${PRELUDE}
      await until(() => chats.getNodeSession(chats.activeTabId.value)?.messages.value.filter(m => m.role === 'assistant').length === 2);
      const presenter = chats.getNodeSession(chats.activeTabId.value);
      document.querySelector('.abele-node-chat .abele-chat-msg__icon').click(); await wait(100);
      return JSON.stringify({ users: presenter.messages.value.filter(m => m.role === 'user').map(m => m.content), replies: presenter.messages.value.filter(m => m.role === 'assistant').length, prompt: presenter.projection.value.prompts[0].choice, controls: [...document.querySelectorAll('.abele-node-chat .abele-chat-msg__branch-action')].map(e => e.textContent.trim()) })
    })()`)
    expect(final).toEqual({
      users: ['Sample permission question', 'Sample offline follow-up'],
      replies: 2,
      prompt: 'allow',
      controls: [],
    })
    for (let i = 0; i < projectPaths.length; i++) {
      evalAsync(`(async () => {
        ${PRELUDE}
        const press = text => [...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === text).click();
        const fill = (label, value) => { const field = document.querySelector('input[aria-label="' + label + '"]'); field.value = value; field.dispatchEvent(new Event('input', {bubbles:true})) };
        [...document.querySelectorAll('.abele-node-chat button')].find(b => b.textContent.trim() === 'Projects and workspaces').click();
        await until(() => document.querySelector('.abele-node-workspaces'));
        await until(() => ![...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === 'Refresh').disabled);
        const registration = [...document.querySelectorAll('.abele-node-workspaces details')].find(d => d.querySelector('summary')?.textContent === 'Register a project');
        registration.open = true;
        fill('Project path', ${JSON.stringify(projectPaths[i])});
        registration.querySelector('.checkbox-container').click();
        await wait(100); press('Register project');
        await until(() => document.querySelector('select[aria-label="Project"] option:checked')?.textContent.includes(${JSON.stringify(projectPaths[i])}));
        await until(() => ![...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === 'Create workspace').disabled);
        press('Create workspace');
        await until(() => { const selected = document.querySelector('select[aria-label="Workspace"] option:checked')?.textContent; return selected?.includes('abele/') && selected.includes('ready') });
        await until(() => ![...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === 'Start session in workspace').disabled);
        fill('Node session title', 'Sample coding task ${i + 1}');
        await wait(100); press('Start session in workspace');
        await until(() => !document.querySelector('.abele-node-workspaces') && document.querySelector('.abele-node-chat')?.textContent.includes('Claude Code'));
        const presenter = chats.getNodeSession(chats.activeTabId.value);
        const send = text => { const field = document.querySelector('.abele-node-chat textarea'); field.value = text; field.dispatchEvent(new Event('input', {bubbles:true})); field.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',shiftKey:true,bubbles:true})) };
        send(${JSON.stringify(i === 0 ? 'edit' : 'deny')});
        await until(() => presenter.projection.value.prompts.some(p => p.state === 'pending'));
        ${i === 0 ? "send('followup'); await until(() => presenter.projection.value.queuedInputs.length === 1);" : ''}
        return JSON.stringify(true)
      })()`)
      reloadPlugin()
      const result = evalAsync<{
        provider: string
        prompt: string
        diff: string
        evidenceCollapsed: boolean
      }>(`(async () => {
        ${PRELUDE}
        await until(() => chats.getNodeSession(chats.activeTabId.value)?.projection.value.prompts.some(p => p.state === 'pending'));
        const presenter = chats.getNodeSession(chats.activeTabId.value);
        await until(() => [...document.querySelectorAll('.abele-node-chat button')].some(b => b.textContent.trim() === ${JSON.stringify(i === 0 ? 'Approve' : 'Deny')} && !b.disabled));
        [...document.querySelectorAll('.abele-node-chat button')].find(b => b.textContent.trim() === ${JSON.stringify(i === 0 ? 'Approve' : 'Deny')}).click();
        await until(() => presenter.messages.value.some(m => m.content === ${JSON.stringify(i === 0 ? '**Finished:** followup' : '**Finished:** deny')}));
        [...document.querySelectorAll('.abele-node-chat button')].find(b => b.textContent.trim() === 'Projects and workspaces').click();
        await until(() => document.querySelector('.abele-node-workspaces'));
        await until(() => ![...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === 'Preview status and diff').disabled);
        [...document.querySelectorAll('.abele-node-workspaces button')].find(b => b.textContent.trim() === 'Preview status and diff').click();
        await until(() => document.querySelector('.abele-node-workspaces details[open] pre'));
        const diff = [...document.querySelectorAll('.abele-node-workspaces details[open] pre')].map(p => p.textContent).join('');
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
        const rawControls = [...document.querySelectorAll('.abele-node-chat button')].filter(b => b.textContent.trim() === 'Read stored record');
        return JSON.stringify({ provider: presenter.provider.value, prompt: presenter.projection.value.prompts[0].choice, diff, evidenceCollapsed: rawControls.length > 0 && rawControls.every(b => b.closest('details') && !b.closest('details').open) })
      })()`)
      expect(result.evidenceCollapsed).toBe(true)
      expect(result.provider).toBe('claude')
      expect(result.prompt).toBe(i === 0 ? 'allow' : 'deny')
      if (i === 0) expect(result.diff).toContain('+after')
      else expect(result.diff).toBe('No tracked changes')
      expect(readFileSync(resolve(projectPaths[i], 'sample.txt'), 'utf8')).toBe('before\n')
    }
  } finally {
    try {
      evalAsync(`(async () => {
        ${PRELUDE}
        for (const node of [...nodes.nodes.value].filter(n => n.id === ${JSON.stringify(registrationId)} || n.label === 'Sample acceptance node')) {
          for (const id of [...chats.tabOrder.value]) if (chats.getNodeSession(id)?.reference.registrationId === node.id) await chats.closeTab(id);
          nodes.remove(node.id);
        }
        app.setting.close();
        return JSON.stringify(true)
      })()`)
    } finally {
      await stop()
      rmSync(dir, { recursive: true, force: true })
      rmSync(projectsRoot, { recursive: true, force: true })
    }
  }
}, 180000)
