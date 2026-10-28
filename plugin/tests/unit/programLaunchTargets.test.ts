import { expect, it, vi } from 'vitest'
import {
  programLaunchTargets,
  programLaunchPaths,
  resolveLaunchTarget,
  type ProgramLaunchTarget,
} from '@/debugger/programLaunchTargets'
import { DebuggerControlMethodSchemas, DebuggerStartSchema } from '@abele/node-protocol'

// BUG: The node start protocol must accept launch configuration before the paired feature ships.
it.fails('admits runtime arguments, working folder and environment in the node protocol', () => {
  expect(
    DebuggerStartSchema.safeParse({
      operation_id: 'sample-operation',
      conversation_id: 'sample-chat',
      program: 'packages/sample/src/main.ts',
      runtime_argv: ['--import=tsx'],
      cwd: 'packages/sample',
      env: { MODE: 'sample' },
    }).success
  ).toBe(true)
})

it('keeps the recently opened file ahead of discovered built entries', () => {
  expect(
    programLaunchPaths(
      [{ program: 'dist/main.js', source: 'src/main.ts' }],
      ['src/sample.js', 'dist/main.js'],
      ['src/sample.js']
    )
  ).toEqual(['src/sample.js', 'dist/main.js', 'src/main.ts'])
})

it('offers package scripts and built entries before searchable source aliases', () => {
  const targets: ProgramLaunchTarget[] = Array.from({ length: 20 }, (_, i) => ({
    program: `dist/entry-${i}.js`,
    source: `src/entry-${i}.ts`,
  }))
  targets.push({ program: 'package.json', npm_script: 'sample' })
  const paths = programLaunchPaths(targets, ['src/entry-0.ts', 'scripts/check.mjs'])
  expect(paths[0]).toBe('npm run sample')
  expect(paths.slice(1, 21)).toEqual(targets.slice(0, 20).map((t) => t.program))
  expect(paths).toContain('src/entry-0.ts')
  expect(paths).toContain('scripts/check.mjs')
  expect(paths.filter((p) => p === 'src/entry-0.ts')).toHaveLength(1)
})

it('exposes launch target discovery in the vendored node protocol', () => {
  expect(DebuggerControlMethodSchemas).toHaveProperty('debugger.v1.launchTargets')
})

it('admits package-script launches in the vendored node protocol', () => {
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

it('recognizes an old node by its error code even when its message is descriptive', async () => {
  const request = vi.fn().mockRejectedValue(
    Object.assign(new Error('Method unavailable'), {
      code: 'unsupported_method',
    })
  )
  expect(await programLaunchTargets({ request } as never, {})).toEqual([])
})

it('does not hide a failed discovery as an empty project', async () => {
  const request = vi.fn().mockRejectedValue(new Error('disconnected'))
  await expect(programLaunchTargets({ request } as never, {})).rejects.toThrow('disconnected')
})
