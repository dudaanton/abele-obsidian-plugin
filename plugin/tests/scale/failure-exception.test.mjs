import assert from 'node:assert/strict'
import { test } from 'node:test'
import diagnostics from './diagnostics.cjs'

test('a rejected promise paused for startup diagnostics is captured and resumed', async () => {
  const commands = [], events = []
  let listener
  const transport = {
    on(_event, callback) { listener = callback },
    removeListener() {},
    async sendCommand(name) {
      commands.push(name)
      if (name === 'Runtime.getProperties') return { result: [{ name: 'stack', value: { value: 'sample stack' } }] }
      return { breakpointId: 'sample-gate' }
    },
  }
  await diagnostics.armHashTracepoints(transport, [2], 1, event => events.push(event))
  commands.length = 0
  await listener(null, 'Debugger.paused', {
    reason: 'promiseRejection', data: { objectId: 'sample-error' }, callFrames: [],
  })
  assert.deepEqual(commands, ['Runtime.getProperties', 'Debugger.resume'])
  assert.equal(events[0].event, 'caught-startup-exception')
})
