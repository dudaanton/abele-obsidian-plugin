import type { BranchState, CopySummary } from './types'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One step a branch is waiting for, as a button: what it says, its glyph, whether it leads. */
export interface BranchStep {
  id: 'create-branch' | 'publish' | 'push' | 'update' | 'create-pr'
  text: string
  icon: string
  accent: boolean
  tooltip: string
}

/**
 * The one main button: the next step the branch is waiting for. Stopped half way, it is to go on;
 * behind its base, to catch up; commits not pushed, to push them; pushed with no pull request,
 * to open one. Everything else is in the menu beside it.
 */
export function nextStep(
  s: BranchState,
  copy: Pick<CopySummary, 'kind' | 'branch'>
): BranchStep | null {
  if (copy.kind === 'detached')
    return {
      id: 'create-branch' as const,
      text: 'Make a branch here',
      icon: 'git-branch-plus',
      accent: false,
      tooltip: 'Start a branch at this commit, to keep work made on it',
    }
  if (s.stopped) return null
  if (!s.base) return null
  if (!s.upstream && s.ahead)
    return {
      id: 'publish' as const,
      text: 'Publish branch',
      icon: 'cloud-upload',
      accent: true,
      tooltip: `Push ${copy.branch} to the remote for the first time`,
    }
  if (s.unpushed)
    return {
      id: 'push' as const,
      text: `Push ${s.unpushed}`,
      icon: 'arrow-up',
      accent: true,
      tooltip: `Push ${plural(s.unpushed, 'commit')} to ${s.upstream}`,
    }
  if (s.behind)
    return {
      id: 'update' as const,
      text: `Update from ${s.base}`,
      icon: 'arrow-down',
      accent: !s.ahead,
      tooltip: `Bring in ${plural(s.behind, 'commit')} from ${s.base}…`,
    }
  if (s.ahead && !s.pr)
    return {
      id: 'create-pr' as const,
      text: 'Create pull request',
      icon: 'git-pull-request-create',
      accent: true,
      tooltip: `Ask to merge ${copy.branch} into ${s.base}…`,
    }
  return null
}
