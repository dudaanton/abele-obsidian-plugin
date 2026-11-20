// @vitest-environment node
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { declaredTargets } from '../e2e/helpers/target'
import ts from 'typescript'
import {
  capturePhoneForegroundScene,
  terminatePhone,
  waitForPhoneBackground,
} from '../e2e/helpers/phoneProcess'
import {
  assertPhoneGateInventory,
  assertFreshPhoneLoad,
  phoneGateChunk,
} from '../e2e/helpers/syncPhoneGate'

const scene = {
  screen: [393, 852] as [number, number],
  frame: [0, 0, 393, 852] as [number, number, number, number],
}
const fullReply = '{"exists":true,"frame":[0,0,393,852]}'
const zeroReply = '{"exists":true,"frame":[0,0,0,0]}'

it('accepts the measured full-screen scene becoming a zero-frame offscreen icon', async () => {
  const foreground = capturePhoneForegroundScene((args) =>
    args[1] === '/status' ? '{"screen":[393,852]}' : '{"exists":true,"frame":[0,0,393,852]}'
  )
  await expect(
    waitForPhoneBackground({
      foreground,
      run: () => '{"exists":true,"frame":[0,0,0,0]}',
      report: () => {},
    })
  ).resolves.toMatchObject({ frame: [0, 0, 0, 0] })
})

it('requires a full-screen foreground scene before Home', () => {
  expect(() =>
    capturePhoneForegroundScene((args) =>
      args[1] === '/status' ? '{"screen":[393,852]}' : zeroReply
    )
  ).toThrow(/not full-screen.*frame=\[0,0,0,0\]/)
  expect(
    capturePhoneForegroundScene((args) =>
      args[1] === '/status' ? '{"screen":[393,852]}' : fullReply
    )
  ).toEqual(scene)
})

it('rejects invalid frames and stale app state as background evidence', async () => {
  for (const reply of ['{"exists":true,"frame":[0,0,-1,0]}', '{"state":4}'])
    await expect(
      waitForPhoneBackground({ foreground: scene, run: () => reply, report: () => {} })
    ).rejects.toThrow('Invalid native scene')
  await expect(
    waitForPhoneBackground({
      foreground: { screen: scene.screen, frame: [0, 0, 0, 0] },
      run: () => zeroReply,
    })
  ).rejects.toThrow('not full-screen before Home')
})

it('witnesses the SpringBoard scene transition even when native app state stays foreground', async () => {
  const calls: string[][] = []
  const witness = await waitForPhoneBackground({
    foreground: scene,
    run: (args) => {
      calls.push(args)
      return '{"exists":true,"frame":[0,0,0,0],"state":4}'
    },
    report: () => {},
  })
  expect(witness).toMatchObject({ witness: 'springboard-scene-frame', frame: [0, 0, 0, 0] })
  expect(calls.map((args) => args[1])).toEqual(['/exists'])
  expect(JSON.parse(calls[0][2])).toMatchObject({
    bundle: 'com.apple.springboard',
    label: 'Obsidian',
  })
})

