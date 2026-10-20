import { streamBCount as plural } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
import type { BranchState, CopySummary } from './types'

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
      text: t('streamB.makeABranchHere.d03d79'),
      icon: 'git-branch-plus',
      accent: false,
      tooltip: t('streamB.startABranchAtThisCommitTo.6d4995'),
    }
  if (s.stopped) return null
  if (!s.base) return null
  if (!s.upstream && s.ahead && s.hasRemote !== false)
    return {
      id: 'publish' as const,
      text: t('streamB.publishBranch.e1f596'),
      icon: 'cloud-upload',
      accent: true,
      tooltip: t('streamB.pushToTheRemoteForTheFirst.7fed3e', { v0: String(copy.branch) }),
    }
  if (s.unpushed)
    return {
      id: 'push' as const,
      text: t('streamB.push.907dbf', { v0: String(s.unpushed) }),
      icon: 'arrow-up',
      accent: true,
      tooltip: t('streamB.pushTo.5871ee', {
        v0: String(plural(s.unpushed, 'commit')),
        v1: String(s.upstream),
      }),
    }
  if (s.behind)
    return {
      id: 'update' as const,
      text: t('streamB.updateFrom.e2481b', { v0: String(s.base) }),
      icon: 'arrow-down',
      accent: !s.ahead,
      tooltip: t('streamB.bringInFrom.1db03b', {
        v0: String(plural(s.behind, 'commit')),
        v1: String(s.base),
      }),
    }
  if (s.ahead && !s.pr && s.hasRemote !== false)
    return {
      id: 'create-pr' as const,
      text: t('streamB.createPullRequest.71e2bc'),
      icon: 'git-pull-request-create',
      accent: true,
      tooltip: t('streamB.askToMergeInto.bc4f1c', { v0: String(copy.branch), v1: String(s.base) }),
    }
  return null
}
