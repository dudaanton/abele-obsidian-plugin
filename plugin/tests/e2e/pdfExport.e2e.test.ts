/** The host's own PDF renderer, including its post-processor promise barrier. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { drawingSvg } from '../../src/drawing/drawingFile'

const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample PDF export'
const NOTE = `${FOLDER}/Sample export.md`
const SHOTS = shotDir('pdf-export')
let owned = false
const DRAWING = drawingSvg({
  items: [
    {
      id: 'sample-frame',
      type: 'shape',
      kind: 'rect',
      x1: 0,
      y1: 0,
      x2: 220,
      y2: 100,
      color: 'blue',
      size: 3,
    },
    {
      id: 'sample-label',
      type: 'text',
      x: 15,
      y: 20,
      text: 'Sample drawing',
      size: 20,
      color: 'black',
    },
  ],
})
const fence = (language: string, source: string) => `\`\`\`${language}\n${source}\n\`\`\``
const BODY = [
  '# Sample export',
  '## Diagram',
  fence('mermaid', 'graph LR\nA[Sample start] --> B[Sample finish]'),
  '## Chart',
  fence(
    'abele-chart',
    'title: Sample chart\nxLabels: [First, Middle, Last]\nseries:\n  - name: Sample values\n    data: [2, 7, 4]'
  ),
  '## Gallery',
  '::abele-gallery{layout=slider height=120}::',
  '![[sample-first.png|First picture]]\n![[sample-last.png|Last picture]]',
  '## Map',
  fence(
    'abele-map',
    'points:\n  - lat: 10\n    lon: 20\n    label: Sample stop\n  - lat: 11\n    lon: 22\n    label: Sample destination\nlines:\n  - points: [[10, 20], [11, 22]]'
  ),
  '## Columns',
  '> [!abele-columns]\n> > [!abele-column] Left\n> > Sample left column\n>\n> > [!abele-column] Right\n> > Sample right column',
  '## Table and highlights',
  '| Item | Value |\n| --- | --- |\n| Sample row | 42 |',
  '=={red} Sample highlight==\n\n- [x] Sample checked item\n- [ ] Sample unchecked item',
  '## Canvas',
  '![[sample-diagram.canvas]]',
  '## Drawing',
  '![[sample-drawing.svg]]',
  '## Slides',
  '![[sample-slides.md]]',
  '## HTML view',
  fence(
    'abele-view',
    '<article><h3>Sample static view</h3><p>Sample view content</p><table><tr><td>Sample cell</td></tr></table></article>'
  ),
  '## Message card',
  fence(
    'abele-message',
    'chat: Sample chat.abchat\nmessage: sample-message\ntitle: Sample message\n---\nSample message body'
  ),
  '## Code card',
  fence(
    'abele-github',
    'url: https://github.com/example/sample/blob/main/sample.ts\nlabel: Sample code\nlang: ts\n---\n' +
      Array.from({ length: 80 }, (_, i) => `const sampleValue${i} = ${i}`).join('\n')
  ),
  ...[
    'abele-chart',
    'abele-map',
    'abele-calendar',
    'abele-timeline',
    'abele-find-and-replace',
  ].flatMap((type) => [
    `## Base ${type}`,
    fence(
      'base',
      `filters: 'file.inFolder("Sample PDF export/Rows")'\nviews:\n  - type: ${type}\n    name: Sample data\n    order: [file.name, note.value, note.date, note.coordinates]\n    dateProperty: note.date\n    coordinates: note.coordinates`
    ),
  ]),
].join('\n\n')

describe.skipIf(!available)('PDF export of rendered note content', () => {
  beforeAll(() => {
    evalAsync(String.raw`(async () => {
      const folder = ${JSON.stringify(FOLDER)}
      if (app.vault.getAbstractFileByPath(folder)) throw new Error('Synthetic fixture already exists')
      await app.vault.createFolder(folder)
      try {
      await app.vault.createFolder(folder + '/Rows')
      for (let i=1; i<=65; i++) await app.vault.create(folder + '/Rows/Sample row ' + i + '.md', '---\nvalue: ' + i * 3 + '\ndate: ' + new Date(Date.UTC(2025, 0, i)).toISOString().split('T')[0] + '\ncoordinates: "' + (10+i) + ', ' + (20+i) + '"\n---\nSample record')
      const c = document.createElement('canvas'); c.width = 180; c.height = 100
      const g = c.getContext('2d')
      for (const [name, color] of [['sample-first.png', '#28784a'], ['sample-last.png', '#c85030']]) {
        g.fillStyle = color; g.fillRect(0, 0, 180, 100)
        g.fillStyle = '#ffffff'; g.fillRect(30, 25, 120, 50)
        await app.vault.createBinary(folder + '/' + name, Uint8Array.from(atob(c.toDataURL().split(',')[1]), ch => ch.charCodeAt(0)).buffer)
      }
      await app.vault.create(folder + '/sample-diagram.canvas', JSON.stringify({nodes:[
        {id:'sample-a',type:'text',text:'Sample canvas first',x:0,y:0,width:240,height:120},
        {id:'sample-b',type:'text',text:'Sample canvas last',x:320,y:0,width:240,height:120}
      ], edges:[{id:'sample-edge',fromNode:'sample-a',fromSide:'right',toNode:'sample-b',toSide:'left'}]}))
      await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(BODY)})
      await app.vault.create(folder + '/sample-drawing.svg', ${JSON.stringify(DRAWING)})
      await app.vault.create(folder + '/sample-slides.md', '---\ntype: presentation\n---\n::slide{layout=title}::\n\nSample first slide body\n\n---\n\n::slide{layout=content}::\n\nSample second slide body')
      await app.vault.create(folder + '/Sample backlink.md', '---\ndescription: Sample backlink description\n---\n[[Sample export]]')
      await app.vault.create(folder + '/Sample task.md', '---\ntype: task\ngroups: ["[[Sample export]]"]\n---\nSample task title\n\nSample task description')
      await app.vault.create(folder + '/Sample log.md', '---\ntype: log\ngroups: ["[[Sample export]]"]\n---\nSample log excerpt')
      const file = app.vault.getFileByPath(${JSON.stringify(NOTE)})
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file)
      await new Promise(resolve => setTimeout(resolve, 1200))
      return true
      } catch (error) {
        for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path.startsWith(folder + '/')) leaf.detach()
        const made = app.vault.getAbstractFileByPath(folder)
        if (made) await app.vault.delete(made, true)
        throw error
      }
    })()`)
    owned = true
  })

  afterAll(() => {
    if (!owned) return
    evalAsync(String.raw`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view.file?.path.startsWith(${JSON.stringify(FOLDER + '/')})) leaf.detach()
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
      if (folder) await app.vault.delete(folder, true)
      return true
    })()`)
    owned = false
  })

  it.each([false, true])(
    'exports all body blocks with header/footer=%s and rasterizes every PDF page',
    (include) => {
      const result = evalAsync<{
        pages: number
        text: string
        diagrams: number
        gallery: number
        chrome: number
        ink: number[]
        controls: number
        colors: boolean[]
        tables: number[]
        drawing: boolean
        baseChart: boolean
      }>(
        String.raw`(async () => {
      const obsidian = window.__abeleTest.rendering, remote = require('@electron/remote'), fs = require('fs')
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const before = config.pdfIncludeHeaderFooter, dark = document.body.classList.contains('theme-dark')
      config.pdfIncludeHeaderFooter = ${include}
      document.body.removeClass('theme-dark'); document.body.addClass('theme-light')
      let modal, owner, root, style
      try {
      const originalOpen = obsidian.Modal.prototype.open
      try {
        obsidian.Modal.prototype.open = function() { modal = this }
        const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === ${JSON.stringify(NOTE)})?.view
        if (!view?.printToPdf) throw new Error('Synthetic note has no host PDF export method')
        view.printToPdf()
      } finally { obsidian.Modal.prototype.open = originalOpen }
      if (!modal?.print) throw new Error('Host PDF renderer was not reached')
      owner = new obsidian.Component(); owner.load()
      root = document.body.createDiv('print')
      style = document.head.createEl('style')
      style.textContent = '.print h2 { break-before: page; }'
        const content = await modal.print(root, owner, false)
        // The host waits one additional layout interval before its native PDF call.
        await new Promise(resolve => setTimeout(resolve, 200))
        const diagrams = content.querySelectorAll('svg').length
        if (content.querySelector('parsererror')) throw new Error('A chart contains invalid serialized SVG')
        const gallery = content.querySelectorAll('.abele-print-gallery img').length
        const chrome = content.querySelectorAll('.abele-print-chrome').length
        const tables = [...content.querySelectorAll('.abele-print-base')].map(table => table.querySelectorAll('tbody tr').length)
        const picture = content.querySelector('.abele-drawing-embed img')
        const drawing = !!picture && picture.complete && picture.naturalWidth > 0
        const plot = content.querySelector('.abele-bases-echart')?.getBoundingClientRect()
        const baseChart = !!plot && plot.width > 200 && plot.height > 100
        const controls = [...content.querySelectorAll('button:not(.abele-image-thumbnail),input:not([type="checkbox"]),select,textarea')].filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0).length
        const pdf = await remote.getCurrentWebContents().printToPDF({pageSize:'A4', printBackground:true})
        const prefix = ${JSON.stringify(SHOTS)} + '/chrome-${include ? 'on' : 'off'}'
        fs.mkdirSync(${JSON.stringify(SHOTS)}, {recursive:true}); fs.writeFileSync(prefix + '.pdf', pdf)
        fs.writeFileSync(prefix + '.html', content.outerHTML)
        const lib = await obsidian.loadPdfJs()
        const book = await lib.getDocument({data:new Uint8Array(pdf)}).promise
        let text = ''; const ink = []; const colors = [false, false]
        try {
          for (let i=1; i<=book.numPages; i++) {
            const page = await book.getPage(i), viewport = page.getViewport({scale:1.5})
            text += (await page.getTextContent()).items.map(item => item.str || '').join(' ') + '\n'
            const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height
            const ctx = canvas.getContext('2d')
            await page.render({canvasContext:ctx,canvas,viewport}).promise
            fs.writeFileSync(prefix + '-page-' + i + '.png', Buffer.from(canvas.toDataURL().split(',')[1], 'base64'))
            const pixels = ctx.getImageData(0, Math.min(200, canvas.height-1), canvas.width, Math.max(1, canvas.height-200)).data
            let count = 0
            for (let p=0; p<pixels.length; p+=4) {
              if (pixels[p]<220 || pixels[p+1]<220 || pixels[p+2]<220) count++
              if (Math.abs(pixels[p]-40)<5 && Math.abs(pixels[p+1]-120)<5 && Math.abs(pixels[p+2]-74)<5) colors[0] = true
              if (Math.abs(pixels[p]-200)<5 && Math.abs(pixels[p+1]-80)<5 && Math.abs(pixels[p+2]-48)<5) colors[1] = true
            }
            ink.push(count)
            canvas.width = canvas.height = 0
          }
          return {pages:book.numPages,text,diagrams,gallery,chrome,ink,controls,colors,tables,drawing,baseChart}
        } finally { await book.destroy() }
      } finally {
        root?.remove(); style?.remove(); owner?.unload()
        config.pdfIncludeHeaderFooter = before
        document.body.toggleClass('theme-dark', dark); document.body.toggleClass('theme-light', !dark)
      }
    })()`,
        150_000
      )
      expect(result.pages).toBeGreaterThanOrEqual(10)
      expect(result.diagrams).toBeGreaterThanOrEqual(3)
      expect(result.gallery).toBe(2)
      expect(result.chrome).toBe(include ? 2 : 0)
      expect(result.controls).toBe(0)
      expect(result.colors).toEqual([true, true])
      expect(result.tables).toEqual([65, 65, 65, 65])
      expect(result.drawing).toBe(true)
      expect(result.baseChart).toBe(true)
      for (const text of [
        'Sample start',
        'Sample finish',
        'Sample chart',
        'First picture',
        'Last picture',
        'Sample stop',
        'Sample destination',
        'Sample left column',
        'Sample right column',
        'Sample row',
        'Sample static view',
        'Sample message body',
        'sampleValue',
        'sampleValue79',
        'Sample row 65',
        'Sample first slide body',
        'Sample second slide body',
      ])
        expect(result.text.replace(/\s/g, '')).toContain(text.replace(/\s/g, ''))
      expect(result.text.replace(/\s/g, '').match(/Samplerow65/g)?.length).toBe(5)
      if (include) {
        expect(result.text).toContain('Sample backlink')
        expect(result.text).toContain('Sample task title')
        expect(result.text).toContain('Sample log excerpt')
      } else expect(result.text).not.toContain('Sample backlink')
      expect(result.ink.filter((count) => count > 100).length).toBeGreaterThanOrEqual(10)
    }
  )

  it('shows the PDF preference in desktop and phone settings', async () => {
    const shot = (name: string) =>
      evalAsync(String.raw`(async () => {
      app.setting.open(); app.setting.openTabById('abele')
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      await wait(500)
      const root = app.setting.activeTab.containerEl
      root.querySelector('[data-tab-id="other"]').click()
      await wait(300)
      const row = [...root.querySelectorAll('.setting-item')].find(el => el.textContent.includes('Include Abele header and footer'))
      if (!row) throw new Error('PDF preference is missing')
      row.scrollIntoView({block:'center'}); await wait(200)
      const remote = require('@electron/remote')
      const settingsWindow = remote.BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - ')) || remote.getCurrentWindow()
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/settings-${name}.png', (await settingsWindow.webContents.capturePage()).toPNG())
      return !!row.querySelector('input, .checkbox-container, [role="switch"]')
    })()`)
    try {
      expect(shot('desktop')).toBe(true)
      await withEmulatedPhone(async () => {
        expect(shot('phone')).toBe(true)
      })
    } finally {
      evalRaw('app.setting.close()')
    }
  })
})
