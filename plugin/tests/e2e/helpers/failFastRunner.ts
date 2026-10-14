/**
 * The e2e tier's test runner: vitest's own, plus one rule. Once a file's setup has failed — a
 * part's `beforeAll`, or a `beforeEach` before a case's body started — the rest of the file is
 * skipped, each case naming why, instead of every later case and part waiting out its own
 * timeout against an app left in a state nobody knows. The file still reports the failure; the
 * file's own teardown and the setup file's boundary still run.
 */
import { TestRunner } from 'vitest'
import type { Suite, Test } from '@vitest/runner'
import { skipReason } from './target'

/** The part of a vitest task this rule reads; the real `Task` fits it. */
export interface RunTask {
  type: string
  name: string
  file?: unknown
  tasks?: RunTask[]
  result?: { state: string; errors?: { message?: string }[] }
}

const ran = (task: RunTask): boolean =>
  task.type === 'test'
    ? task.result?.state === 'pass' || task.result?.state === 'fail'
    : (task.tasks ?? []).some(ran)

/**
 * Why the rest of a file should be skipped after `task` finished, if it should: a part (not
 * the file) that ended with its own errors before any of its cases ran — its setup failed — or
 * a case that failed without its body having started.
 */
export function failedSetup(task: RunTask, bodyStarted: boolean): string | undefined {
  const reason = (message?: string) =>
    `the setup of "${task.name}" failed: ${(message ?? 'no message').split('\n')[0]}`
  if (task.type === 'test')
    return task.result?.state === 'fail' && !bodyStarted
      ? reason(task.result.errors?.[0]?.message)
      : undefined
  if (task.file === task || !task.result?.errors?.length || ran(task)) return undefined
  return reason(task.result.errors[0]?.message)
}

const tests = (suite: Suite): Test[] =>
  suite.tasks.flatMap((task) =>
    task.type === 'test' ? [task] : task.type === 'suite' ? tests(task) : []
  )

const skip = (test: Test, note: string): void => {
  test.mode = 'skip'
  // The runner reports a result in this state as skipped, `note` as the reason.
  test.result = { state: 'skip', note } as NonNullable<Test['result']>
  skipReason(test, note)
}

export default class FailFastRunner extends TestRunner {
  private broken: string | undefined
  private started = new WeakSet<Test>()

  async runTask(test: Test): Promise<void> {
    this.started.add(test)
    await TestRunner.getTestFn(test)()
  }

  onBeforeTryTask(test: Test): void {
    this.started.delete(test)
    super.onBeforeTryTask(test)
  }

  async onBeforeRunSuite(suite: Suite): Promise<void> {
    if (suite.file === suite) this.broken = undefined
    else if (this.broken) {
      // The part still runs, so each case is reported skipped with the reason, but without its
      // own setup and teardown: they belong to a fixture this run never made.
      const hooks = TestRunner.getSuiteHooks(suite)
      hooks.beforeAll = []
      hooks.afterAll = []
      hooks.aroundAll = []
      for (const task of suite.tasks)
        if (task.type === 'test') skip(task, 'skipped: ' + this.broken)
    }
    await super.onBeforeRunSuite(suite)
  }

  async onAfterRunSuite(suite: Suite): Promise<void> {
    // A part whose setup found its emulated phone covered by the real one is skipped, not failed.
    const errors = suite.result?.errors ?? []
    if (errors.length && errors.every((e) => e.name === 'EmulationCoveredError')) {
      suite.result!.state = 'skip'
      suite.result!.errors = undefined
      for (const test of tests(suite)) skipReason(test, errors[0].message)
    }
    this.broken ??= failedSetup(suite as RunTask, false)
    await super.onAfterRunSuite(suite)
  }

  async onBeforeRunTask(test: Test): Promise<void> {
    if (this.broken && test.mode === 'run') skip(test, 'skipped: ' + this.broken)
    await super.onBeforeRunTask(test)
  }

  onAfterRunTask(test: Test): void {
    this.broken ??= failedSetup(test as RunTask, this.started.has(test))
    super.onAfterRunTask(test)
  }
}
