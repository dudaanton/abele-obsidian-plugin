/**
 * The long-lived session's controls against a real node and the live fake Claude CLI, not a
 * fixture journal: the settings change the running process, compacting draws its lines, a
 * background task shows over the composer and wakes the session, Stop ends a turn and keeps the
 * session, Stop the session ends its process, Rename renames it, and a message one session sends
 * another arrives under the sender's name.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { PAIRED_PRELUDE, startPairedNode } from './helpers/pairedNode'

targets('desktop')
let node: Awaited<ReturnType<typeof startPairedNode>>
let tab = '',
  session = ''

const UI = `${PAIRED_PRELUDE}
const presenter=()=>chats.getNodeSession(__TAB__);
const messages=()=>[...chat().querySelectorAll('.abele-chat-msg')].map(m=>m.textContent);
const said=text=>until(()=>messages().some(m=>m.includes(text)),'«'+text+'»',60000);
const pick=async title=>{await until(()=>document.querySelector('.menu'),'A menu');const item=[...document.querySelectorAll('.menu .menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim().startsWith(title));if(!item)throw Error('No menu item '+title);item.click();await wait(150)};
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);`
const run = (body: string, timeout = 120000) =>
  evalLong(`(async()=>{${UI.replace('__TAB__', JSON.stringify(tab))}${body}})()`, timeout)

beforeAll(async () => {
  node = await startPairedNode()
  session = await node.session('Sample live session')
  tab = await node.open(session, 'Sample live session')
}, 300000)
afterAll(async () => node?.close())

it('becomes a long-lived session with its settings at the composer foot once its process runs', async () => {
  const r = JSON.parse(
    await run(`
    await presenter().send('whoami');
    await said('"effort"');
    await until(()=>chat().querySelector('.abele-session-settings'),'The settings control');
    await until(()=>presenter().live.value?.context,'The context share',30000).catch(()=>{});
    return JSON.stringify({control:chat().querySelector('.abele-session-settings').getAttribute('aria-label'),live:!!presenter().live.value})`)
  )
  expect(r.live).toBe(true)
  expect(r.control).toContain('effort')
})

it('changes the running process from the menu: the mode and the model', async () => {
  const r = JSON.parse(
    await run(`
    chat().querySelector('.abele-session-settings').click();await pick('Plan');
    await until(()=>presenter().live.value?.settings.mode==='plan','The mode on the node');
    chat().querySelector('.abele-session-settings').click();await pick('Sonnet');
    await until(()=>presenter().live.value?.settings.model==='sonnet','The model on the node');
    await presenter().send('whoami');
    await said('"mode":"plan"');
    return JSON.stringify({who:messages().filter(m=>m.includes('"mode"')).at(-1)})`)
  )
  expect(r.who).toContain('"model":"sonnet"')
  expect(r.who).toContain('"mode":"plan"')
})

it('shows what runs in the background over the composer, and the line it wakes with', async () => {
  const r = JSON.parse(
    await run(`
    await presenter().send('background 4000 alpha');
    const line=await until(()=>chat().querySelector('.abele-bg-tasks'),'The background line',30000);
    const text=line.textContent.trim();
    await until(()=>!chat().querySelector('.abele-bg-tasks'),'The background line going',30000);
    await said('BG-NOTIFIED alpha');
    const woke=[...chat().querySelectorAll('.abele-session-mark__label')].map(l=>l.textContent.trim());
    return JSON.stringify({text,woke})`)
  )
  expect(r.text).toContain('1 in the background')
  expect(r.woke).toContain('Woke: Background alpha')
})

it('compacts from its dialog and draws how much it kept', async () => {
  const r = JSON.parse(
    await run(`
    chat().querySelector('.abele-session-settings').click();await pick('Compact the context');
    const modal=await until(()=>document.querySelector('.modal'),'The compact dialog');
    const focus=modal.querySelector('textarea');focus.value='the parser';focus.dispatchEvent(new Event('input',{bubbles:true}));
    button(modal,'Compact').click();
    await until(()=>[...chat().querySelectorAll('.abele-session-mark__label')].some(l=>l.textContent.includes('Compacted')),'The compacted line',60000);
    return JSON.stringify({marks:[...chat().querySelectorAll('.abele-session-mark__label')].map(l=>l.textContent.trim())})`)
  )
  expect(r.marks).toContain('Compacted · 5k → 300')
})

it('stops a turn with the square and keeps the session; Stop the session ends its process', async () => {
  const r = JSON.parse(
    await run(`
    await presenter().send('slow');
    const stop=await until(()=>chat().querySelector('.abele-chat-input__stop'),'The Stop square',30000);
    stop.click();
    await until(()=>!chat().querySelector('.abele-chat-input__stop'),'The turn ending',30000);
    const client=nodes.connection(presenter().reference.registrationId).client;
    const kept=(await client.sessionState(presenter().reference.sessionId)).process;
    chat().querySelector('[aria-label="More chat actions"]').click();await pick('Stop the session…');
    const modal=await until(()=>document.querySelector('.modal'),'The stop dialog');
    button(modal,'Stop').click();
    let ended;for(let i=0;i<200;i++){ended=(await client.sessionState(presenter().reference.sessionId)).process;if(ended==='none')break;await wait(100)}
    return JSON.stringify({kept,ended})`)
  )
  expect(r.kept).not.toBe('none')
  expect(r.ended).toBe('none')
})

it('renames the session everywhere it is named', async () => {
  const r = JSON.parse(
    await run(`
    chat().querySelector('[aria-label="More chat actions"]').click();await pick('Rename…');
    const input=await until(()=>document.querySelector('.is-being-renamed [contenteditable]'),'The tree rename field');
    input.textContent='Sample renamed session';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await until(()=>chat().dataset.sessionTitle==='Sample renamed session','The new title',30000);
    const client=nodes.connection(presenter().reference.registrationId).client;
    return JSON.stringify({node:(await client.getSession(presenter().reference.sessionId)).title})`)
  )
  expect(r.node).toBe('Sample renamed session')
})

it('shows a message another session wrote to it under that session, opening its chat', async () => {
  const other = await node.session('Sample sender session', undefined, await node.worktree())
  const r = JSON.parse(
    await run(`
    const first=presenter().reference;
    // The sender's agent calls the node's tool, as the CLI would; then back to the receiver.
    await chats.openNodeSession({...first,sessionId:${JSON.stringify(other)},title:'Sample sender session'});
    const sender=chats.getNodeSession('node:'+first.registrationId+':'+${JSON.stringify(other)});
    await sender.send('mcp node_session_send '+JSON.stringify({session_id:first.sessionId,text:'Sample result from the sender'}));
    await chats.openNodeSession(first);
    const from=await until(()=>chat().querySelector('.abele-chat-msg__from'),'The sender line',90000);
    const text=from.textContent.trim();
    from.click();
    await until(()=>chats.activeTabId.value?.endsWith(${JSON.stringify(other)}),'The sender chat opening',30000);
    return JSON.stringify({text})`)
  )
  expect(r.text).toContain('Sample sender session')
})
