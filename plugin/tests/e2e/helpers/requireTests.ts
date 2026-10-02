import type { Reporter } from 'vitest/reporters'
import type { TestModule } from 'vitest/node'

interface Task {
  type: string
  result?: { state: string }
  tasks?: Task[]
}

/** Collection alone is not verification: skipIf can skip every collected test. */
export function assertTestsRan(tasks: readonly Task[]): void {
  const ran = (task: Task): boolean =>
    task.type === 'test'
      ? task.result?.state === 'pass' || task.result?.state === 'fail'
      : (task.tasks ?? []).some(ran)
  if (!tasks.some(ran))
    throw new Error('No e2e tests ran; check the target, fixture vault and development build.')
}

export default class RequireTests implements Reporter {
  onTestRunEnd(files: readonly TestModule[]): void {
    try {
      // Vitest 4 reports module objects instead of runner tasks. Keep the zero-run guard
      // active: a collected but entirely skipped suite is still not verification.
      const tasks = files.flatMap((file) =>
        [...file.children.allTests()].map((test) => ({
          type: 'test',
          result: {
            state:
              test.result().state === 'passed'
                ? 'pass'
                : test.result().state === 'failed'
                  ? 'fail'
                  : 'skip',
          },
        }))
      )
      assertTestsRan(tasks)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
