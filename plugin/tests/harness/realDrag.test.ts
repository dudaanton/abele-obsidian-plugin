// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { realDrag } from '../e2e/helpers/githubLive'
import { evalRaw, runCli } from '../e2e/helpers/obsidianCli'
import { withNativeInput } from '../e2e/helpers/nativeInput'

vi.mock('../e2e/helpers/obsidianCli', () => ({ evalRaw: vi.fn(), runCli: vi.fn() }))
vi.mock('../e2e/helpers/nativeInput', () => ({ withNativeInput: vi.fn() }))

const from = { x: 20, y: 30 }
const to = { x: 100, y: 70 }
let selected: boolean
let events: Record<string, unknown>[]
let failType: string | undefined
let inLane: boolean

beforeEach(() => {
  vi.resetAllMocks()
  selected = true
  events = []
  failType = undefined
  inLane = false
  vi.mocked(withNativeInput).mockImplementation(async (sequence) => {
    inLane = true
    try {
      return await sequence()
    } finally {
      inLane = false
    }
  })
  vi.mocked(evalRaw).mockImplementation((script) => {
    expect(inLane).toBe(true)
    const removeAllRanges = vi.fn(() => {
      selected = false
    })
    new Function('window', `return ${script}`)({ getSelection: () => ({ removeAllRanges }) })
    expect(removeAllRanges).toHaveBeenCalledOnce()
    return ''
  })
  vi.mocked(runCli).mockImplementation((args) => {
    expect(inLane).toBe(true)
    expect(args[1]).toBe('method=Input.dispatchMouseEvent')
    const event = JSON.parse(args[2].slice('params='.length))
    events.push(event)
    if (event.type === 'mousePressed' && selected) throw new Error('native selection drag started')
    if (event.type === failType && event.buttons === 1) throw new Error('input response lost')
    if (event.type === 'mouseReleased') selected = true
    return ''
  })
})

it('clears an existing selection before each real-input selection gesture', async () => {
  await realDrag(from, to)
  await realDrag(from, to)
  const gesture = [
    { type: 'mouseMoved', ...from, button: 'none' },
    { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 },
    ...[0.25, 0.5, 0.75, 1].map((t) => ({
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      button: 'left',
      buttons: 1,
    })),
    { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 },
  ]
  expect(events).toEqual([...gesture, ...gesture])
  expect(evalRaw).toHaveBeenCalledTimes(2)
  expect(inLane).toBe(false)
})

it.each(['mousePressed', 'mouseMoved'])('releases after a lost %s response', async (type) => {
  // Isolate cleanup from the stale-selection failure covered above.
  selected = false
  failType = type
  await expect(realDrag(from, to)).rejects.toThrow('input response lost')
  expect(events.at(-1)).toEqual({
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  expect(inLane).toBe(false)
})
