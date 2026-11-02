// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const diagnostics = require('./diagnostics.cjs')
const capture = require('./receipt-capture.cjs')
const { SHA256: ActualSHA256 } = require('@noble/hashes/sha2.js')

it('arms hash coverage without executing renderer JavaScript in a paused native async context', async () => {
  let listener: any
  const commands: string[] = []
  const transport = { on: (_: string, callback: any) => { listener = callback }, removeListener() {},
    sendCommand: async (name: string) => {
      commands.push(name)
      if (name === 'Debugger.getScriptSource') return { scriptSource: 'class SHA256 extends HashMD {}' }
      return { breakpointId: 'gate' }
    } }
  await diagnostics.armHashTracepoints(transport, [3], 9, () => {})
  await listener(null, 'Debugger.paused', { hitBreakpoints: ['gate'],
    callFrames: [{ callFrameId: 'frame', location: { scriptId: 'bundle' } }] })
  expect(commands).toContain('Debugger.setBreakpoint')
  expect(commands.at(-1)).toBe('Debugger.resume')
  expect(commands).not.toContain('Debugger.evaluateOnCallFrame')
})

it('hands real hash constructors to normal renderer scheduling after bundle evaluation', () => {
  const work: Array<() => void> = []
  const source = capture.instrumentReceiptAccess(`
    function durableHostOf() {} function storageOf() {} class BoundedVaultIo {}
    class SHA256 extends ActualSHA256 {}
    module.exports = SHA256;
  `)
  runInNewContext(source, { ActualSHA256, module: { exports: {} },
    __scaleWarmHashConstructors: (callback: () => void) => work.push(callback) })
  expect(work).toHaveLength(1)
  expect(() => work[0]()).not.toThrow()
})
