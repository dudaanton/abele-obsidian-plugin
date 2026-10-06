import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { SAMPLE_IMAGE } from '../fixtures/slides'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'sample-slide-design'
const PATH = `${DIR}/sample.md`
const SHOTS = shotDir('abele-slide-design')
const SOURCE = `---
type: presentation
---
::slide{layout=title}::
# A clear idea
A short, muted introduction

---
::slide{layout=section}::
# A new perspective

---
::slide{layout=content}::
## Evidence at a glance
### What matters
- One **important** result
- Another short point

| Measure | Before | After |
| --- | --- | --- |
| Sample | 2 | 4 |
| Example | 3 | 5 |

> [!notes]
> Private detail for the speaker.
> [Report](https://example.test/report)

---
::slide{layout=split}::
## Compare two ideas
::left::
### First
A concise statement
::right::
### Second
- A longer statement wraps onto the next line without colliding with its neighbour
- A short final point

---
::slide{layout=grid}::
## Three useful points
::cell::
### One
A short insight
::cell::
### Two
A short insight
::cell::
### Three
A short insight

---
::slide{layout=image}::
![[${DIR}/sample.svg]]
## A visual statement
A brief caption

---
::slide{layout=quote}::
> A clear quotation makes one idea memorable.

A short attribution
`
let layout: unknown
beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  await evalLong(`(async()=>{
    if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('sample fixture already exists')
    await app.vault.createFolder(${JSON.stringify(DIR)})
    await app.vault.create(${JSON.stringify(DIR + '/sample.svg')},${JSON.stringify(SAMPLE_IMAGE)})
    const file=await app.vault.create(${JSON.stringify(PATH)},${JSON.stringify(SOURCE)})
    const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file)
    return true
  })()`)
})
afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    for(const leaf of app.workspace.getLeavesOfType('abele-deck'))if(leaf.view.file?.path===${JSON.stringify(PATH)})leaf.detach()
    const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

