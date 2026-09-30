import type { Reporter } from 'vitest/reporters'

interface Task {
  type: string
  result?: { state: string }
  tasks?: Task[]
}

/** Collection alone is not verification: skipIf can skip every collected test. */
export function assertTestsRan(tasks: readonly Task[]): void {
  const ran = (task: Task): boolean => task.type === 'test'
    ? task.result?.state === 'pass' || task.result?.state === 'fail'
    : (task.tasks ?? []).some(ran)
  if (!tasks.some(ran)) throw new Error('No e2e tests ran; check the target, fixture vault and development build.')
}

export default class RequireTests implements Reporter {
  onFinished(files = []): void {
    try {
      assertTestsRan(files)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
