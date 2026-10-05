import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'
import * as diagnostics from '../e2e/helpers/canvasPublicationDiagnostics'
import {
  canvasControlFailure,
  canvasDispatchOnce,
  canvasProbeOnce,
} from '../e2e/helpers/canvasPublicationDiagnostics'
import { publicationControlPreparation } from '../e2e/helpers/canvasPublicationReview'

/** Execute the actual dedicated suite's capture body with controlled transports/clock. */
function liveCapture(
  options: {
    phone?: boolean
    launch?: () => unknown
    read?: (code: string, allowance: number) => unknown
    screenshot?: () => void
    observe?: () => unknown
  } = {}
) {
  const source = readFileSync(
    resolve(__dirname, '../e2e/canvasPublicationReview.e2e.test.ts'),
    'utf8'
  )
  const declaration = source.slice(
    source.indexOf('const shoot = '),
    source.indexOf('\nconst measure = ')
  )
  const expression = transformSync(`(()=>{${declaration};return shoot})()`, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
  }).code
  const launch = vi.fn(options.launch ?? (() => 'sample-capture')),
    read = vi.fn(options.read ?? (() => ({ done: true, stage: 'completed' }))),
    screenshot = vi.fn(options.screenshot ?? (() => {})),
    observe = vi.fn(options.observe ?? (() => ({ sample: true }))),
    record = vi.fn()
  const factory = new Function(
    'onPhone',
    'screenshot',
    'observe',
    'CanvasProbeError',
    'record',
    'attempt',
    'caseName',
    'sequence',
    'SHOTS',
    'run',
    'PUBLICATION_DIAGNOSTICS',
    'evalJsonIdempotent',
    'expect',
    'canvasCapturePhoneOnce',
    'canvasObserveCaptureJob',
    `return ${expression}`
  )
  const extra = diagnostics as unknown as Record<string, unknown>
  const shoot = factory(
    () => options.phone ?? false,
    screenshot,
    observe,
    diagnostics.CanvasProbeError,
    record,
    'sample-attempt',
    'sample-case',
    0,
    'sample-shots',
    launch,
    '',
    read,
    expect,
    extra.canvasCapturePhoneOnce,
    extra.canvasObserveCaptureJob
  ) as (name: string) => Promise<void>
  return { shoot, launch, read, screenshot, observe, record }
}

