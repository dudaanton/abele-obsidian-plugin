import { h } from 'vue'
import { Notice } from 'obsidian'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { openGithubUrl } from '@/github/GithubService'
import UpdateDialog from '@/components/nodeWork/UpdateDialog.vue'
import PullRequestDialog from '@/components/nodeWork/PullRequestDialog.vue'
import type { BranchStep } from '@/components/nodeWork/branchStep'
import { nodePathDialog } from './NodePathDialogs'
import type { NodePathModel } from './NodePathModel'

const app = () => GlobalStore.getInstance().app
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Discarding a file's changes, asked first, saying what goes: a new file is deleted. */
export async function discardNodePathFile(model: NodePathModel, path: string): Promise<void> {
  const change = model.changes.value.find((c) => c.path === path)
  if (!change) return
  if (
    !(await confirmAction(app(), {
      title: 'Discard the changes?',
      message:
        change.kind === 'added'
          ? `${path} is new and not committed. Discarding deletes the file.`
          : `What changed in ${path} since the last commit is lost. Staged parts stay.`,
      confirmText: 'Discard',
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
  if (id === 'publish' || id === 'push') {
    await model.push()
    new Notice(id === 'publish' ? `${copy.branch} is on the remote now.` : 'Pushed.')
    return
  }
  const base = state.base ?? 'main'
  if (id === 'update') {
    const dirty = model.changes.value.filter((c) => c.kind !== 'added').length
    nodePathDialog(`Update from ${base}`, (close) =>
      h(UpdateDialog, {
        branch: copy.branch,
        base,
        behind: state.behind,
        dirty,
        pushed: !!state.upstream,
        // The node rebases a clean branch only, and never replaces a pushed one.
        ways: ['rebase'],
        clean: true,
        force: false,
        onCancel: close,
        onUpdate: () => {
          close()
          void model
            .update()
            .then(({ conflicts }) => {
              if (conflicts.length)
                new Notice(`The rebase stopped on ${plural(conflicts.length, 'file')} in conflict.`)
            })
            .catch((error: unknown) => model.report(error))
        },
      })
    )
    return
  }
  if (id === 'create-pr') {
    const commits = model.panelBranch.value?.committed.length ?? 0
    nodePathDialog('Create pull request', (close) =>
      h(PullRequestDialog, {
        branch: copy.branch,
        base,
        commits: state.ahead,
        files: commits,
        initialTitle: copy.branch,
        pushed: !!state.upstream && !state.unpushed,
        onCancel: close,
        onChooseBase: () => {},
        onCreate: (pr: { title: string; body: string; draft: boolean }) => {
          close()
          void model
            .createPull({ ...pr, base })
            .then((made) => {
              new Notice(`Pull request #${made.number} is open.`)
              if (made.url) void openGithubUrl(app(), made.url)
            })
            .catch((error: unknown) => model.report(error))
        },
      })
    )
  }
}
