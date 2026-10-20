import { expect, it, vi } from 'vitest'
import { programLaunchTargets, resolveLaunchTarget } from '@/debugger/programLaunchTargets'
import { DebuggerControlMethodSchemas, DebuggerStartSchema } from '@abele/node-protocol'

it.fails('BUG: the pinned node protocol still lacks launch target discovery', () => {
  expect(DebuggerControlMethodSchemas).toHaveProperty('debugger.v1.launchTargets')
})

it.fails('BUG: the pinned node protocol cannot launch a package script', () => {
  expect(
    DebuggerStartSchema.safeParse({
      operation_id: 'sample-operation',
      conversation_id: 'sample-chat',
      program: 'package.json',
      argv: [],
      sources: [],
      npm_script: 'sample',
    }).success
  ).toBe(true)
})

it('maps a source entry to its build and retains its source for breakpoints', () => {
  expect(
    resolveLaunchTarget('src/main.ts', [{ program: 'dist/main.js', source: 'src/main.ts' }])
  ).toEqual({ program: 'dist/main.js', sources: ['src/main.ts'] })
})

it('also admits the mapped source when the built entry is picked directly', () => {
  expect(
    resolveLaunchTarget('dist/main.js', [{ program: 'dist/main.js', source: 'src/main.ts' }])
  ).toEqual({ program: 'dist/main.js', sources: ['src/main.ts'] })
})

it('offers npm scripts separately from program arguments', () => {
  expect(
    resolveLaunchTarget('npm run sample', [{ program: 'package.json', npm_script: 'sample' }])
  ).toEqual({ program: 'package.json', npm_script: 'sample', sources: [] })
})

it('keeps typed build paths available on older nodes', async () => {
  const request = vi.fn().mockRejectedValue(new Error('unsupported_method'))
  expect(await programLaunchTargets({ request } as never, {})).toEqual([])
  expect(resolveLaunchTarget('dist/main.js', [])).toEqual({ program: 'dist/main.js', sources: [] })
})

it('does not hide a failed discovery as an empty project', async () => {
  const request = vi.fn().mockRejectedValue(new Error('disconnected'))
  await expect(programLaunchTargets({ request } as never, {})).rejects.toThrow('disconnected')
})
