import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { exposeToPhone, screenshot, tap } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'
import { dismissOwnNotices } from './helpers/ownNotices'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = `Sample web canvas ${randomUUID()}`
const SHOTS = shotDir('canvas-web')
const PRELUDE = `
  const path = ${JSON.stringify(`${DIR}/Sample pages.canvas`)}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const view = () => app.workspace.getLeavesOfType('abele-canvas').find(leaf => leaf.view.file?.path === path)?.view
  const web = id => view()?.contentEl.querySelector('[data-card-id="'+id+'"] .abele-canvas-web')
  const read = async () => JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE} return JSON.stringify(await (async () => { ${body} })()) })()`,
    60_000
  )
const until = (expression: string, timeout = 20_000) =>
  expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout }).toBe(true)
/** A tap or click at a point of the screen, as a person's. */
const at = async ([x, y]: number[]) => {
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
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
/** What each web card shows: a page, or a compact card with its title and an Open button. */
interface Shown {
  state: string | null
  frame: string | null
  title: string
  open: boolean
  live: string | null
  input: string | null
}
const shown = (id: string) =>
  run<Shown>(`const el=web(${JSON.stringify(id)});if(!el)return {state:null,frame:null,title:'',open:false,live:null,input:null}
    const frame=el.querySelector('webview,iframe'),button=el.querySelector('[aria-label="Open web page"]'),r=button?.getBoundingClientRect()
    return {state:el.dataset.webState??null,frame:frame?.tagName.toLowerCase()??null,title:el.querySelector('.abele-canvas-web__title')?.textContent??'',
      open:!!r&&r.width>0&&r.height>0,live:el.dataset.webLive??null,input:frame?getComputedStyle(frame).pointerEvents:null}`)

const PAGE = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body style="margin:0;font:16px sans-serif;background:#e8f0ff"><h1>${title}</h1><button id="sample-action">Sample action</button></body></html>`

describe.skipIf(!available)('web pages on the canvas', () => {
  let server: Server
  let origin = ''
  let unexpose: (() => Promise<void>) | null = null
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/framable')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGE('Sample framable page'))
      } else if (req.url?.startsWith('/refused')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "frame-ancestors 'none'",
        })
        res.end(PAGE('Sample refused page'))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
    )
    if (onPhone()) unexpose = await exposeToPhone(port)
    origin = `http://127.0.0.1:${port}`
    // Obsidian Canvas's own file: link nodes as it writes them, beside a text card.
    const canvas = {
      nodes: [
        {
          id: 'framable',
          type: 'link',
          url: `${origin}/framable`,
          x: 0,
          y: 0,
          width: 400,
          height: 280,
        },
        {
          id: 'refused',
          type: 'link',
          url: `${origin}/refused`,
          x: 440,
          y: 0,
          width: 400,
          height: 280,
        },
        {
          id: 'unreachable',
          type: 'link',
          url: 'http://127.0.0.1:9/sample',
          x: 0,
          y: 320,
          width: 400,
          height: 280,
        },
        {
          id: 'words',
          type: 'text',
          text: 'Sample words',
          x: 440,
          y: 320,
          width: 260,
          height: 120,
        },
      ],
      edges: [],
    }
    run(`
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('Synthetic folder already exists')
      window.__canvasWeb = { layout: app.workspace.getLayout(), preference: window.__abeleTest.AbeleConfig.getInstance().canvasViewer }
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      await app.vault.createFolder(${JSON.stringify(DIR)}); window.__canvasWeb.owned = true
      await app.vault.create(path, ${JSON.stringify(JSON.stringify(canvas, null, '\t'))})
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath(path)); await app.workspace.revealLeaf(leaf)
      await wait(800); view().viewer.fit(false); await wait(400)
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    try {
      run(`
        const leaves = []; app.workspace.iterateAllLeaves(l => { if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) }); leaves.forEach(l => l.detach())
        const saved = window.__canvasWeb
        if (saved?.owned) { const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if (dir) await app.vault.delete(dir, true) }
        if (saved?.preference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = saved.preference
        if (saved?.layout) await app.workspace.changeLayout(saved.layout)
        delete window.__canvasWeb
        return true
      `)
      dismissOwnNotices('canvas')
    } finally {
      await unexpose?.()
      await new Promise((resolve) => server?.close(resolve))
    }
  }, 120_000)

  it('shows a canvas link node from Obsidian Canvas as its page, or as a card with its title and Open, never a blank box', async () => {
    await until(`['framable','refused','unreachable'].every(id=>web(id)?.dataset.webState)`).catch(
      (error: unknown) => {
        shot('before-desktop-or-phone')
        throw error
      }
    )
    await until(
      `web('framable').querySelector('.abele-canvas-web__title')?.textContent==='Sample framable page'`
    )
    await until(`web('unreachable').dataset.webState==='card'`)
    shot(onPhone() ? 'phone-opened' : 'desktop-opened')
    const framable = shown('framable'),
      refused = shown('refused'),
      unreachable = shown('unreachable')
    console.info('canvas web cards', JSON.stringify({ framable, refused, unreachable }))
    expect(framable.state).toBe('page')
    expect(framable.frame).toBe(onPhone() ? 'iframe' : 'webview')
    // A page is shown only once the card is picked takes input; until then the canvas does.
    expect(framable.live).toBe('false')
    expect(framable.input).toBe('none')
    // The desktop shows a page in its own window, which a site cannot refuse. A phone frames it,
    // and a site that forbids framing gets the card instead of an empty frame.
    if (onPhone()) {
      await until(`web('refused').dataset.webState==='card'`)
      expect(shown('refused')).toMatchObject({
        state: 'card',
        title: 'Sample refused page',
        open: true,
      })
    } else {
      await until(
        `web('refused').querySelector('.abele-canvas-web__title')?.textContent==='Sample refused page'`
      )
      expect(shown('refused').state).toBe('page')
    }
    expect(unreachable).toMatchObject({ state: 'card', frame: null, open: true })
    expect(unreachable.title).toContain('127.0.0.1:9')
  }, 120_000)

  it('lets the picked web card take input and gives it back to the canvas when it is let go', async () => {
    // A press on the card's edge picks it, as on any card; the page under it is not touched.
    const corner = run<number[]>(
      `const r=view().contentEl.querySelector('[data-card-id="framable"]').getBoundingClientRect();return [Math.round(r.left+6),Math.round(r.top+6)]`
    )
    await at(corner)
    await until(
      `view().editor.selected?.has?.('framable')||[...(view().viewer.selection??[])].includes('framable')`
    )
    await until(`web('framable').dataset.webLive==='true'`)
    expect(shown('framable').input).toBe('auto')
    shot(onPhone() ? 'phone-picked' : 'desktop-picked')
    const empty = run<number[]>(
      `const s=view().viewer.stage.getBoundingClientRect(),v=view().viewer;for(let fy=0.95;fy>0.05;fy-=0.05)for(let fx=0.95;fx>0.05;fx-=0.05){const x=Math.round(s.left+s.width*fx),y=Math.round(s.top+s.height*fy),hit=document.elementFromPoint(x,y);if(hit&&v.stage.contains(hit)&&!hit.closest('.abele-canvas-chrome,[data-card-id]'))return [x,y]}return null`
    )
    await at(empty)
    await until(`web('framable').dataset.webLive==='false'`)
    expect(shown('framable').input).toBe('none')
  }, 120_000)

  it('shows a pasted address as a web page card', async () => {
    run(`
      const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(`${origin}/framable?pasted`)})
      view().viewer.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      return true
    `)
    await until(`(await read()).nodes.some(n=>n.type==='link'&&n.url.endsWith('?pasted'))`)
    const id = run<string>(
      `return (await read()).nodes.find(n=>n.type==='link'&&n.url.endsWith('?pasted')).id`
    )
    await until(`web(${JSON.stringify(id)})?.dataset.webState==='page'`)
    await until(
      `web(${JSON.stringify(id)}).querySelector('.abele-canvas-web__title')?.textContent==='Sample framable page'`
    )
    shot(onPhone() ? 'phone-pasted' : 'desktop-pasted')
  }, 120_000)
})
