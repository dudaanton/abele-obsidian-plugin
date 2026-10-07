import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { reloadApp, evalRaw, evalJson, evalLong } from './helpers/obsidianCli'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
targets('desktop')
it('keeps the review comment field and its focus ring on a phone-sized screen', async () => {
  const bounds = evalJson<number[]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )
  evalRaw(`document.querySelector('.modal-close-button')?.click()`)
  await reloadApp('app.emulateMobile(true)')
  try {
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
    const result = JSON.parse(
      await evalLong(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      await window.__abeleTest.openDialog('node-review');await wait(500)
      const modal=document.querySelector('.modal.abele-modal'),query=()=>modal.querySelector('textarea[aria-label="Review comment"]')
      const before=!!query(),transitions=[],cuts=[]
      for(const field of modal.querySelectorAll('input,textarea,select,button,[tabindex="0"]')){
        if(!field.getBoundingClientRect().width)continue
        field.focus();if(!query())transitions.push(field.tagName+':'+field.textContent)
        const r=field.getBoundingClientRect(),reach=(${outwardBoxShadowReach.toString()})(getComputedStyle(field).boxShadow)
        for(let el=field.parentElement;el&&el!==document.documentElement;el=el.parentElement){const s=getComputedStyle(el);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const b=el.getBoundingClientRect(),left=b.left+el.clientLeft;if(Math.max(left-(r.left-reach),r.right+reach-(left+el.clientWidth))>.5)cuts.push(field.tagName)}
        field.blur()
      }
      query()?.scrollIntoView({block:'center'});await wait(200)
      require('fs').writeFileSync('/tmp/abele-phone/node-review-comment-targeted.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      const after=!!query();document.querySelector('.modal-close-button')?.click();return JSON.stringify({before,after,cuts,transitions})
    })()`)
    ) as { before: boolean; after: boolean; cuts: string[]; transitions: string[] }
    console.log('node review field', result)
    expect(result.before).toBe(true)
    expect(result.after).toBe(true)
    expect(result.cuts).toEqual([])
  } finally {
    evalRaw(
      `document.querySelector('.modal-close-button')?.click();require('@electron/remote').getCurrentWindow().setContentSize(${bounds[0]},${bounds[1]})`
    )
    await reloadApp('app.emulateMobile(false)')
  }
}, 60000)
it('selects lines in the shared diff across files, adds comments, and queues exactly one review', () => {
  const result = evalAsync<{ comments: number; queued: boolean; secondSend: boolean }>(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await wait(40)}throw Error('Node review control did not appear')}
    const close=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    close();await until(()=>!document.querySelector('.modal'))
    try {
      await window.__abeleTest.openDialog('node-diffs');await until(()=>document.querySelectorAll('.abele-node-files .abele-github-file').length===2);await wait(200)
      const root=document.querySelector('.abele-node-files'),files=[...root.querySelectorAll('.abele-github-file')]
      for(let i=0;i<files.length;i++) {
        const numbers=[...files[i].querySelectorAll('.cm-gutterElement')].filter(e=>e.textContent.trim()===(i===0?'2':'1'))
        const number=numbers.at(-1);if(!number)throw Error('Diff line number missing')
        number.scrollIntoView({block:'center'});await wait(100)
        const b=number.getBoundingClientRect();number.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:b.left+b.width/2,clientY:b.top+b.height/2}))
        await until(()=>[...files[i].querySelectorAll('button')].some(b=>b.textContent.startsWith('Comment ·')))
        ;[...files[i].querySelectorAll('button')].find(b=>b.textContent.startsWith('Comment ·')).click()
        await until(()=>root.querySelector('textarea[aria-label="Review comment"]'))
        const field=root.querySelector('textarea[aria-label="Review comment"]');field.value='Sample review '+(i+1);field.dispatchEvent(new Event('input',{bubbles:true}));await wait(50)
        ;[...root.querySelectorAll('button')].find(b=>b.textContent==='Add to review').click();await until(()=>root.querySelector('details summary')?.textContent.includes((i+1)+' comments'))
      }
      const comments=root.querySelectorAll('details .abele-node-files__comment').length
      const send=[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Send review (2)');send.click()
      await until(()=>root.textContent.includes('waiting for confirmation'))
      const check=[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Check queued review');check.click();await wait(100)
      return {comments,queued:root.textContent.includes('Queued review'),secondSend:[...document.querySelectorAll('.modal button')].some(b=>b.textContent.startsWith('Send review'))}
    } finally {close();await until(()=>!document.querySelector('.modal'))}
  })()`)
  expect(result.comments).toBe(2)
  expect(result.queued).toBe(true)
  expect(result.secondSend).toBe(false)
})
