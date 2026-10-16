/**
 * Excalidraw drawings made into canvases in the running app: one drawing through its command,
 * then the whole vault through the confirmation and the report, on a computer and on a phone.
 * The drawings are invented here and removed after; pictures of both dialogs go to the batch's
 * shot folder for a person to look at.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('excalidraw-migration')
const DIR = 'ExcalidrawMigrationSample'

const common = {
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  roundness: null,
  isDeleted: false,
  locked: false,
  link: null,
}
const scene = (elements: Record<string, unknown>[]) =>
  JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files: {} })

const NOTE_DRAWING = [
  '---',
  'excalidraw-plugin: parsed',
  '---',
  '# Excalidraw Data',
  '## Text Elements',
  'Sample start ^start-text',
  '',
  '## Embedded Files',
  'pic-id: [[sample-dot.png]]',
  '',
  '%%',
  '## Drawing',
  '```json',
  scene([
    {
      ...common,
      id: 'frame-one',
      type: 'frame',
      x: -40,
      y: -40,
      width: 560,
      height: 360,
      name: 'Sample frame',
    },
    {
      ...common,
      id: 'start',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 140,
      height: 70,
      strokeColor: '#1971c2',
    },
    {
      ...common,
      id: 'start-text',
      type: 'text',
      x: 10,
      y: 20,
      width: 120,
      height: 25,
      text: 'Sample start',
      fontSize: 20,
      fontFamily: 5,
      containerId: 'start',
    },
    { ...common, id: 'finish', type: 'ellipse', x: 320, y: 0, width: 140, height: 70 },
    {
      ...common,
      id: 'join',
      type: 'arrow',
      x: 140,
      y: 35,
      width: 180,
      height: 0,
      points: [
        [0, 0],
        [180, 0],
      ],
      startBinding: { elementId: 'start' },
      endBinding: { elementId: 'finish' },
      startArrowhead: null,
      endArrowhead: 'arrow',
    },
    {
      ...common,
      id: 'scribble',
      type: 'freedraw',
      x: 20,
      y: 150,
      width: 100,
      height: 30,
      points: [
        [0, 0],
        [30, 20],
        [60, 5],
        [100, 30],
      ],
      pressures: [],
      simulatePressure: true,
    },
    {
      ...common,
      id: 'loose',
      type: 'text',
      x: 200,
      y: 160,
      width: 160,
      height: 25,
      text: 'Example words',
      fontSize: 20,
      fontFamily: 5,
    },
    {
      ...common,
      id: 'dot',
      type: 'image',
      x: 380,
      y: 160,
      width: 60,
      height: 60,
      fileId: 'pic-id',
    },
  ]),
  '```',
  '%%',
  '',
].join('\n')
const PLAIN_DRAWING = scene([
  { ...common, id: 'only', type: 'diamond', x: 0, y: 0, width: 100, height: 100 },
])
const LATER_DRAWING = scene([
  { ...common, id: 'later', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 },
])
/** A one-pixel PNG. */
const DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Runs the whole-vault command, pictures its confirmation and its report, and says what it showed. */
function runVaultDialog(device: string) {
  return evalAsync<{
    question: string
    button: string
    headline: string
    facts: string
  }>(`(async () => {
    ${WAIT_PRELUDE}
    const doc = typeof activeDocument === 'undefined' ? document : activeDocument
    const owner = doc.defaultView
    const shot = async (name) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const image = await owner.require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', image.resize({ width: owner.innerWidth, height: owner.innerHeight }).toPNG())
    }
    if (!app.commands.executeCommandById('abele:migrate-excalidraw-vault')) throw Error('Command unavailable')
    const modal = await until(() => doc.querySelector('.abele-excalidraw-migration'))
    if (!modal) throw Error('The dialog did not open')
    await until(() => modal.closest('.modal-container').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'))
    const question = modal.querySelector('.abele-excalidraw-migration__message')?.textContent?.trim() ?? ''
    await shot(${JSON.stringify(device)} + '-confirm')
    const go = [...modal.querySelectorAll('button')].find((b) => /^Migrate /.test(b.textContent.trim()))
    if (!go) throw Error('No migrate button')
    const button = go.textContent.trim()
    go.click()
    if (!await until(() => modal.querySelector('.abele-run-report__outcome'), 30000)) throw Error('No report')
    await shot(${JSON.stringify(device)} + '-report')
    const headline = modal.querySelector('.abele-run-report__headline').textContent.trim()
    const facts = modal.querySelector('.abele-run-report__facts')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''
    ;[...modal.closest('.modal').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Done').click()
    if (!await until(() => !modal.isConnected)) throw Error('The dialog did not close')
    return { question, button, headline, facts }
  })()`)
}

