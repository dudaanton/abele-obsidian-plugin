import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { scriptButtonCommand, withScriptButtonInput } from '../e2e/helpers/scriptButtonInput'

const lane = vi.hoisted(() => ({ held: false }))
vi.mock('../e2e/helpers/nativeInput', () => ({
  withNativeInput: async (run: () => Promise<unknown>) => {
    expect(lane.held).toBe(false)
    lane.held = true
    try {
      return await run()
    } finally {
      lane.held = false
    }
  },
}))

const source = readFileSync(resolve(__dirname, '../e2e/scriptViewButtons.e2e.test.ts'), 'utf8')

it('holds the shared native input lane through hover measurement and touch cleanup', () => {
  // Competing pool windows can clear hover between dispatch and measurement, or steal
  // touch ownership between down and up. Enclose each whole assertion case in the lane.
  expect(source.match(/withScriptButtonInput\(probe, async \(\) => \{/g)).toHaveLength(2)
  expect(source).not.toContain("'dev:cdp'")
})

function renderer(attached = false) {
  const t: Record<string, unknown> = {}
  const api = {
    isAttached: () => attached,
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    sendCommand: vi.fn(async (_method: string, _params: object) => {
      expect(lane.held).toBe(true)
    }),
  }
  const probe = async <T>(body: string): Promise<T> => {
    expect(lane.held).toBe(true)
    const run = new Function('require', 'window', `return (async () => { ${body} })()`)
    return run(() => ({ getCurrentWebContents: () => ({ debugger: api }) }), { __abeleTest: t })
  }
  return { probe, api, t }
}

it('keeps touch down, touch up and paint measurement in one attached input session', async () => {
  const { probe, api, t } = renderer()
  await withScriptButtonInput(probe, async () => {
    await scriptButtonCommand(probe, 'Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 10, y: 20 }],
    })
    expect(api.isAttached()).toBe(true)
    expect(api.detach).not.toHaveBeenCalled()
    await scriptButtonCommand(probe, 'Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    // Reading paint must retain the lane, even after the native gesture has ended.
    expect(lane.held).toBe(true)
    expect(api.isAttached()).toBe(true)
  })
  expect(api.attach).toHaveBeenCalledOnce()
  expect(api.detach).toHaveBeenCalledOnce()
  expect(t).toEqual({})
  expect(lane.held).toBe(false)
})

it('cancels a possibly delivered touch after a lost down response, without replaying it', async () => {
  const { probe, api, t } = renderer()
  api.sendCommand.mockRejectedValueOnce(new Error('lost input response'))
  await expect(
    withScriptButtonInput(probe, async () => {
      await scriptButtonCommand(probe, 'Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 10, y: 20 }],
      })
    })
  ).rejects.toThrow('lost input response')
  expect(api.sendCommand.mock.calls).toEqual([
    ['Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 10, y: 20 }] }],
    ['Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }],
    ['Emulation.setTouchEmulationEnabled', { enabled: false }],
  ])
  expect(api.detach).toHaveBeenCalledOnce()
  expect(t).toEqual({})
  expect(lane.held).toBe(false)
})

it('releases the lane on assertion failure without detaching an existing debugger', async () => {
  const { probe, api } = renderer(true)
  await expect(
    withScriptButtonInput(probe, async () => {
      throw new Error('hover paint differs')
    })
  ).rejects.toThrow('hover paint differs')
  expect(api.sendCommand).toHaveBeenCalledWith('Emulation.setTouchEmulationEnabled', {
    enabled: false,
  })
  expect(api.attach).not.toHaveBeenCalled()
  expect(api.detach).not.toHaveBeenCalled()
  expect(lane.held).toBe(false)
})

it('detaches and releases the lane even when touch cancellation fails', async () => {
  const { probe, api, t } = renderer()
  await expect(
    withScriptButtonInput(probe, async () => {
      await scriptButtonCommand(probe, 'Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 10, y: 20 }],
      })
      api.sendCommand.mockRejectedValueOnce(new Error('cancel failed'))
      throw new Error('assertion failed')
    })
  ).rejects.toThrow('cancel failed')
  expect(api.sendCommand).toHaveBeenLastCalledWith('Emulation.setTouchEmulationEnabled', {
    enabled: false,
  })
  expect(api.detach).toHaveBeenCalledOnce()
  expect(t).toEqual({})
  expect(lane.held).toBe(false)
})