const ready = {
  present: true,
  connected: true,
  owned: true,
  animating: false,
  inViewport: true,
  hittable: true,
}
describe('Canvas publication probe phase boundaries', () => {
  it('preserves a primary screenshot failure and secondary diagnostic failure in the actual phone branch', async () => {
    const primary = new Error('Sample screenshot failure'),
      secondary = new Error('Sample observer failure')
    const live = liveCapture({
      phone: true,
      screenshot: () => {
        throw primary
      },
      observe: () => {
        throw secondary
      },
    })
    await expect(live.shoot('sample')).rejects.toMatchObject({
      phase: 'capture-reply-unknown',
      cause: primary,
      diagnosticError: secondary,
    })
    expect(live.screenshot).toHaveBeenCalledOnce()
    expect(live.observe).toHaveBeenCalledOnce()
    expect(live.launch).not.toHaveBeenCalled()
  })
  it('preserves the capture timeout and secondary diagnostic failure in the actual desktop exit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const secondary = new Error('Sample deadline observer failure'),
        live = liveCapture({
          launch: () => {
            vi.setSystemTime(45_001)
            return 'sample-capture'
          },
          observe: () => {
            throw secondary
          },
        })
      await expect(live.shoot('sample')).rejects.toMatchObject({
        phase: 'capture-await',
        cause: expect.objectContaining({ message: expect.stringContaining('45-second ceiling') }),
        diagnosticError: secondary,
      })
      expect(live.launch).toHaveBeenCalledOnce()
      expect(live.read).not.toHaveBeenCalled()
      expect(live.observe).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not start a three-attempt minimum-1000ms query group with only 600ms remaining', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const live = liveCapture({
        launch: () => {
          vi.setSystemTime(44_400)
          return 'sample-capture'
        },
        read: () => {
          vi.setSystemTime(45_400)
          return { done: true, stage: 'completed' }
        },
      })
      await expect(live.shoot('sample')).rejects.toMatchObject({ phase: 'capture-await' })
      expect(live.launch).toHaveBeenCalledOnce()
      expect(live.read).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects a completed capture returned beyond the absolute deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const live = liveCapture({
        read: () => {
          vi.setSystemTime(45_001)
          return { done: true, stage: 'completed' }
        },
      })
      await expect(live.shoot('sample')).rejects.toMatchObject({ phase: 'capture-await' })
      expect(live.launch).toHaveBeenCalledOnce()
      expect(live.read).toHaveBeenCalledOnce()
      expect(live.record.mock.calls.some(([phase]) => phase === 'capture-completed')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('admits a minimum-sized query group and completed result within the absolute budget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const live = liveCapture({
        launch: () => {
          vi.setSystemTime(41_999)
          return 'sample-capture'
        },
        read: (_code, allowance) => {
          expect(allowance).toBe(1000)
          vi.setSystemTime(44_999)
          return { done: true, stage: 'completed' }
        },
      })
      await expect(live.shoot('sample')).resolves.toBeUndefined()
      expect(live.launch).toHaveBeenCalledOnce()
      expect(live.read).toHaveBeenCalledOnce()
      expect(live.observe).not.toHaveBeenCalled()
      expect(live.record.mock.calls.some(([phase]) => phase === 'capture-completed')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('wires selector and hit-test diagnostics into the actual Canvas browser preparation', async () => {
    expect(typeof publicationControlPreparation).toBe('function')
    const script = publicationControlPreparation(
      'document.querySelector("#sample-missing")',
      'sample selector'
    )
    expect(script).toContain('canvasControlFailure')
    expect(script).toContain('selector')
    expect(script).toContain('hittability')
  })
  it('prepares the live owned modal selector in the same browser namespace as the dedicated suite', async () => {
    const root = document.createElement('div'),
      summary = document.createElement('summary')
    root.className = 'abele-canvas-publication-review'
    summary.textContent = 'Sample disclosure'
    root.append(summary)
    document.body.append(root)
    Object.assign(root, { getAnimations: () => [] })
    vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 20,
      right: 120,
      bottom: 60,
      width: 100,
      height: 40,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    })
    const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(summary),
      win = window as unknown as { __canvasPublicationReviewFixture?: unknown }
    win.__canvasPublicationReviewFixture = {
      ids: new WeakMap(),
      nextId: 0,
      events: [],
      captures: {},
      view: { publicationReviewModal: { modalEl: root }, containerEl: root },
    }
    vi.useFakeTimers()
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
        body: string
      ) => () => Promise<{ ready: boolean; phase: string | null }>
      const preparing = new AsyncFunction(
        publicationControlPreparation('modal()?.querySelector("summary")', 'sample disclosure')
      )()
      const resultPromise = expect(preparing).resolves.toMatchObject({ ready: true, phase: null })
      await vi.runAllTimersAsync()
      await resultPromise
    } finally {
      vi.useRealTimers()
      hit.mockRestore()
      root.remove()
      delete win.__canvasPublicationReviewFixture
    }
  })

  it.each(['missing', 'blocked'] as const)(
    'returns a distinct browser %s failure without dispatch',
    async (kind) => {
      const root = document.createElement('div'),
        button = document.createElement('button')
      root.className = 'abele-canvas-publication-review'
      button.id = 'sample-control'
      root.append(button)
      document.body.append(root)
      Object.assign(root, { getAnimations: () => [] })
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        left: 20,
        top: 20,
        right: 120,
        bottom: 60,
        width: 100,
        height: 40,
        x: 20,
        y: 20,
        toJSON: () => ({}),
      })
      const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(root)
      const win = window as unknown as { __canvasPublicationReviewFixture?: unknown }
      win.__canvasPublicationReviewFixture = {
        ids: new WeakMap(),
        nextId: 0,
        events: [],
        captures: {},
        view: { publicationReviewModal: { modalEl: root }, containerEl: root },
      }
      vi.useFakeTimers()
      try {
        const selector =
          kind === 'missing'
            ? 'document.querySelector("#sample-missing")'
            : 'document.querySelector("#sample-control")'
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
          body: string
        ) => () => Promise<{ ready: boolean; phase: string; state: typeof ready }>
        const preparing = new AsyncFunction(
          publicationControlPreparation(selector, 'sample preparation')
        )()
        await vi.runAllTimersAsync()
        const result = await preparing,
          dispatch = vi.fn()
        expect(result.ready).toBe(false)
        expect(result.phase).toBe(kind === 'missing' ? 'selector' : 'hittability')
        await expect(canvasDispatchOnce(result.state, dispatch, () => null)).rejects.toMatchObject({
          phase: result.phase,
        })
        expect(dispatch).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
        hit.mockRestore()
        root.remove()
        delete win.__canvasPublicationReviewFixture
      }
    }
  )

  it.each([
    ['selector', { present: false }],
    ['selector', { connected: false }],
    ['ownership', { owned: false }],
    ['animation', { animating: true }],
    ['hittability', { hittable: false }],
    ['hittability', { inViewport: false }],
  ] as const)('stops %s before any native dispatch', async (phase, change) => {
    const dispatch = vi.fn(),
      observe = vi.fn()
    await expect(
      canvasDispatchOnce({ ...ready, ...change }, dispatch, observe)
    ).rejects.toMatchObject({ phase })
    expect(dispatch).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
  })
  it('keeps an unanswered native call failed/unknown even when readonly evidence shows delivery', async () => {
    const primary = new Error('Sample native reply missing'),
      invoke = vi.fn(() => {
        throw primary
      }),
      observe = vi.fn(() => ({ events: ['pointerdown', 'pointerup', 'click'], confirmation: true }))
    await expect(canvasDispatchOnce(ready, invoke, observe)).rejects.toMatchObject({
      phase: 'native-reply-unknown',
      cause: primary,
    })
    expect(invoke).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledOnce()
  })
  it('retains the first primary error when diagnostic collection also fails', async () => {
    const primary = new Error('Sample native primary'),
      secondary = new Error('Sample diagnostic failure'),
      invoke = vi.fn(() => {
        throw primary
      })
    await expect(
      canvasProbeOnce('native-reply-unknown', invoke, () => {
        throw secondary
      })
    ).rejects.toMatchObject({ cause: primary, diagnosticError: secondary })
    expect(invoke).toHaveBeenCalledOnce()
  })
  it.each(['capture-await', 'capture-png', 'capture-write', 'capture-launch-unknown'] as const)(
    'never repeats an uncertain %s operation to obtain a passing result',
    async (phase) => {
      const invoke = vi.fn(() => {
        throw new Error('Sample capture failure')
      })
      await expect(canvasProbeOnce(phase, invoke, () => ({ stage: phase }))).rejects.toMatchObject({
        phase,
      })
      expect(invoke).toHaveBeenCalledOnce()
    }
  )
  it('permits one delivered confirmation transition only after exact control admission', async () => {
    let modal = 'review'
    const dispatch = vi.fn(() => {
      modal = 'confirmation'
      return modal
    })
    expect(canvasControlFailure(ready)).toBeNull()
    expect(await canvasDispatchOnce(ready, dispatch, () => ({ modal }))).toBe('confirmation')
    expect(dispatch).toHaveBeenCalledOnce()
  })
})
