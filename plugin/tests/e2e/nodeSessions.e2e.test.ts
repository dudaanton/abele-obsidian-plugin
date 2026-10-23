/**
 * A long-lived node session in its real chat tab, on invented data and no node: the settings
 * control at the composer's foot, Stop while anything runs, the background line, compacting and
 * waking lines, a message from another session, the ⋯ menu's Rename… and Stop the session…, the
 * compact dialog and the «/» list. Each state is measured on a real screen and pictured, and a
 * press is checked to reach the node.
 */
import { afterAll, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { NODE_PANEL, NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop', 'phone')
const shots = shotDir('abele-node-sessions')

const PRELUDE = `
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what) => { for (let i = 0; i < 200; i++) { const v = fn(); if (v) return v; await wait(50) } throw Error(what + ' did not show') };
const shot = async (name) => {
  const path = ${JSON.stringify(shots)} + '/' + name + '.png';
  if (window.__e2eHost) { const r = await window.__e2eHost.shot(path); if (String(r).startsWith('no picture:')) throw Error(r); return r }
  require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
  return 'saved';
};
const escape = async () => { for (let i = 0; i < 3 && document.querySelector('.menu, .modal'); i++) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); await wait(150) } };
const chat = () => document.querySelector('.abele-node-chat');
const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } };
const outside = root => [...root.querySelectorAll('button,[role="button"],textarea,.clickable-icon')].flatMap(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1) ? [el.getAttribute('aria-label') || el.className] : [] });
const menuTitles = () => [...document.querySelectorAll('.menu .menu-item')].map(i => ({ title: i.querySelector('.menu-item-title')?.textContent.trim(), disabled: i.classList.contains('is-disabled') }));
const pick = async title => { const item = [...document.querySelectorAll('.menu .menu-item')].find(i => i.querySelector('.menu-item-title')?.textContent.trim().startsWith(title)); if (!item) throw Error('No menu item ' + title); item.click(); await wait(200) };
const open = async (state, bypass = true) => {
  await window.__abeleTest.openNodeSessionFixture(state, bypass);
  return until(() => chat()?.querySelector('.abele-session-settings') && chat(), 'The session chat');
};
`

const run = async <T>(body: string): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => { ${PRELUDE}
  try { ${body} } finally { await escape(); await window.__abeleTest.closeNodeSessionFixture() }
})()`,
      90000
    )
  ) as T

afterAll(async () => {
  await evalLong('window.__abeleTest.closeNodeSessionFixture().then(() => "1")', 30000)
})

it('shows one quiet near-limit notice across several node turns', async () => {
  const result = await run<{ copies: number; replies: number; iso: boolean; outside: string[] }>(`
    const root = await open('rate-limit');
    await wait(350);
    const scroll = root.querySelector('.abele-ai-chat__messages');
    scroll.scrollTop = 0;
    await wait(150);
    await shot('node-rate-limit-several-turns');
    const text = root.textContent;
    return JSON.stringify({
      copies: text.split('Usage limit close').length - 1,
      replies: [1, 2, 3].filter(n => text.includes('Sample ' + n + ' checked.')).length,
      iso: text.includes('T18:00:00.000Z'),
      outside: outside(root)
    });
  `)
  expect(result.copies).toBe(1)
  expect(result.replies).toBe(3)
  expect(result.iso).toBe(false)
  expect(result.outside).toEqual([])
})

it('shows shared agent work, commands, unavailable agents and permission questions like the regular chat', async () => {
  const r = await run<{
    outside: string[]
    plan: boolean
    commands: string
    picker: string
    permission: boolean
  }>(`
    const root = await open('agent');
    await wait(350);
    const overflow = outside(root);
    const plan = !!root.querySelector('.abele-session-plan');
    await shot('node-agent-chat');
    const input = root.querySelector('textarea');
    input.value = '/'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(250);
    const commands = root.textContent;
    await shot('node-agent-commands');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    await window.__abeleTest.closeNodeSessionFixture();
    await window.__abeleTest.openRegularChatFixture();
    await wait(350); await shot('node-agent-regular-comparison');
    await window.__abeleTest.closeRegularChatFixture();
    const asking = await open('agent-asking');
    asking.querySelector('.abele-ai-chat__messages').scrollTop = 1e6;
    await wait(250); await shot('node-agent-permission');
    overflow.push(...outside(asking));
    const permission = [...asking.querySelectorAll('button')].some(b => b.textContent.trim() === 'Approve');
    await window.__abeleTest.openAgentPickerFixture();
    await wait(250);
    const picker = document.querySelector('.prompt')?.textContent ?? document.querySelector('.modal-container')?.textContent ?? '';
    await shot('node-agent-picker');
    window.__abeleTest.closeAgentPickerFixture();
    return JSON.stringify({ outside: overflow, plan, commands, picker, permission });
  `)
  expect(r.outside).toEqual([])
  expect(r.plan).toBe(true)
  expect(r.commands).toContain('review')
  expect(r.picker).toContain('Codex')
  expect(r.picker).toContain('pi')
  expect(r.picker).toContain('OpenCode')
  expect(r.permission).toBe(true)
})

it.each(['idle', 'working', 'compacting', 'asking'])(
  'the %s session fits a real screen, its controls apart, Stop there while anything runs',
  async (state) => {
    const r = await run<{
      outside: string[]
      stop: boolean
      settings: string
      background: string
      overlaps: string[]
      marks: string[]
      from: string
      shot: string
    }>(`
    const root = await open(${JSON.stringify(state)});
    await wait(400);
    const settings = root.querySelector('.abele-session-settings');
    const toolbar = settings.closest('.abele-chat-input__toolbar');
    // Every control in the composer's foot stands apart from its neighbours.
    const controls = [...toolbar.querySelectorAll('.clickable-icon, .abele-session-settings')].filter(el => el.getBoundingClientRect().width);
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = box(controls[i]), b = box(controls[j]);
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push((controls[i].getAttribute('aria-label') || controls[i].className) + ' × ' + (controls[j].getAttribute('aria-label') || controls[j].className));
    }
    const result = {
      outside: outside(root),
      stop: !!root.querySelector('.abele-chat-input__stop'),
      settings: settings.textContent.trim(),
      background: root.querySelector('.abele-bg-tasks')?.textContent.trim() ?? '',
      overlaps,
      marks: [...root.querySelectorAll('.abele-session-mark__label')].map(m => m.textContent.trim()),
      from: root.querySelector('.abele-chat-msg__from')?.textContent.trim() ?? '',
    };
    root.querySelector('.abele-ai-chat__messages').scrollTop = 1e6;
    await wait(200);
    result.shot = await shot('node-sessions-' + ${JSON.stringify(state)});
    return JSON.stringify(result);`)
    expect(r.outside).toEqual([])
    expect(r.overlaps).toEqual([])
    expect(r.stop).toBe(state !== 'idle')
    expect(r.settings).toContain(state === 'working' ? '86%' : '41%')
    expect(r.background).toEqual(
      state === 'idle' ? '' : expect.stringContaining('3 in the background')
    )
    expect(r.marks).toEqual(
      expect.arrayContaining(['Compacted · 812k → 64k', 'Woke: npm test finished · 12 passed'])
    )
    if (state === 'compacting') expect(r.marks).toContain('Compacting…')
    expect(r.from).toContain('Review the search diff')
  },
  120000
)

it('shows a new session as an empty chat with its controls, nothing over the composer', async () => {
  const r = await run<{
    messages: number
    background: boolean
    older: boolean
    outside: string[]
  }>(`
    const root = await open('empty');
    await wait(400);
    const result = { messages: root.querySelectorAll('.abele-chat-msg').length, background: !!root.querySelector('.abele-bg-tasks'), older: !!root.querySelector('.abele-node-chat__older'), outside: outside(root) };
    await shot('node-sessions-empty');
    return JSON.stringify(result);`)
  expect(r).toEqual({ messages: 0, background: false, older: false, outside: [] })
})

it('opens a long session at its end and reads the earlier page from the node when scrolled to its top', async () => {
  const r = await run<{
    last: boolean
    before: number
    after: number
    reads: number
    kept: boolean
  }>(`
    const root = await open('long');
    const list = root.querySelector('.abele-ai-chat__messages');
    await until(() => [...root.querySelectorAll('.abele-chat-msg')].some(m => m.textContent.includes('Answer 120.')), 'The latest answer');
    await wait(300);
    const last = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    await shot('node-sessions-long');
    const before = root.querySelectorAll('.abele-chat-msg').length;
    list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
    await until(() => root.querySelectorAll('.abele-chat-msg').length > before, 'The earlier page');
    await wait(300);
    const kept = list.scrollTop > 0;
    await shot('node-sessions-long-earlier');
    return JSON.stringify({ last, before, after: root.querySelectorAll('.abele-chat-msg').length, reads: window.__abeleTest.nodeSessionCalls.filter(c => c.method === 'stream.read').length, kept });`)
  expect(r.last).toBe(true)
  expect(r.after).toBeGreaterThan(r.before)
  expect(r.reads).toBeGreaterThanOrEqual(1)
  expect(r.kept).toBe(true)
})

it('says plainly when earlier messages cannot be read and when compacting failed, with a way to try again', async () => {
  const r = await run<{
    line: string
    retry: boolean
    failed: string
    banner: boolean
    outside: string[]
  }>(`
    const root = await open('error');
    const list = root.querySelector('.abele-ai-chat__messages');
    await until(() => [...root.querySelectorAll('.abele-chat-msg')].some(m => m.textContent.includes('Answer 120.')), 'The latest answer');
    list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
    const line = await until(() => root.querySelector('.abele-node-chat__older')?.textContent.includes('Could not read') && root.querySelector('.abele-node-chat__older'), 'The failure line');
    const failed = [...root.querySelectorAll('[role="alert"]')].map(a => a.textContent.trim()).join(' | ');
    await shot('node-sessions-error-earlier');
    list.scrollTop = list.scrollHeight;
    await wait(300);
    await shot('node-sessions-error');
    return JSON.stringify({ line: line.textContent.trim(), retry: !!line.querySelector('button'), failed, banner: !!root.querySelector(':scope > .abele-ai-chat__error'), outside: outside(root) });`)
  expect(r.line).toContain('Could not read earlier messages')
  expect(r.retry).toBe(true)
  expect(r.failed).toContain('Compacting failed: the context could not be shortened')
  // Said once, on its line: no error banner over the talk repeats it.
  expect(r.banner).toBe(false)
  expect(r.outside).toEqual([])
})

it('opens the background line to the tasks with how long each runs', async () => {
  const r = await run<{ rows: string[]; shot: string }>(`
    const root = await open('working');
    root.querySelector('.abele-bg-tasks .tree-item-self').click();
    await until(() => root.querySelectorAll('.abele-bg-tasks__task').length === 3, 'The task rows');
    await wait(200);
    return JSON.stringify({
      rows: [...root.querySelectorAll('.abele-bg-tasks__task')].map(t => t.textContent.trim()),
      shot: await shot('node-sessions-background-open'),
    });`)
  expect(r.rows.join('|')).toContain('npm test -- --watch')
  expect(r.rows.join('|')).toContain('Check the ranking on a big vault')
})

it('sets the session from its control, bypass off where the node forbids it', async () => {
  const r = await run<{
    titles: { title: string; disabled: boolean }[]
    sent: { method: string; params: unknown[] }[]
    forbidden: { title: string; disabled: boolean }[]
    shot: string
  }>(`
    let root = await open('working');
    root.querySelector('.abele-session-settings').click();
    await until(() => document.querySelector('.menu'), 'The settings menu');
    await wait(300);
    const titles = menuTitles();
    const picture = await shot('node-sessions-settings-menu');
    await pick('Plan');
    const sent = window.__abeleTest.nodeSessionCalls.map(c => ({ method: c.method, params: c.params }));
    await escape();
    root = await open('idle', false);
    root.querySelector('.abele-session-settings').click();
    await until(() => document.querySelector('.menu'), 'The settings menu');
    const forbidden = menuTitles().filter(t => t.title?.startsWith('Bypass'));
    return JSON.stringify({ titles, sent, forbidden, shot: picture });`)
  const titles = r.titles.map((t) => t.title)
  expect(titles[0]).toMatch(/^Compact the context… · 862k of 1M/)
  for (const t of ['Model', 'Effort', 'Account', 'Permissions', 'Ask every time', 'Bypass'])
    expect(titles).toContain(t)
  expect(r.sent).toContainEqual({
    method: 'session.configure',
    params: ['sample-live-session', { permission_mode: 'plan' }],
  })
  expect(r.forbidden).toEqual([{ title: 'Bypass · turned off on this node', disabled: true }])
})

it('compacts from «/compact» with a focus, and the session commands lead the «/» list', async () => {
  const r = await run<{ list: string[]; sent: { method: string; params: unknown[] }[] }>(`
    const root = await open('idle');
    const field = root.querySelector('.abele-chat-input textarea, .abele-chat-input [contenteditable]');
    field.focus();
    if (field.tagName === 'TEXTAREA') { field.value = '/'; field.dispatchEvent(new Event('input', { bubbles: true })) }
    else document.execCommand('insertText', false, '/');
    await until(() => document.querySelector('.abele-chat-slash .suggestion-item'), 'The «/» list');
    await wait(200);
    const list = [...document.querySelectorAll('.abele-chat-slash .suggestion-item')].map(i => i.textContent.trim());
    await shot('node-sessions-slash');
    // The list takes a press as Obsidian's suggestions do, on the pointer going down.
    document.querySelector('.abele-chat-slash .suggestion-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const modal = await until(() => document.querySelector('.modal'), 'The compact dialog');
    const focus = modal.querySelector('textarea');
    focus.value = 'the title search';
    focus.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    await shot('node-sessions-compact');
    [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compact').click();
    await wait(300);
    return JSON.stringify({ list, sent: window.__abeleTest.nodeSessionCalls.map(c => ({ method: c.method, params: c.params })) });`)
  expect(r.list[0]).toContain('/compact')
  expect(r.list.join('|')).toContain('/rename')
  expect(r.list.join('|')).not.toContain('/load')
  expect(r.sent).toContainEqual({
    method: 'session.compact',
    params: ['sample-live-session', { focus: 'the title search', continue: true }],
  })
})

it('stops the whole session from ⋯ after saying what stops, and renames it', async () => {
  const r = await run<{ said: string; sent: { method: string; params: unknown[] }[] }>(`
    const root = await open('working');
    root.querySelector('[aria-label="More chat actions"]').click();
    await until(() => document.querySelector('.menu'), 'The session menu');
    await pick('Stop the session…');
    const modal = await until(() => document.querySelector('.modal'), 'The stop dialog');
    await wait(200);
    const said = modal.textContent;
    await shot('node-sessions-stop-confirm');
    [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Stop').click();
    await wait(300);
    root.querySelector('[aria-label="More chat actions"]').click();
    await until(() => document.querySelector('.menu'), 'The session menu');
    await pick('Rename…');
    const input = await until(() => document.querySelector('.is-being-renamed [contenteditable]'), 'The tree rename field');
    input.textContent = 'Search by words and titles';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    await shot('node-sessions-rename');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(300);
    return JSON.stringify({ said, sent: window.__abeleTest.nodeSessionCalls.map(c => ({ method: c.method, params: c.params })) });`)
  expect(r.said).toContain('3 tasks running in the background')
  expect(r.sent).toContainEqual({ method: 'session.stop', params: ['sample-live-session'] })
  expect(r.sent).toContainEqual({
    method: 'session.rename',
    params: ['sample-live-session', 'Search by words and titles'],
  })
})

it('lists the sessions at a place in the panel, the waiting one counted in orange on its mode', async () => {
  const r = JSON.parse(
    await evalLong(
      `(async () => { ${PRELUDE}
    ${NODE_PANEL_FIXTURE}
    try {
      nodePanel.variant.waiting = true;
      const panel = await nodePanel.open('feature');
      const tab = [...panel.querySelectorAll('.abele-node-modes [role="tab"]')].find(t => t.getAttribute('aria-label').startsWith('Sessions'));
      await nodePanel.mode('Sessions');
      const row = panel.querySelector('.abele-session-row');
      const result = {
        tab: tab.getAttribute('aria-label'),
        count: tab.textContent.trim(),
        orange: getComputedStyle(tab.querySelector('.abele-obsidian-icon__text')).color,
        row: row.textContent.trim(),
        dot: !!row.querySelector('.abele-session-row__dot *'),
        shield: !!row.querySelector('.abele-session-row__codes .abele-obsidian-icon'),
        outside: outside(panel),
      };
      result.shot = await shot('node-sessions-panel');
      return JSON.stringify(result);
    } finally { await nodePanel.close() }
  })()`,
      90000
    )
  ) as {
    tab: string
    count: string
    orange: string
    row: string
    dot: boolean
    shield: boolean
    outside: string[]
  }
  expect(r.tab).toBe('Sessions: 1 waiting for you of 1')
  expect(r.count).toBe('1')
  expect(r.row).toContain(NODE_PANEL.chat)
  expect(r.dot).toBe(true)
  expect(r.shield).toBe(true)
  expect(r.outside).toEqual([])
}, 120000)