it('allows a slow scene reply to finish inside the overall background deadline', async () => {
  let now = 0,
    calls = 0
  const state = await waitForPhoneBackground({
    foreground: scene,
    run: (args, budget) => {
      if (++calls === 1) return fullReply
      now += Math.min(7000, budget!)
      if (budget! < 7000)
        throw Object.assign(new Error('spawnSync iphone ETIMEDOUT'), { code: 'ETIMEDOUT' })
      return zeroReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-scene-frame')
  expect(now).toBe(7250)
  expect(calls).toBe(2)
})

it('reports the deadline and both scene frames when a native query times out', async () => {
  let now = 0,
    calls = 0
  await expect(
    waitForPhoneBackground({
      foreground: scene,
      run: (_args, budget) => {
        if (++calls === 1) return fullReply
        now += budget!
        throw Object.assign(new Error('spawnSync iphone ETIMEDOUT'), { code: 'ETIMEDOUT' })
      },
      now: () => now,
      pause: async (ms) => {
        now += ms
      },
      report: () => {},
    })
  ).rejects.toThrow(/20000ms.*foreground frame=\[0,0,393,852\].*last frame=\[0,0,393,852\]/)
  expect(now).toBe(20000)
})

it('retries only a timed-out observation while time remains without repeating Home or launching', async () => {
  let now = 0,
    calls = 0
  const state = await waitForPhoneBackground({
    foreground: scene,
    run: (args) => {
      expect(args[0]).toBe('call')
      expect(args[1]).toBe('/exists')
      if (++calls === 1) return fullReply
      if (calls === 2) {
        now += 6000
        throw Object.assign(new Error('native state timeout'), { code: 'ETIMEDOUT' })
      }
      return zeroReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-scene-frame')
  expect(calls).toBe(3)
  expect(now).toBeLessThan(20000)
})

it('does not accept a background reply received after the deadline or hide transport errors', async () => {
  let now = 0
  await expect(
    waitForPhoneBackground({
      foreground: scene,
      run: () => {
        now = 21000
        return zeroReply
      },
      now: () => now,
      report: () => {},
    })
  ).rejects.toThrow('20000ms')
  await expect(
    waitForPhoneBackground({
      foreground: scene,
      run: () => {
        throw new Error('runner unavailable')
      },
    })
  ).rejects.toThrow('runner unavailable')
})

it('waits for a delayed scene transition and reports frames without querying app state', async () => {
  let now = 0
  const calls: string[][] = []
  const state = await waitForPhoneBackground({
    foreground: scene,
    run: (args) => {
      calls.push(args)
      return now < 12000 ? fullReply : zeroReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-scene-frame')
  expect(now).toBe(12000)
  expect(
    calls.every(
      (args) =>
        args[0] === 'call' &&
        args[1] === '/exists' &&
        JSON.parse(args[2]).bundle === 'com.apple.springboard'
    )
  ).toBe(true)
})

it('never substitutes foreground, stopped or malformed state replies for a scene frame', async () => {
  for (const reply of ['{"state":4}', '{"state":1}', '{}']) {
    let now = 0
    await expect(
      waitForPhoneBackground({
        foreground: scene,
        run: () => reply,
        now: () => now,
        pause: async (ms) => {
          now += ms
        },
        report: () => {},
      })
    ).rejects.toThrow(/native scene/)
    expect(now).toBeLessThanOrEqual(20000)
  }
})

it('uses kill only when advertised and requires a confirmed stopped process', () => {
  const calls: string[][] = []
  const run = (args: string[]) => {
    calls.push(args)
    if (args[0] === '--help') return 'iphone kill BUNDLE'
    if (args[0] === 'kill') return '{"ok":true}'
    return '{"state":1}'
  }
  expect(terminatePhone(run)).toEqual({ killed: true, state: 1 })
  expect(calls).toEqual([
    ['--help'],
    ['kill', 'md.obsidian'],
    ['call', '/state', '{"bundle":"md.obsidian"}'],
  ])
  expect(() => terminatePhone(() => 'iphone launch BUNDLE')).toThrow('kill capability')
  let now = 0
  expect(() =>
    terminatePhone(
      (args) =>
        args[0] === '--help'
          ? 'iphone kill BUNDLE'
          : args[0] === 'kill'
            ? '{"ok":true}'
            : '{"state":4}',
      {
        now: () => now,
        pause: (ms) => {
          now += ms
        },
      }
    )
  ).toThrow(/notRunning within 5000ms; last state=4/)
  expect(() =>
    terminatePhone((args) => {
      if (args[0] === '--help') return 'iphone kill BUNDLE'
      throw new Error('unknown path /terminate')
    })
  ).toThrow('device runner')
})

it('retries a delayed native stopped state after a successful kill reply', () => {
  let now = 0
  let stateReads = 0
  const result = terminatePhone(
    (args) => {
      if (args[0] === '--help') return 'iphone kill BUNDLE'
      if (args[0] === 'kill') return '{"ok":true}'
      stateReads += 1
      return stateReads < 3 ? '{"state":4}' : '{"state":1}'
    },
    {
      now: () => now,
      pause: (ms) => {
        now += ms
      },
    }
  )
  expect(result).toEqual({ killed: true, state: 1 })
  expect(stateReads).toBe(3)
  expect(now).toBe(500)
})

it('does not accept a stopped-state reply that arrives after the kill deadline', () => {
  let now = 0
  expect(() =>
    terminatePhone(
      (args) => {
        if (args[0] === '--help') return 'iphone kill BUNDLE'
        if (args[0] === 'kill') return '{"ok":true}'
        now = 6000
        return '{"state":1}'
      },
      { now: () => now }
    )
  ).toThrow(/notRunning within 5000ms/)
})

it('rejects missing, extra and corrupt files on each replica', () => {
  const expected = [{ path: 'fixture/sample.bin', sha: 'abc', size: 3 }]
  for (const actual of [
    [],
    [...expected, { path: 'extra', sha: 'abc', size: 3 }],
    [{ ...expected[0], sha: 'bad' }],
  ])
    expect(() => assertPhoneGateInventory(expected, actual)).toThrow()
  expect(() => assertPhoneGateInventory(expected, expected)).not.toThrow()
})
it('requires a replaced page rather than accepting a foreground-only launch', () => {
  expect(() => assertFreshPhoneLoad(100, 100)).toThrow()
  expect(() => assertFreshPhoneLoad(100, 200)).not.toThrow()
})

it('creates distinct synthetic files and preserves chunk boundaries', () => {
  const whole = phoneGateChunk(1, 0, 8192)
  expect(whole).not.toEqual(phoneGateChunk(257, 0, 8192))
  expect(whole.slice(4096)).toEqual(phoneGateChunk(1, 4096, 4096))
  expect(whole.every((byte) => byte >= 32 && byte < 127)).toBe(true)
})

it('selects the gate for the real phone batch', () => {
  const source = readFileSync('tests/e2e/syncPhoneGate.e2e.test.ts', 'utf8')
  expect(declaredTargets(source)).toEqual(['phone'])
})

it('parses every serialized page action as an async browser script', () => {
  const source = readFileSync('tests/e2e/syncPhoneGate.e2e.test.ts', 'utf8')
  const tree = ts.createSourceFile('gate.ts', source, ts.ScriptTarget.Latest, true)
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  let scripts = 0
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const argument = node.arguments[method === 'long' ? 1 : 0]
      if (['long', 'run'].includes(method) && argument) {
        const script = ts.isTemplateExpression(argument)
          ? argument.head.text +
            argument.templateSpans.map((span) => 'null' + span.literal.text).join('')
          : ts.isStringLiteralLike(argument)
            ? argument.text
            : undefined
        if (script !== undefined) {
          expect(() => new AsyncFunction(script)).not.toThrow()
          scripts++
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(scripts).toBeGreaterThan(8)
})
