import { describe, expect, it, vi } from 'vitest'
import {
  canvasControlFailure,
  canvasDispatchOnce,
  canvasProbeOnce,
} from '../e2e/helpers/canvasPublicationDiagnostics'
import { publicationControlPreparation } from '../e2e/helpers/canvasPublicationReview'

const ready = {
  present: true,
  connected: true,
  owned: true,
  animating: false,
  inViewport: true,
  hittable: true,
}
describe('Canvas publication probe phase boundaries', () => {
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
