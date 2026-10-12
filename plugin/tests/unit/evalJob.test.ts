// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { evalJobSource } from '../e2e/helpers/evalJob'

it('does not retain a late large result after the worker abandons its job', async () => {
  let release!: (value: string) => void
  const waiting = new Promise<string>((resolve) => {
    release = resolve
  })
  const page = { __e2eJobs: {} as Record<string, unknown> }
  runInNewContext(evalJobSource('sample-job', 'waiting'), {
    window: page,
    waiting,
    setTimeout: (fn: () => void) => fn(),
  })
  await Promise.resolve()
  delete page.__e2eJobs['sample-job']
  release('x'.repeat(1024 * 1024))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(Object.keys(page.__e2eJobs)).toEqual([])
})
