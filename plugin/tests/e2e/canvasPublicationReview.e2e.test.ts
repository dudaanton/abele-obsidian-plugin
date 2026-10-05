import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalAsync, realClick } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { screenshot, tap } from './helpers/phone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import {
  CanvasProbeError,
  canvasDispatchOnce,
  type CanvasControlState,
} from './helpers/canvasPublicationDiagnostics'
import {
  PUBLICATION_SETUP,
  PUBLICATION_PRELUDE,
  PUBLICATION_CASE_CLEANUP,
  PUBLICATION_CLEANUP,
  PUBLICATION_MEASURE,
  PUBLICATION_DIAGNOSTICS,
  publicationControlPreparation,
  publicationFault,
} from './helpers/canvasPublicationReview'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi(),
  SHOTS = shotDir('canvas-publication-review'),
  mobile = process.env.CANVAS_PUBLICATION_MOBILE === '1',
  attempt = `attempt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
const chronology: unknown[] = []
let caseName = 'setup',
  sequence = 0,
  primary: unknown = null
const record = (phase: string, data: unknown = {}) => {
  chronology.push({
    attempt,
    case: caseName,
    sequence: sequence++,
    phase,
    at: new Date().toISOString(),
    data,
  })
  writeFileSync(`${SHOTS}/${attempt}-chronology.json`, JSON.stringify(chronology, null, 2) + '\n')
}
const errorData = (error: unknown): unknown =>
  error instanceof CanvasProbeError
    ? {
        phase: error.phase,
        message: error.message,
        cause: errorData(error.cause),
        snapshot: error.snapshot,
        diagnosticError: errorData(error.diagnosticError),
      }
    : error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : (error ?? null)
const run = <T>(body: string, timeout = 45_000): T =>
  evalAsync<T>(`(async()=>JSON.stringify(await(async()=>{${body}})()))()`, timeout)
const inside = <T>(body: string): T => run<T>(`${PUBLICATION_PRELUDE}${body}`)
const observe = () => run(`${PUBLICATION_DIAGNOSTICS} return snapshot(null)`, 5_000)

const press = async (selector: string, label: string) => {
  record('control-preparation', { label, selector })
  const control = run<{
    ready: boolean
    phase: 'selector' | 'ownership' | 'animation' | 'hittability'
    state: CanvasControlState
    snapshot: unknown
    point: { x: number; y: number }
    target: number
    modal: number | null
  }>(publicationControlPreparation(selector, label))
  record('control-observed', control)
  if (!control.ready)
    throw new CanvasProbeError(
      control.phase,
      new Error(`Control preparation failed: ${label}`),
      control.snapshot
    )
  record('native-issued', {
    label,
    point: control.point,
    target: control.target,
    modal: control.modal,
    requested: onPhone()
      ? 'one driver tap'
      : 'unchanged helper moved/pressed/released; individual request-await step is not exposed',
  })
  await canvasDispatchOnce(
    control.state,
    async () => {
      if (onPhone()) tap(control.point.x, control.point.y)
      else await realClick(control.point.x, control.point.y)
    },
    observe
  )
  record('native-replied', { label })
  // A reply is not proof that the intended control received a click. Observe, never replay.
  const delivered = inside<unknown>(`
    await until(()=>fixture.events.some(event=>event.operation===${JSON.stringify(label)}&&event.type==='click'&&event.trusted&&event.path.includes(${control.target})), 'native-delivery')
    return fixture.events.filter(event=>event.operation===${JSON.stringify(label)})
  `)
  record('native-delivery-observed', { label, events: delivered })
}
const button = (text: string) =>
  `[...(modal()?.querySelectorAll('button')??[])].find(el=>el.textContent===${JSON.stringify(text)})`
const action = `window.__canvasPublicationReviewFixture?.view?.containerEl.querySelector('[aria-label="Recover failed canvas change"]')`

const shoot = async (name: string) => {
  const id = `${attempt}-${caseName}-${sequence}-${name}`,
    path = `${SHOTS}/${id}.png`
  record('capture-issued', { id, path })
  if (onPhone()) {
    try {
      screenshot(path)
    } catch (cause) {
      throw new CanvasProbeError('capture-reply-unknown', cause, observe())
    }
    record('capture-completed', { id, path })
    return
  }
  const deadline = Date.now() + 45_000
  try {
    // Launch exactly once. Capture completion is observed by readonly job reads, not by rerunning eval.
    run(`${PUBLICATION_DIAGNOSTICS}
      const id=${JSON.stringify(id)},path=${JSON.stringify(path)}
      const job=f.captures[id]={stage:'scheduled',path,started:performance.now(),before:snapshot(null)}
      setTimeout(async()=>{
        try {
          job.stage='capture-await'
          const image=await require('@electron/remote').getCurrentWebContents().capturePage()
          job.stage='capture-png';const png=image.toPNG()
          job.stage='capture-write';require('fs').writeFileSync(path,png)
          job.stage='completed';job.bytes=png.length;job.after=snapshot(null)
        }catch(error){job.error=String(error?.message??error)}
        job.done=true;job.ended=performance.now()
      },100)
      return id
    `)
  } catch (cause) {
    let snapshot: unknown = null,
      diagnosticError: unknown = null
    try {
      snapshot = observe()
    } catch (error) {
      diagnosticError = error
    }
    throw new CanvasProbeError('capture-launch-unknown', cause, snapshot, diagnosticError)
  }
  while (Date.now() < deadline) {
    let job: { done?: boolean; stage?: string; error?: string } | null
    try {
      job = run(
        `const f=window.__canvasPublicationReviewFixture;return f?.captures[${JSON.stringify(id)}]??null`,
        Math.min(5_000, deadline - Date.now())
      )
    } catch (cause) {
      throw new CanvasProbeError('capture-reply-unknown', cause)
    }
    if (job?.done) {
      record('capture-result', { id, job })
      if (job.error)
        throw new CanvasProbeError(
          job.stage as 'capture-await' | 'capture-png' | 'capture-write',
          new Error(job.error),
          job
        )
      expect(job.stage).toBe('completed')
      record('capture-completed', { id, path })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new CanvasProbeError(
    'capture-await',
    new Error('One capture did not complete within the existing 45-second ceiling'),
    observe()
  )
}
const measure = () => {
  const result = run<{
    cuts: string[]
    outside: string[]
    paintedCuts: string[]
    viewport: { width: number; height: number }
    bodyOverflow: boolean
  }>(PUBLICATION_MEASURE)
  expect(result.cuts).toEqual([])
  expect(result.outside).toEqual([])
  expect(result.paintedCuts).toEqual([])
  expect(result.bodyOverflow).toBe(false)
  if (mobile && !onPhone()) expect(result.viewport).toEqual({ width: 390, height: 844 })
  inside(`modal().querySelector('.abele-modal__body').scrollTop=0;return true`)
  record('geometry', result)
  return result
}
const confirmation = () =>
  inside(
    `await until(()=>modal()?.textContent.includes('does not undo'), 'confirmation-transition');return true`
  )

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
      const bytes=await app.vault.adapter.readBinary(app.vault.configDir+'/plugins/abele/main.js'),digest=await crypto.subtle.digest('SHA-256',bytes)
      return {hash:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join(''),api:!!window.__abeleTest}
    `)
    expect(identity).toEqual({ hash: expected, api: true })
    record('installed-candidate', identity)
    console.info('Installed candidate identity:', identity)
    run(PUBLICATION_SETUP)
    owned = true
  })
  afterEach(() => {
    if (!owned) return
    try {
      run(PUBLICATION_CASE_CLEANUP)
      record('case-cleanup', { restored: true })
    } catch (error) {
      record('case-cleanup-failed', errorData(error))
      if (!primary) throw error
    }
  })
  afterAll(async () => {
    if (owned) {
      const cleanup = run(PUBLICATION_CLEANUP)
      record('fixture-cleanup', cleanup)
      console.info('Canvas fixture cleanup:', cleanup)
    }
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
      caseName = fault
      primary = null
      try {
        const outcome = run<{ outcome: string; source: string; status: string }>(
          publicationFault(fault)
        )
        record('fault-admitted', outcome)
        expect(outcome.outcome).toBe(
          fault === 'digest' ? 'written-acknowledgment-pending' : 'unknown'
        )
        expect(outcome.status).toMatch(
          fault === 'digest' ? /write was confirmed/i : /outcome is uncertain/i
        )
        const openReview = async (label: string) => {
          await press(action, label)
          inside(`await until(()=>modal(), 'review-transition');return true`)
        }
        const preserved = () => {
          const state = inside<{ same: boolean; source: boolean; process: number; ack: number }>(
            `return {same:retained()===fixture.retained,source:await app.vault.read(fixture.file)===fixture.before,process:fixture.processCalls,ack:fixture.ackCalls}`
          )
          expect(state).toEqual({ same: true, source: true, process: 0, ack: 0 })
          record('keep-invariants', state)
        }
        await openReview('open-initial')
        expect(
          inside<string>(`return modal().querySelector('[data-review="source"]').textContent`)
        ).toBe(outcome.source)
        expect(
          inside<string>(`return modal().querySelector('[data-review="proposed"]').textContent`)
        ).toContain('Retained proposed sample')
        expect(
          inside<string>(`return modal().querySelector('[data-review="baseline"]').textContent`)
        ).toContain('Original persisted sample')
        expect(
          inside<string>(`return [...modal().querySelectorAll('summary')].at(-1).textContent`)
        ).toBe('Original baseline (historical)')
        const geometry = measure()
        await shoot('review')
        await press(`modal()?.querySelector('summary')`, 'source-expand')
        measure()
        await shoot('source-expanded')
        await press(`modal()?.querySelector('summary')`, 'source-collapse')
        preserved()
        await press(button('Keep retained work'), 'keep')
        inside(`await until(()=>!modal(), 'keep-close');return true`)
        expect(inside<boolean>(`return !modal()`)).toBe(true)
        preserved()
        await openReview('open-cancel')
        await press(button('Discard local pending copy…'), 'confirm-first')
        confirmation()
        expect(inside<string>(`return modal().textContent`)).toMatch(/does not undo/i)
        if (fault === 'digest')
          expect(inside<string>(`return modal().textContent`)).toMatch(/does not reconstruct/i)
        measure()
        await shoot('confirmation-first')
        await press(button('Cancel'), 'cancel')
        inside(`await until(()=>!modal(), 'cancel-close');return true`)
        expect(inside<boolean>(`return !modal()`)).toBe(true)
        preserved()
        await openReview('open-final')
        await press(button('Discard local pending copy…'), 'confirm-final')
        confirmation()
        record('final-confirmation-live', observe())
        measure()
        await shoot('confirmation-final')
        await press(button('Discard local pending copy'), 'discard-affirmative')
        const discarded = inside<{
          same: boolean
          dirty: boolean
          evidence: boolean
          undo: number
          process: number
          ack: number
        }>(`
          await until(()=>!modal(), 'discard-close');return {same:await app.vault.read(fixture.file)===fixture.before,dirty:fixture.session.dirty,evidence:fixture.session.publicationEvidence===null,
            undo:fixture.session.history.undo,process:fixture.processCalls,ack:fixture.ackCalls}
        `)
        expect(discarded).toEqual({
          same: true,
          dirty: false,
          evidence: true,
          undo: 0,
          process: 0,
          ack: 0,
        })
        record('discard-invariants', discarded)
        const fresh = inside<{
          undo: number
          process: number
          ack: number
          text: string
          trusted: boolean
        }>(`
          const current=await read()
          await tools.canvas_edit.execute('sample-fresh',{path:fixture.path,revision:current.revision,ops:[{op:'update',id:'sample-card',patch:{text:'Fresh independently chosen sample'}}]},undefined,ctx)
          return {undo:fixture.session.history.undo,process:fixture.processCalls,ack:fixture.ackCalls,text:JSON.parse(await app.vault.read(fixture.file)).nodes[0].text,
            trusted:fixture.trusted.length>=8&&fixture.trusted.every(event=>event.trusted)}
        `)
        expect(fresh).toEqual({
          undo: 1,
          process: 1,
          ack: 1,
          text: 'Fresh independently chosen sample',
          trusted: true,
        })
        record('fresh-edit-invariants', fresh)
        console.info('Canvas local choice proof:', { fault, geometry, discarded, fresh })
      } catch (error) {
        primary = error
        // Preserve the first primary error before cleanup, even when readonly diagnostics fail.
        let snapshot: unknown = null,
          diagnosticError: unknown = null
        try {
          snapshot = observe()
        } catch (failure) {
          diagnosticError = errorData(failure)
        }
        record('first-primary-error', { error: errorData(error), snapshot, diagnosticError })
        throw error
      }
    }
  )
})
