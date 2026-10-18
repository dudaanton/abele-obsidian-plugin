import { streamBCount as plural } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
import { h } from 'vue'
import { Notice } from 'obsidian'
import { GitRefusal } from './nodePathGit'
import { GlobalStore } from '@/stores/GlobalStore'
import { openGithubUrl } from '@/github/GithubService'
import UpdateDialog from '@/components/nodeWork/UpdateDialog.vue'
import PullRequestDialog from '@/components/nodeWork/PullRequestDialog.vue'
import type { BranchStep } from '@/components/nodeWork/branchStep'
import { nodePathDialog } from './NodePathDialogs'
import type { NodePathModel } from './NodePathModel'
import { confirmDialog, promptDialog } from '@/components/obsidian/dialogs'

const app = () => GlobalStore.getInstance().app

/** Discarding a file's changes, asked first, saying what goes: a new file is deleted. */
export async function discardNodePathFile(model: NodePathModel, path: string): Promise<void> {
  const change = model.changes.value.find((c) => c.path === path)
  if (!change) return
  if (
    !(await confirmDialog({
      title: t('streamB.discardTheChanges.eea9a3'),
      message:
        change.kind === 'added'
          ? t('streamB.isNewAndNotCommittedDiscardingDeletes.a528f2', { v0: String(path) })
          : t('streamB.whatChangedInSinceTheLastCommit.235fe2', { v0: String(path) }),
      confirmText: t('streamB.discard.eb1a70'),
    }))
  )
    return
  await model.discard([path])
}

/** The branch's next step from the panel's button: push, update from its base, or a pull request. */
export async function takeNodePathStep(model: NodePathModel, id: BranchStep['id']): Promise<void> {
  const copy = model.currentCopy.value,
    state = model.panelBranch.value?.state
  if (!copy || !state) return
  if (id === 'create-branch') {
    const name = await promptDialog({
      title: t('streamB.makeABranchHere.d03d79'),
      placeholder: t('streamBRest.branchName'),
      submitText: t('streamB.makeBranch.bd53a1'),
    })
    if (name) await model.createBranch(name)
    return
  }
  if (id === 'publish' || id === 'push') {
    try {
      await model.push()
    } catch (error) {
      // A branch rebased after it was pushed: replace the remote one, only if it is still what
      // was last fetched, and only once asked.
      const lease =
        error instanceof GitRefusal && error.code === 'push_rejected'
          ? await model.upstreamLease()
          : undefined
      if (!lease || !lease.ahead || !lease.behind) throw error
      if (
        !(await confirmDialog({
          title: t('streamB.replaceTheBranchOnTheRemote.a153c5'),
          message: t('streamB.wasRebasedAfterItWasPushedSo.8f5682', {
            v0: String(copy.branch),
            v1: String(plural(lease.behind, 'commit')),
          }),
          confirmText: t('streamB.pushAndReplace.1a2195'),
        }))
      )
        return
      await model.push(lease.commit)
    }
    new Notice(
      id === 'publish'
        ? t('streamB.isOnTheRemoteNow.cd837b', { v0: String(copy.branch) })
        : t('streamB.pushed.73b8b1')
    )
    return
  }
  const base = state.base ?? 'main'
  if (id === 'update') {
    const dirty = model.changes.value.filter((c) => c.kind !== 'added').length
    nodePathDialog(t('streamB.updateFrom.e2481b', { v0: String(base) }), (close) =>
      h(UpdateDialog, {
        branch: copy.branch,
        base,
        behind: state.behind,
        dirty,
        pushed: !!state.upstream,
        // The node rebases a clean branch only; a pushed one is replaced on the next push, asked.
        ways: ['rebase'],
        clean: true,
        force: true,
        onCancel: close,
        onUpdate: () => {
          close()
          void model
            .update()
            .then(({ conflicts }) => {
              if (conflicts.length)
                new Notice(
                  t('streamB.theRebaseStoppedOnInConflict.71b2d1', {
                    v0: String(plural(conflicts.length, 'file')),
                  })
                )
            })
            .catch((error: unknown) => model.report(error))
        },
      })
    )
    return
  }
  if (id === 'create-pr') {
    const commits = model.panelBranch.value?.committed.length ?? 0
    nodePathDialog(t('streamB.createPullRequest.71e2bc'), (close) =>
      h(PullRequestDialog, {
        branch: copy.branch,
        base,
        commits: state.ahead,
        files: commits,
        initialTitle: copy.branch,
        pushed: !!state.upstream && !state.unpushed,
        draftSupported: model.panelPulls.value?.draftSupported !== false,
        host: model.panelPulls.value?.serviceLabel,
        onCancel: close,
        onChooseBase: () => {},
        onCreate: (pr: { title: string; body: string; draft: boolean }) => {
          close()
          void model
            .createPull({ ...pr, base })
            .then((made) => {
              new Notice(t('streamB.pullRequestIsOpen.d1d0c4', { v0: String(made.number) }))
              if (made.url) void openGithubUrl(app(), made.url)
            })
            .catch((error: unknown) => model.report(error))
        },
      })
    )
  }
}
