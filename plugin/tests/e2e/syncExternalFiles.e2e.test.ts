import { expect, it } from 'vitest'
import { join } from 'node:path'
import { liveSuite } from './helpers/syncLiveCases'
import { captureSyncScreen } from './helpers/syncScreens'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { targets, onPhone } from './helpers/target'
import type { SyncDriver } from './helpers/syncDriver'

targets('desktop', 'phone')
const fixture = liveSuite(false)
const card = '.workspace-leaf.mod-active .abele-external-view'
const embed = '.workspace-leaf.mod-active .markdown-reading-view .abele-external-embed'
const editorEmbed = '.workspace-leaf.mod-active .markdown-source-view .abele-external-embed'

async function shot(a: SyncDriver, state: string, selector: string): Promise<void> {
  const name = 'external-' + state + (onPhone() ? '-phone' : '-desktop')
  a.run(
    `await poll(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||!el.checkVisibility())return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true`
  )
  if (onPhone()) screenshot(join(shotDir('abele-token-screens'), name + '.png'))
  else {
    const screen = await captureSyncScreen(a, name, selector)
    expect(screen.error).toBe('')
    expect(screen.shot).toContain(name + '.png')
    expect(screen.over).toEqual([])
  }
}

async function openCard(a: SyncDriver, path: string): Promise<void> {
  await a.long(
    'open external file through native link routing',
    `await closeSettings();await app.workspace.openLinkText(${JSON.stringify(path)},'',false);await poll(()=>document.querySelector(${JSON.stringify(card)}));return true`
  )
}

async function openNote(a: SyncDriver, path: string, mode = 'preview'): Promise<void> {
  const selector = mode === 'preview' ? embed : editorEmbed
  await a.long(
    'open note with an offloaded embed',
    `await closeSettings();await app.workspace.getLeaf(false).setViewState({type:'markdown',active:true,state:{file:${JSON.stringify(path)},mode:${JSON.stringify(mode)},source:false}});await poll(()=>document.querySelector(${JSON.stringify(selector)}));return true`
  )
}

it('offloads real synced attachments and opens cards separately from downloading on desktop and phone', async () => {
  const s = fixture(),
    a = s.primary
  const id = await s.connect()
  const image = s.root + '/sample-image.png',
    video = s.root + '/sample-video.mp4'
  const other = s.root + '/sample-document.pdf',
    note = s.root + '/sample-embeds.md'
  a.create(note, `# Sample attachments\n\n![[${image}]]\n\n![[${other}]]\n`)
  // Generate a fresh image locally; no personal attachments or external image requests.
  a.run(
    `const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#8ecae6';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ffcf56';ctx.beginPath();ctx.arc(250,40,23,0,Math.PI*2);ctx.fill();ctx.fillStyle='#28734b';ctx.beginPath();ctx.moveTo(0,180);ctx.lineTo(100,50);ctx.lineTo(200,180);ctx.fill();ctx.fillStyle='#164630';ctx.beginPath();ctx.moveTo(120,180);ctx.lineTo(220,75);ctx.lineTo(320,180);ctx.fill();const data=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));await app.vault.createBinary(${JSON.stringify(image)},data.buffer);return true`
  )
  a.create(video, 'sample video fixture bytes')
  a.create(other, 'sample document fixture bytes')
  await a.syncNow(id)
  expect(
    (await s.items()).filter((one) => [image, video, other, note].includes(one.path))
  ).toHaveLength(4)
  for (const path of [image, video, other]) {
    const result = await a.long<{ status: string }>(
      'offload verified server file',
      `return await host.evict(${JSON.stringify(id)},${JSON.stringify(path)})`
    )
    expect(result.status).toBe('complete')
    expect(a.exists(path)).toBe(false)
    expect(a.exists(path + '.abele-ref')).toBe(true)
  }
  for (const [path, state] of [
    [other, 'card-ordinary'],
    [video, 'card-video'],
    [image, 'card-image-preview'],
  ]) {
    await openCard(a, path)
    const text = a.run<string>(`return textOf(document.querySelector(${JSON.stringify(card)}))`)
    expect(text).toContain(path.split('/').at(-1))
    expect(text).toContain('On the server since')
    expect(text).toContain(path.split('.').at(-1)!.toUpperCase())
    if (path === image)
      expect(a.run(`return !!document.querySelector(${JSON.stringify(card + ' img')})`)).toBe(true)
    await shot(a, state, card)
    expect(a.exists(path)).toBe(false)
  }
  await openNote(a, note)
  a.run(`await poll(()=>document.querySelector(${JSON.stringify(embed + ' img')}));return true`)
  await shot(a, 'embed-reading', embed)
  const before = a.run(`return app.workspace.getActiveFile()?.path`)
  a.run(`document.querySelector(${JSON.stringify(embed + ' img')}).click();return true`)
  expect(a.run(`return app.workspace.getActiveFile()?.path`)).toBe(before)
  expect(a.exists(image)).toBe(false)
  // The ordinary row opens its card; the preview remains inert.
  a.run(
    `document.querySelector(${JSON.stringify(embed + '_card')}).click();await poll(()=>document.querySelector(${JSON.stringify(card)}));return true`
  )
  expect(a.exists(other)).toBe(false)
  await shot(a, 'card-from-embed', card)
  await openNote(a, note, 'source')
  await shot(a, 'embed-editor', editorEmbed)
  await openNote(a, note)
  // SIGSTOP preserves the live request long enough to photograph real transfer state.
  s.server.suspend()
  try {
    a.run(
      `document.querySelector(${JSON.stringify(embed + '__plate')}).click();await poll(()=>document.querySelector(${JSON.stringify(embed + '__bar')}));return true`
    )
    await shot(a, 'embed-downloading', embed)
    expect(a.exists(image)).toBe(false)
  } finally {
    s.server.resume()
  }
  await a.long(
    'download from embed cloud icon',
    `await poll(()=>!!app.vault.getFileByPath(${JSON.stringify(image)}));await poll(()=>!document.querySelector(${JSON.stringify(embed + '_image')}));return true`
  )
  expect(a.exists(image)).toBe(true)
  expect(a.exists(image + '.abele-ref')).toBe(false)
  expect(a.read(note)).toBe(`# Sample attachments\n\n![[${image}]]\n\n![[${other}]]\n`)
  await shot(a, 'embed-local', '.workspace-leaf.mod-active .markdown-preview-view')
  await openCard(a, other)
  s.server.suspend()
  try {
    a.run(
      `await press(document.querySelector(${JSON.stringify(card)}),'Download');await poll(()=>document.querySelector(${JSON.stringify(card + '__progress')}));return true`
    )
    await shot(a, 'card-downloading', card)
    expect(a.exists(other)).toBe(false)
  } finally {
    s.server.resume()
  }
  await a.long(
    'card download becomes local',
    `await poll(()=>!!app.vault.getFileByPath(${JSON.stringify(other)}));return true`
  )
  expect(a.read(other)).toBe('sample document fixture bytes')
}, 180000)

