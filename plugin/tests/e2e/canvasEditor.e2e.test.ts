import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, typeText, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample human canvas'
const SHOTS = shotDir('canvas-editor')
const PRELUDE = `
  const path = ${JSON.stringify(`${DIR}/Sample diagram.canvas`)}
  const view = () => app.workspace.getLeavesOfType('abele-canvas').find(leaf => leaf.view.file?.path === path)?.view
  const read = async () => JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
  const button = label => view()?.contentEl.querySelector('[aria-label="'+label+'"]')
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE} return JSON.stringify(await (async () => { ${body} })()) })()`
  )
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 10_000 }).toBe(true)
}
// Direct driver touches avoid an in-page HTTP request being cancelled when a native mobile
// prompt closes. No touch is retried. Desktop down/up still hold the shared native-input lock.
const press = async (expression: string, corner = false) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();
    if(!r.width||!r.height||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return null;
    return [Math.round(r.left+${corner ? '10' : 'r.width/2'}),Math.round(r.top+${corner ? '10' : 'r.height/2'})]`
  await expect.poll(() => run<number[] | null>(geometry), { timeout: 10_000 }).not.toBeNull()
  const [x, y] = run<number[]>(geometry)
  if (onPhone()) tap(x, y)
  else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:${x},y:${y},button:'left',buttons:1,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${x},y:${y},button:'left',buttons:0,clickCount:1})}
    finally {if(owned)cdp.detach()}return true
  `)
    )
}
const click = (label: string) => press(`button(${JSON.stringify(label)})`)
const type = async (text: string) => {
  if (onPhone()) typeText(text)
  else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {await cdp.sendCommand('Input.insertText',{text:${JSON.stringify(text)}})}finally {if(owned)cdp.detach()}return true
  `)
    )
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
const textButton = (root: string, text: string) =>
  `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(el=>el.textContent===${JSON.stringify(text)})`
const saved = () =>
  until(
    "view()?.documentLease && !view().documentLease.document.session.dirty && !button('Add text card').disabled"
  )
const restoreProcess = () =>
  run(
    'app.vault.process=window.__humanCanvas.process;delete window.__humanCanvas.process;return true'
  )
const failSave = () =>
  run(`
  window.__humanCanvas.process=app.vault.process
  app.vault.process=async function(file,fn){if(file.path===path)throw Error('Sample known-unwritten save failure');return window.__humanCanvas.process.call(this,file,fn)}
  return true
`)
const addText = async (text: string) => {
  await click('Add text card')
  await press('view().contentEl.querySelector("textarea")')
  await type(text)
  await click('Save text')
}
const reopen = async () => {
  run(
    `const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true`
  )
  await until('view()?.editor')
}

describe.skipIf(!available)('human canvas creation and editing with real input', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__humanCanvas={layout:app.workspace.getLayout(),preference:window.__abeleTest.AbeleConfig.getInstance().canvasViewer,location:app.vault.getConfig('newFileLocation')}
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer=true
      app.vault.setConfig('newFileLocation','current')
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__humanCanvas.owned=true
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},'A note inserted by a person.')
      const leaf=app.workspace.getLeaf('tab');await leaf.openFile(note);await app.workspace.revealLeaf(leaf);return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const fixture=window.__humanCanvas
      if(fixture?.process)app.vault.process=fixture.process
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      const leaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(leaf)})
      for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
      if(fixture?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(fixture){window.__abeleTest.AbeleConfig.getInstance().canvasViewer=fixture.preference;app.vault.setConfig('newFileLocation',fixture.location);await app.workspace.changeLayout(fixture.layout)}
      delete window.__humanCanvas;return true
    `)
  }, 120_000)

  it('creates an empty canvas from the palette and completes a card with keyboard input', async () => {
    // Navigation opens the palette; creation itself is chosen with real input.
    run("app.commands.executeCommandById('command-palette:open');return true")
    await press('document.querySelector(".prompt-input")')
    await type('New canvas')
    shot('creation-palette')
    const command =
      '[...document.querySelectorAll(".suggestion-item")].find(el=>/Abele.*New canvas/i.test(el.textContent))'
    await until(command)
    await press(command)
    await press('document.querySelector(\'[aria-label="Canvas name"]\')')
    await type('Sample diagram')
    await press(textButton('.abele-canvas-input', 'Create'))
    await until('view()?.editor')
    const empty = run<boolean>('return (await read()).nodes.length===0')
    await click('Add text card')
    const focused = run<boolean>(
      'return document.activeElement===view().contentEl.querySelector("textarea")'
    )
    await press('view().contentEl.querySelector("textarea")')
    await type('Human concept')
    shot('text-keyboard')
    await click('Save text')
    await saved()
    const result = run<{ text: string; undo: number }>(
      'return {text:(await read()).nodes[0].text,undo:view().documentLease.document.session.history.undo}'
    )
    expect({ ...result, focused, empty }).toEqual({
      text: 'Human concept',
      undo: 1,
      focused: true,
      empty: true,
    })
  }, 120_000)

  it('inserts a note through the native picker, selects a card by pointer, and deletes/undoes/redoes', async () => {
    await click('Add note or attachment')
    await press('document.querySelector(".prompt-input")')
    await type('sample-note')
    await press(
      `[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(${JSON.stringify(DIR + '/sample-note.md')}))`
    )
    await saved()
    await until('view().viewer.graph.nodes.length===2')
    const note = run<string>("return (await read()).nodes.find(node=>node.type==='file').file")
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='file').id+'"]')`
    )
    const selected = run<boolean>(
      "return !button('Open selected card').disabled && button('Edit card text').disabled"
    )
    await click('Delete selected card')
    await saved()
    const deleted = run<boolean>('return (await read()).nodes.length===1')
    await click('Undo canvas change')
    await saved()
    const restored = run<boolean>(
      `return (await read()).nodes.some(node=>node.file===${JSON.stringify(note)})`
    )
    await click('Redo canvas change')
    await saved()
    const redone = run<boolean>('return (await read()).nodes.length===1')
    await click('Undo canvas change')
    await saved()
    shot('cards-history')
    expect({ note, selected, deleted, restored, redone }).toEqual({
      note: `${DIR}/sample-note.md`,
      selected: true,
      deleted: true,
      restored: true,
      redone: true,
    })
  }, 120_000)

  it('edits selected canvas text without editing the inserted note and adds a web link', async () => {
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='text').id+'"]')`,
      true
    )
    await click('Edit card text')
    await press('view().contentEl.querySelector("textarea")')
    await type(' revised')
    await click('Save text')
    await saved()
    const text = run<string>("return (await read()).nodes.find(node=>node.type==='text').text")
    const note = run<string>(
      `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-note.md')}))`
    )
    await click('Add link')
    await press('document.querySelector(\'[aria-label="Web address"]\')')
    await type('https://sample.example/diagram')
    await press(textButton('.abele-canvas-input', 'Create'))
    await saved()
    const link = run<string>("return (await read()).nodes.find(node=>node.type==='link').url")
    expect(text).toContain('Human concept')
    expect(text).toContain('revised')
    expect(note).toBe('A note inserted by a person.')
    expect(link).toBe('https://sample.example/diagram')
  }, 120_000)

  it('retries a known-unwritten human save on the same source and reopens saved content', async () => {
    failSave()
    await addText('Retryable human text')
    await until("button('Retry save')&&!button('Retry save').disabled")
    const pending = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Retryable human text')&&view().contentEl.textContent.includes('not saved')"
    )
    restoreProcess()
    await click('Retry save')
    await saved()
    const written = run<boolean>(
      "return (await read()).nodes.some(node=>node.text==='Retryable human text')"
    )
    run('view().leaf.detach();return true')
    await reopen()
    const reopened = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Retryable human text')"
    )
    expect({ pending, saved: written, reopened }).toEqual({
      pending: true,
      saved: true,
      reopened: true,
    })
  }, 120_000)

  // BUG: native Canvas rewrites only JSON whitespace on unload. The strict byte revision
  // correctly blocks a retained draft's retry, even without a semantic native edit. Do not
  // cancel native saves or acknowledge matching content to make this guarantee pass.
  it.fails(
    'keeps a failed human save visible, asks before native handoff, and reopens retained text for retry',
    async () => {
      const before = run<string>(
        'return await app.vault.read(app.vault.getAbstractFileByPath(path))'
      )
      failSave()
      await addText('Retained human text')
      await until("button('Retry save')&&!button('Retry save').disabled")
      const unsaved = run<boolean>(
        "return view().contentEl.textContent.includes('not saved')&&view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
      )
      const sourceSame = run<boolean>(
        `return ${JSON.stringify(before)}===await app.vault.read(app.vault.getAbstractFileByPath(path))`
      )
      shot('failed-save')
      await press('view().containerEl.querySelector(\'[aria-label="Open in Obsidian Canvas"]\')')
      await until("document.querySelector('.abele-canvas-choice')")
      shot('native-handoff')
      await press(textButton('.abele-canvas-choice', 'Retain draft and open native'))
      await until("app.workspace.getLeavesOfType('canvas').some(leaf=>leaf.view.file?.path===path)")
      const native = true
      restoreProcess()
      // Closing/reopening is navigation, not a canvas edit. Native unload may write formatting.
      run(
        "app.workspace.getLeavesOfType('canvas').find(leaf=>leaf.view.file?.path===path).detach();return true"
      )
      await reopen()
      const retained = run<boolean>(
        "return view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
      )
      const reopened = run<boolean>("return !button('Retry save').disabled")
      await click('Retry save')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const written = run<boolean>(
        "return (await read()).nodes.some(node=>node.text==='Retained human text')"
      )
      shot('reopened-saved')
      expect({ unsaved, sourceSame, retained, native, reopened, saved: written }).toEqual({
        unsaved: true,
        sourceSame: true,
        retained: true,
        native: true,
        reopened: true,
        saved: true,
      })
    },
    120_000
  )

  it('honestly blocks a changed-source draft after native handoff and discards only local pending work', async () => {
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    const retained = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
    )
    const blocked = run<boolean>(
      "return button('Retry save').disabled&&view().contentEl.textContent.includes('source changed')"
    )
    await click('Discard local draft')
    await press(textButton('.abele-canvas-choice', 'Discard local draft'))
    await saved()
    const sourceSame = run<boolean>(
      `return ${JSON.stringify(before)}===await app.vault.read(app.vault.getAbstractFileByPath(path))`
    )
    const discarded = run<boolean>(
      "return !view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
    )
    expect({ retained, blocked, sourceSame, discarded }).toEqual({
      retained: true,
      blocked: true,
      sourceSame: true,
      discarded: true,
    })
  }, 120_000)
})