describe.skipIf(!available)('slide hierarchy in the Obsidian theme', () => {
  it('reports authoring warnings independently of overflow and asks for a fix or explanation', async () => {
    const source = `---\ntype: presentation\n---\n# A roomy slide\n${'word '.repeat(41)}\n\n---\n# Sources belong in notes\n[One](https://example.test/one) [Two](https://example.test/two) [Three](https://example.test/three)`
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const path=${JSON.stringify(DIR + '/warnings.md')}
      const file=await app.vault.create(path,${JSON.stringify(source)})
      const scope=new window.__abeleTest.ScopeResolver();scope.addFile(path)
      try { return (await window.__abeleTest.createAgentTools().find(t=>t.name==='deck_check').execute('sample-warnings',{path},undefined,{scope,interactive:true})).content[0].text }
      finally { await app.vault.delete(file) }
    })()`)
    )
    expect(result.slides[0].warnings.map((w: { kind: string }) => w.kind)).toEqual(['words'])
    expect(result.slides[1].warnings.map((w: { kind: string }) => w.kind)).toEqual(['links'])
    expect(
      result.slides
        .flatMap((s: { issues: { kind: string }[] }) => s.issues)
        .filter((i: { kind: string }) => i.kind === 'overflow')
    ).toEqual([])
    expect(result.instruction).toContain('Fix authoring warnings or explain')
  })
  for (const theme of ['light', 'dark']) {
    it(`centers only short text bodies and wraps readable sources in ${theme}`, async () => {
      const longUrl = 'https://example.test/reference/' + 'sample-segment-'.repeat(18)
      const source = `---\ntype: presentation\n---\n## A focused statement\nA single useful idea\n\n> [!notes]\n> <${longUrl}>\n\n---\n## Several useful points\n${'- A useful point\n'.repeat(6)}`
      const result = JSON.parse(
        await evalLong(`(async()=>{
        const path=${JSON.stringify(DIR + '/short-content.md')},file=await app.vault.create(path,${JSON.stringify(source)}),leaf=app.workspace.getLeaf('tab')
        const original={light:document.body.classList.contains('theme-light'),dark:document.body.classList.contains('theme-dark')}
        const scope=new window.__abeleTest.ScopeResolver();scope.addFile(path)
        const ctx={scope,interactive:true},tools=window.__abeleTest.createAgentTools()
        try {
          document.body.classList.toggle('theme-light',${JSON.stringify(theme)}==='light');document.body.classList.toggle('theme-dark',${JSON.stringify(theme)}==='dark')
          await leaf.openFile(file);const v=leaf.view.viewer;await v.ready
          const active=()=>v.viewport.querySelector('.abele-slide:not([hidden])')
          const shot=async(slide,name)=>{
            const picture=await tools.find(t=>t.name==='screenshot').execute('sample-picture',{path,slide},undefined,ctx)
            const saved=picture.content[0].text.split('\\n')[0].replace('Screenshot saved: ','');const f=app.vault.getAbstractFileByPath(saved)
            try { const fs=require('fs');fs.writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(theme)}+'-'+name+'.png',Buffer.from(await app.vault.readBinary(f))) }
            finally { await app.vault.delete(f) }
          }
          const s=active(),body=s.querySelector('.abele-slide-content-body'),b=body.getBoundingClientRect(),text=body.firstElementChild.getBoundingClientRect(),scale=s.getBoundingClientRect().width/1280
          const short={centered:s.classList.contains('abele-slide-short-body'),error:Math.abs((text.top+text.bottom)/2-(b.top+b.bottom)/2)/scale,heading:s.querySelector('.abele-slide-content-heading h2').getBoundingClientRect().top<s.getBoundingClientRect().top+100*scale}
          await shot(1,'short-content')
          await v.go(1);const dense=active().classList.contains('abele-slide-short-body')
          await v.go(2);const sourceSlide=active(),li=sourceSlide.querySelector('li'),h3=sourceSlide.querySelector('h3')
          const sources={entry:parseFloat(getComputedStyle(li).fontSize),heading:parseFloat(getComputedStyle(h3).fontSize),width:li.scrollWidth,available:li.clientWidth}
          const report=JSON.parse((await tools.find(t=>t.name==='deck_check').execute('sample-check',{path,slide:3},undefined,ctx)).content[0].text)
          await shot(3,'long-sources')
          return JSON.stringify({short,dense,sources,issues:report.slides[0].issues,unchanged:await app.vault.read(file)===${JSON.stringify(source)}})
        } finally {
          leaf.detach();await app.vault.delete(file)
          document.body.classList.toggle('theme-light',original.light);document.body.classList.toggle('theme-dark',original.dark)
        }
      })()`)
      )
      expect(result.short.centered).toBe(true)
      expect(result.short.error).toBeLessThan(2)
      expect(result.short.heading).toBe(true)
      expect(result.dense).toBe(false)
      expect(result.sources.entry).toBeGreaterThanOrEqual(28)
      expect(result.sources.heading).toBeGreaterThanOrEqual(24)
      expect(result.sources.heading).toBeLessThan(result.sources.entry)
      expect(result.sources.width).toBeLessThanOrEqual(result.sources.available + 1)
      expect(result.issues.filter((issue: { kind: string }) => issue.kind === 'overflow')).toEqual(
        []
      )
      expect(result.unchanged).toBe(true)
    })
    it(`renders every layout at logical size in ${theme}, with theme colours and sources`, async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
        const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
        const viewer=leaf.view.viewer;await viewer.ready
        const original={light:document.body.classList.contains('theme-light'),dark:document.body.classList.contains('theme-dark')}
        const scope=new window.__abeleTest.ScopeResolver();scope.addFile(${JSON.stringify(PATH)})
        const ctx={scope,interactive:true}
        const tools=window.__abeleTest.createAgentTools()
        const report=JSON.parse((await tools.find(t=>t.name==='deck_check').execute('sample-check',{path:${JSON.stringify(PATH)}},undefined,ctx)).content[0].text)
        const results=[]
        const measure=el=>el?parseFloat(getComputedStyle(el).fontSize):0
        try {
          document.body.classList.toggle('theme-light',${JSON.stringify(theme)}==='light')
          document.body.classList.toggle('theme-dark',${JSON.stringify(theme)}==='dark')
          for(let index=0;index<viewer.model.slides.length;index++) {
            await viewer.go(index)
            const slide=viewer.viewport.querySelector('.abele-slide:not([hidden])')
            const colour=document.createElement('div');colour.style.color='var(--text-accent)';slide.append(colour)
            const expectedAccent=getComputedStyle(colour).color;colour.remove()
            const strong=slide.querySelector('strong'),th=slide.querySelector('th'),quote=slide.querySelector('blockquote')
            const item={layout:viewer.model.slides[index].settings.layout,body:measure(slide),h1:measure(slide.querySelector('h1')),h2:measure(slide.querySelector('h2')),h3:measure(slide.querySelector('h3')),width:slide.clientWidth,height:slide.clientHeight,
              accent:!strong||getComputedStyle(strong).color===expectedAccent,
              table:!th||(parseFloat(getComputedStyle(th).paddingTop)>=10&&getComputedStyle(th).backgroundColor!=='rgba(0, 0, 0, 0)'),
              quote:!quote||parseFloat(getComputedStyle(quote).borderLeftWidth)>=4,
              listIndent:[...slide.querySelectorAll('li')].every(li=>parseFloat(getComputedStyle(li).marginInlineStart)===0),
              tracking:[...slide.querySelectorAll('p,li,table,th,td')].every(el=>getComputedStyle(el).letterSpacing==='normal'||parseFloat(getComputedStyle(el).letterSpacing)===0),
              rendering:getComputedStyle(slide.querySelector('p,li')||slide).textRendering,
              entry:measure(slide.querySelector('li')),
              cells:[...slide.querySelectorAll('.abele-slide-region-cell')].map(el=>{const b=el.getBoundingClientRect();return {top:b.top,left:b.left,right:b.right}}),
              marker:slide.querySelector('.abele-slide-sources-marker')?.textContent??'',
              private:slide.textContent.includes('Private detail')}
            const picture=await tools.find(t=>t.name==='screenshot').execute('sample-picture',{path:${JSON.stringify(PATH)},slide:index+1},undefined,ctx)
            const path=picture.content[0].text.split('\\n')[0].replace('Screenshot saved: ','')
            const file=app.vault.getAbstractFileByPath(path)
            try {
              const bytes=await app.vault.readBinary(file)
              const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true})
              fs.writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(theme)}+'-'+(index+1)+'-'+(viewer.model.slides[index].generated||item.layout)+'.png',Buffer.from(bytes))
              const image=new Image();image.src=picture.injectMessages[0].content.find(p=>p.type==='image_url').image_url.url;await image.decode()
              item.png=[image.naturalWidth,image.naturalHeight]
            } finally { await app.vault.delete(file) }
            results.push(item)
          }
          return JSON.stringify({results,report,unchanged:await app.vault.read(leaf.view.file)===${JSON.stringify(SOURCE)}})
        } finally {
          document.body.classList.toggle('theme-light',original.light)
          document.body.classList.toggle('theme-dark',original.dark)
        }
      })()`)
      )
      expect(result.unchanged).toBe(true)
      expect(result.results[0].h1).toBeGreaterThanOrEqual(80)
      expect(result.results[1].h1).toBeGreaterThanOrEqual(70)
      expect(result.results).toHaveLength(8)
      for (const slide of result.results) {
        expect(slide.png).toEqual([1280, 720])
        expect([slide.width, slide.height]).toEqual([1280, 720])
        expect(slide.body).toBeGreaterThanOrEqual(28)
        expect(slide.accent).toBe(true)
        expect(slide.table).toBe(true)
        expect(slide.quote).toBe(true)
        expect(slide.listIndent).toBe(true)
        expect(slide.tracking).toBe(true)
        expect(slide.rendering).toBe('geometricprecision')
        expect(slide.private).toBe(false)
      }
      expect(result.results[2].h2).toBeGreaterThan(result.results[2].h3)
      expect(result.results[2].h3).toBeGreaterThan(result.results[2].body)
      expect(result.results[2].marker).toBe('Sources: 1')
      expect(result.results[4].cells).toHaveLength(3)
      expect(
        result.results[4].cells.every(
          (cell: { top: number }) => Math.abs(cell.top - result.results[4].cells[0].top) < 1
        )
      ).toBe(true)
      expect(result.results[7].entry).toBeGreaterThanOrEqual(28)
      expect(result.results[7].h3).toBeGreaterThanOrEqual(24)
      expect(result.results[7].h3).toBeLessThan(result.results[7].entry)
      expect(
        result.report.slides
          .flatMap((s: { issues: { kind: string }[] }) => s.issues)
          .filter((i: { kind: string }) => i.kind === 'overflow')
      ).toEqual([])
      expect(result.report.slides.flatMap((s: { warnings: unknown[] }) => s.warnings)).toEqual([])
    })
  }
})
