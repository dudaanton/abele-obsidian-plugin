// @vitest-environment node
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { declaredTargets } from '../e2e/helpers/target'
import ts from 'typescript'
import {
  assertPhoneHomeScreenHidden,
  terminatePhone,
  waitForPhoneBackground,
} from '../e2e/helpers/phoneProcess'
import {
  assertPhoneGateInventory,
  assertFreshPhoneLoad,
  phoneGateChunk,
} from '../e2e/helpers/syncPhoneGate'

const iconSource = "Icon, 0x1, {{10, 20}, {60, 60}}, label: 'Obsidian'"
const iconReply = '{"exists":true,"frame":[10,20,60,60]}'

it('rejects an icon already exposed before Home instead of trusting an offscreen tree', () => {
  expect(() =>
    assertPhoneHomeScreenHidden((args) => (args[1] === '/source' ? iconSource : iconReply))
  ).toThrow('already exposed')
  expect(() => assertPhoneHomeScreenHidden(() => '{"exists":false,"frame":[]}')).not.toThrow()
})

it('rejects zero-size frames, non-icon labels, and stale app state as background evidence', async () => {
  for (const reply of ['{"exists":true,"frame":[0,0,0,0]}', '{"state":4}'])
    await expect(waitForPhoneBackground({ run: () => reply, report: () => {} })).rejects.toThrow(
      'Invalid native home icon'
    )
  let now = 0
  await expect(
    waitForPhoneBackground({
      run: (args) => (args[1] === '/source' ? "StaticText, label: 'Obsidian'" : iconReply),
      now: () => now,
      pause: async (ms) => {
        now += ms
      },
      report: () => {},
    })
  ).rejects.toThrow('20000ms')
})

it('witnesses the SpringBoard app icon even when native app state stays foreground', async () => {
  const calls: string[][] = []
  const witness = await waitForPhoneBackground({
    run: (args) => {
      calls.push(args)
      if (args[1] === '/source') return "Icon, 0x1, {{10, 20}, {60, 60}}, label: 'Obsidian'"
      return '{"exists":true,"frame":[10,20,60,60],"state":4}'
    },
    report: () => {},
  })
  expect(witness).toMatchObject({ witness: 'springboard-home-icon' })
  expect(calls.map((args) => args[1])).toEqual(['/exists', '/source'])
  expect(JSON.parse(calls[0][2])).toMatchObject({
    bundle: 'com.apple.springboard',
    label: 'Obsidian',
  })
})

it('allows a slow home icon reply to finish inside the overall background deadline', async () => {
  let now = 0,
    calls = 0
  const state = await waitForPhoneBackground({
    run: (args, budget) => {
      if (args[1] === '/source') return iconSource
      if (++calls === 1) return '{"exists":false,"frame":[]}'
      now += Math.min(7000, budget!)
      if (budget! < 7000)
        throw Object.assign(new Error('spawnSync iphone ETIMEDOUT'), { code: 'ETIMEDOUT' })
      return iconReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-home-icon')
  expect(now).toBe(7250)
  expect(calls).toBe(2)
})

it('reports the deadline and last icon observation when a native query times out', async () => {
  let now = 0,
    calls = 0
  await expect(
    waitForPhoneBackground({
      run: (_args, budget) => {
        if (++calls === 1) return '{"exists":false,"frame":[]}'
        now += budget!
        throw Object.assign(new Error('spawnSync iphone ETIMEDOUT'), { code: 'ETIMEDOUT' })
      },
      now: () => now,
      pause: async (ms) => {
        now += ms
      },
      report: () => {},
    })
  ).rejects.toThrow(/20000ms.*last home icon visible=false/)
  expect(now).toBe(20000)
})

it('retries only a timed-out observation while time remains without repeating Home or launching', async () => {
  let now = 0,
    calls = 0
  const state = await waitForPhoneBackground({
    run: (args) => {
      expect(args[0]).toBe('call')
      expect(['/exists', '/source']).toContain(args[1])
      if (args[1] === '/source') return iconSource
      if (++calls === 1) return '{"exists":false,"frame":[]}'
      if (calls === 2) {
        now += 6000
        throw Object.assign(new Error('native state timeout'), { code: 'ETIMEDOUT' })
      }
      return iconReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-home-icon')
  expect(calls).toBe(3)
  expect(now).toBeLessThan(20000)
})

it('does not accept a background reply received after the deadline or hide transport errors', async () => {
  let now = 0
  await expect(
    waitForPhoneBackground({
      run: () => {
        now = 21000
        return iconReply
      },
      now: () => now,
      report: () => {},
    })
  ).rejects.toThrow('20000ms')
  await expect(
    waitForPhoneBackground({
      run: () => {
        throw new Error('runner unavailable')
      },
    })
  ).rejects.toThrow('runner unavailable')
})

it('waits for a delayed home icon and reports its visibility without querying app state', async () => {
  let now = 0
  const calls: string[][] = []
  const state = await waitForPhoneBackground({
    run: (args) => {
      calls.push(args)
      if (args[1] === '/source') return iconSource
      return now < 12000 ? '{"exists":false,"frame":[]}' : iconReply
    },
    now: () => now,
    pause: async (ms) => {
      now += ms
    },
    report: () => {},
  })
  expect(state.witness).toBe('springboard-home-icon')
  expect(now).toBe(12000)
  expect(
    calls.every(
      (args) =>
        args[0] === 'call' &&
        ['/exists', '/source'].includes(args[1]) &&
        JSON.parse(args[2]).bundle === 'com.apple.springboard'
    )
  ).toBe(true)
})

it('never substitutes foreground, stopped or malformed state replies for a home icon', async () => {
  for (const reply of ['{"state":4}', '{"state":1}', '{}']) {
    let now = 0
    await expect(
      waitForPhoneBackground({
        run: () => reply,
        now: () => now,
        pause: async (ms) => {
          now += ms
        },
        report: () => {},
      })
    ).rejects.toThrow(/native.*home icon/)
    expect(now).toBeLessThanOrEqual(20000)
  }
})

it('uses kill only when advertised and requires a confirmed stopped process', () => {
  const calls: string[][] = []
  const run = (args: string[]) => {
    calls.push(args)
    return args[0] === '--help' ? 'iphone kill BUNDLE' : '{"ok":true,"state":1}'
  }
  expect(terminatePhone(run)).toEqual({ killed: true, state: 1 })
  expect(calls).toEqual([['--help'], ['kill', 'md.obsidian']])
  expect(() => terminatePhone(() => 'iphone launch BUNDLE')).toThrow('kill capability')
  expect(() =>
    terminatePhone((args) =>
      args[0] === '--help' ? 'iphone kill BUNDLE' : '{"ok":true,"state":4}'
    )
  ).toThrow('notRunning')
  expect(() =>
    terminatePhone((args) => {
      if (args[0] === '--help') return 'iphone kill BUNDLE'
      throw new Error('unknown path /terminate')
    })
  ).toThrow('device runner')
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
