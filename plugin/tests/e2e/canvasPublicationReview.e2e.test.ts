import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalAsync, realClick } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { screenshot, tap } from './helpers/phone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import {
  PUBLICATION_SETUP,
  PUBLICATION_PRELUDE,
  PUBLICATION_CASE_CLEANUP,
  PUBLICATION_CLEANUP,
  PUBLICATION_MEASURE,
  publicationFault,
} from './helpers/canvasPublicationReview'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi(),
  SHOTS = shotDir('canvas-publication-review'),
  mobile = process.env.CANVAS_PUBLICATION_MOBILE === '1'
const run = <T>(body: string): T => evalAsync<T>(`(async()=>{${body}})()`)
const inside = <T>(body: string): T => run<T>(`${PUBLICATION_PRELUDE}${body}`)
const press = async (selector: string) => {
  const point = inside<{ x: number; y: number }>(`
    const element=(${selector});if(!element)throw Error('Canvas review control missing')
    const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
    if(!r.width||!r.height||x<0||x>=innerWidth||y<0||y>=innerHeight||!element.contains(document.elementFromPoint(x,y)))throw Error('Canvas review control is not visible/hittable')
    return {x,y}
  `)
  if (onPhone()) tap(point.x, point.y)
  else await realClick(point.x, point.y)
}
const button = (text: string) =>
  `[...modal().querySelectorAll('button')].find(el=>el.textContent===${JSON.stringify(text)})`
const action = `fixture.view.containerEl.querySelector('[aria-label="Recover failed canvas change"]')`
const shoot = (name: string) => {
  if (onPhone()) screenshot(`${SHOTS}/${name}.png`)
  else
    inside(
      `await wait(100);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS + '/' + name + '.png')},image.toPNG());return true`
    )
}
const measure = () => {
  const result = run<{
    cuts: string[]
    outside: string[]
    viewport: { width: number; height: number }
    bodyOverflow: boolean
  }>(PUBLICATION_MEASURE)
  expect(result.cuts).toEqual([])
  expect(result.outside).toEqual([])
  expect(result.bodyOverflow).toBe(false)
  if (mobile && !onPhone()) expect(result.viewport).toEqual({ width: 390, height: 844 })
  inside(`modal().querySelector('.abele-modal__body').scrollTop=0;return true`)
  return result
}

describe('supported local exit for unsettled Canvas publication', () => {
  let size: number[] | null = null,
    owned = false
  beforeAll(async () => {
    expect(available).toBe(true)
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    const expected = createHash('sha256')
      .update(readFileSync(resolve(process.env.ABELE_PHONE_BUILD ?? 'build', 'main.js')))
      .digest('hex')
    const identity = run<{ hash: string; api: boolean }>(`
      const bytes=await app.vault.adapter.readBinary(app.vault.configDir+'/plugins/abele/main.js')
      const digest=await crypto.subtle.digest('SHA-256',bytes)
      return {hash:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join(''),api:!!window.__abeleTest}
    `)
    expect(identity).toEqual({ hash: expected, api: true })
    console.info('Installed candidate identity:', identity)
    run(PUBLICATION_SETUP)
    owned = true
  })
  afterEach(() => {
    if (owned) run(PUBLICATION_CASE_CLEANUP)
  })
  afterAll(async () => {
    if (owned) console.info('Canvas fixture cleanup:', run(PUBLICATION_CLEANUP))
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  })
  it.each(['persisted', 'unpersisted', 'digest'])(
    'reviews %s using native input, preserves Keep/Cancel, and discards without publishing before a fresh edit',
    async (fault) => {
      const outcome = run<{ outcome: string; source: string; status: string }>(
        publicationFault(fault)
      )
      expect(outcome.outcome).toBe(
        fault === 'digest' ? 'written-acknowledgment-pending' : 'unknown'
      )
      expect(outcome.status).toMatch(
        fault === 'digest' ? /write was confirmed/i : /outcome is uncertain/i
      )
      const openReview = async () => {
        await press(action)
        inside(`await until(()=>modal());return true`)
      }
      const preserved = () => {
        const state = inside<{ same: boolean; source: boolean; process: number; ack: number }>(
          `return {same:retained()===fixture.retained,source:await app.vault.read(fixture.file)===fixture.before,process:fixture.processCalls,ack:fixture.ackCalls}`
        )
        expect(state).toEqual({ same: true, source: true, process: 0, ack: 0 })
      }
      await openReview()
      expect(
        inside<string>(`return modal().querySelector('[data-review="source"]').textContent`)
      ).toBe(outcome.source)
      expect(
        inside<string>(`return modal().querySelector('[data-review="proposed"]').textContent`)
      ).toContain('Retained proposed sample')
      expect(
        inside<string>(`return modal().querySelector('[data-review="baseline"]').textContent`)
      ).toContain('Original persisted sample')
      const geometry = measure()
      shoot(fault + '-review')
      // Inspect saved bytes through a real disclosure tap as well as the readable summary.
      await press(`modal().querySelector('summary')`)
      measure()
      shoot(fault + '-source')
      await press(`modal().querySelector('summary')`)
      preserved()
      await press(button('Keep retained work'))
      expect(inside<boolean>(`return !modal()`)).toBe(true)
      preserved()
      await openReview()
      await press(button('Discard local pending copy…'))
      expect(inside<string>(`return modal().textContent`)).toMatch(/does not undo/i)
      if (fault === 'digest')
        expect(inside<string>(`return modal().textContent`)).toMatch(/does not reconstruct/i)
      measure()
      shoot(fault + '-confirmation')
      await press(button('Cancel'))
      expect(inside<boolean>(`return !modal()`)).toBe(true)
      preserved()
      await openReview()
      await press(button('Discard local pending copy…'))
      await press(button('Discard local pending copy'))
      const discarded = inside<{
        same: boolean
        dirty: boolean
        evidence: boolean
        undo: number
        process: number
        ack: number
      }>(`
        await until(()=>!modal());return {same:await app.vault.read(fixture.file)===fixture.before,dirty:fixture.session.dirty,
          evidence:fixture.session.publicationEvidence===null,undo:fixture.session.history.undo,process:fixture.processCalls,ack:fixture.ackCalls}
      `)
      expect(discarded).toEqual({
        same: true,
        dirty: false,
        evidence: true,
        undo: 0,
        process: 0,
        ack: 0,
      })
      const fresh = inside<{
        undo: number
        process: number
        ack: number
        text: string
        trusted: boolean
      }>(`
        const current=await read()
        await tools.canvas_edit.execute('sample-fresh',{path:fixture.path,revision:current.revision,
          ops:[{op:'update',id:'sample-card',patch:{text:'Fresh independently chosen sample'}}]},undefined,ctx)
        return {undo:fixture.session.history.undo,process:fixture.processCalls,ack:fixture.ackCalls,
          text:JSON.parse(await app.vault.read(fixture.file)).nodes[0].text,
          trusted:fixture.trusted.length>=8&&fixture.trusted.every(event=>event.trusted)}
      `)
      expect(fresh).toEqual({
        undo: 1,
        process: 1,
        ack: 1,
        text: 'Fresh independently chosen sample',
        trusted: true,
      })
      console.info('Canvas local choice proof:', { fault, geometry, discarded, fresh })
    }
  )
})