const canvasOf = (path: string) =>
  evalAsync<{
    nodes: { id: string; type: string; file?: string; text?: string }[]
    edges: { fromNode: string; toNode: string }[]
    abele: Record<string, unknown>
  } | null>(
    `(async () => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(path)}); return f ? JSON.parse(await app.vault.read(f)) : null })()`
  )

describe.skipIf(!available)('Excalidraw drawings to canvases', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      const dir = ${JSON.stringify(DIR)}
      if (app.vault.getAbstractFileByPath(dir)) await app.vault.adapter.rmdir(dir, true)
      await app.vault.createFolder(dir)
      await app.vault.create(dir + '/Sample flow.excalidraw.md', ${JSON.stringify(NOTE_DRAWING)})
      await app.vault.create(dir + '/Demo shape.excalidraw', ${JSON.stringify(PLAIN_DRAWING)})
      const bin = atob(${JSON.stringify(DOT_PNG)}); const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await app.vault.createBinary(dir + '/sample-dot.png', bytes.buffer)
      return true
    })()`)
  })
  afterAll(async () => {
    evalAsync(
      `(async () => { await app.vault.adapter.rmdir(${JSON.stringify(DIR)}, true); return true })()`
    )
    await reloadApp('app.emulateMobile(false)')
  })

  it('makes one drawing a canvas beside it, through its command', async () => {
    const opened = evalAsync<string>(`(async () => {
      ${WAIT_PRELUDE}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/Sample flow.excalidraw.md`)})
      await app.workspace.getLeaf(true).openFile(file)
      await until(() => app.metadataCache.getFileCache(file)?.frontmatter)
      if (!app.commands.executeCommandById('abele:migrate-excalidraw-drawing')) throw Error('Command unavailable')
      await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/Sample flow.canvas`)}))
      await until(() => app.workspace.getActiveFile()?.extension === 'canvas')
      return app.workspace.getActiveFile()?.path ?? ''
    })()`)
    expect(opened).toBe(`${DIR}/Sample flow.canvas`)
    const canvas = canvasOf(`${DIR}/Sample flow.canvas`)
    expect(canvas?.abele.excalidraw).toEqual({ source: `${DIR}/Sample flow.excalidraw.md` })
    expect(canvas?.nodes.find((n) => n.id === 'start')).toMatchObject({
      type: 'text',
      text: 'Sample start',
    })
    expect(canvas?.nodes.find((n) => n.id === 'dot')).toMatchObject({
      type: 'file',
      file: `${DIR}/sample-dot.png`,
    })
    expect(canvas?.edges).toEqual([
      expect.objectContaining({ fromNode: 'start', toNode: 'finish' }),
    ])
    expect((canvas?.abele.ink as unknown[]).length).toBe(1)
    // The drawing itself is as it was.
    expect(
      evalAsync<string>(
        `app.vault.adapter.read(${JSON.stringify(`${DIR}/Sample flow.excalidraw.md`)})`
      )
    ).toBe(NOTE_DRAWING)
  })

  it('asks with the count, migrates the rest of the vault and reports, on a computer', () => {
    const shown = runVaultDialog('desktop')
    expect(shown.question).toMatch(/^\d+ drawings? found in this vault/)
    expect(shown.button).toMatch(/^Migrate \d+ drawings?$/)
    expect(shown.facts).toMatch(/1 migrated/)
    expect(shown.facts).toMatch(/skipped/)
    expect(canvasOf(`${DIR}/Demo shape.canvas`)?.nodes[0]).toMatchObject({ type: 'text' })
  })

  it('shows the same dialogs on a phone', async () => {
    evalAsync(
      `(async () => { await app.vault.create(${JSON.stringify(`${DIR}/Later sample.excalidraw`)}, ${JSON.stringify(LATER_DRAWING)}); return true })()`
    )
    await reloadApp('app.emulateMobile(true)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
    const shown = runVaultDialog('phone')
    expect(shown.facts).toMatch(/1 migrated/)
    expect(canvasOf(`${DIR}/Later sample.canvas`)).not.toBeNull()
  })
})