it('retains offloaded stubs when the real server is offline and shows a newer server version', async () => {
  const s = fixture(),
    a = s.primary,
    path = s.root + '/sample-remote.bin'
  await s.put(path, 'sample original bytes')
  const id = await s.connect()
  expect(
    (
      await a.long<{ status: string }>(
        'offload',
        `return await host.evict(${JSON.stringify(id)},${JSON.stringify(path)})`
      )
    ).status
  ).toBe('complete')
  const note = s.root + '/sample-offline.md'
  a.create(note, `![[${path}]]`)
  await a.syncNow(id)
  a.run('window.__abeleTest.setNativeSyncTimeout(5000);return true')
  s.server.suspend()
  try {
    await expect(a.syncNow(id)).rejects.toThrow()
    await openCard(a, path)
    expect(a.run(`return textOf(document.querySelector(${JSON.stringify(card)}))`)).toContain(
      'Not available offline'
    )
    expect(
      a.run(
        `return [...document.querySelector(${JSON.stringify(card)}).querySelectorAll('button')].every(button=>button.disabled)`
      )
    ).toBe(true)
    await shot(a, 'card-offline', card)
    await openNote(a, note)
    expect(
      a.run(`return !!document.querySelector(${JSON.stringify(embed + ' svg.lucide-cloud-off')})`)
    ).toBe(true)
    await shot(a, 'embed-offline', embed)
    expect(a.exists(path)).toBe(false)
  } finally {
    s.server.resume()
    a.run('window.__abeleTest.setNativeSyncTimeout(null);return true')
  }
  await s.put(path, 'sample newer server bytes')
  await a.syncNow(id)
  await openCard(a, path)
  expect(a.run(`return textOf(document.querySelector(${JSON.stringify(card)}))`)).toContain(
    'A newer version is on the server'
  )
  await shot(a, 'card-newer', card)
  expect(a.exists(path)).toBe(false)
  a.run(`await press(document.querySelector(${JSON.stringify(card)}),'Download');return true`)
  await a.long(
    'download newer version',
    `await poll(()=>!!app.vault.getFileByPath(${JSON.stringify(path)}));return true`
  )
  expect(a.read(path)).toBe('sample newer server bytes')
}, 180000)
