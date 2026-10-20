import { t } from '@/i18n'

/** Worktree jobs are asynchronous; keep the create dialog busy while the node finishes. */
export async function waitForWorktreeJob<T extends { state: string }>(
  read: () => Promise<T>,
  pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 250))
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const job = await read()
    if (!['queued', 'running'].includes(job.state) || attempt >= 119) return job
    await pause()
  }
}

/** A managed worktree's storage id is not its name. */
export function worktreeDisplayPath(path: string, branch: string | null): string {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path.split('/').pop() ?? '')
    ? (branch?.replace(/^refs\/heads\//, '') ?? t('streamB.detached.134385'))
    : path
}
