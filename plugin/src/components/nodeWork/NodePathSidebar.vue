<template>
  <NodePanel
    :phase="phase"
    :node="node"
    :empty="!model?.folders.value.length"
    :here="model?.currentCopy.value?.branch ?? model?.currentFolder.value?.name"
    :git="model?.currentFolder.value?.git"
    :updated="node?.seen"
    :chat-available="
      !model?.unavailable.value &&
      (model?.capabilities.value.includes('node_path_execution') ?? false)
    "
    :error="
      model?.unavailable.value
        ? 'repository_unavailable'
        : (error ?? (model ? presentUiField(model.error, 'value') : undefined))
    "
    @connect="emit('connect')"
    @connect-other="emit('pair')"
    @open-folder="emit('open-folder')"
    @new-chat="emit('new-chat')"
    @history="emit('history')"
    @refresh="emit('refresh')"
    @retry="emit('retry')"
    @menu="emit('node-menu', $event)"
    @copy="emit('copy', $event)"
  >
    <!-- The panel's modes stand in its header, as the file explorer's buttons do; what stood
         there as glyphs is in the place's menu. -->
    <template v-if="model?.current.value && !model.unavailable.value" #nav>
      <NodeModes
        v-model:mode="model.panelMode.value"
        header
        :git="git"
        :pulls="git"
        :changes="changeCount"
        :open-pulls="pulls?.pulls.length ?? 0"
        :against="model.panelBase.value ? shortRef(model.panelBase.value) : undefined"
        :sessions="{ total: sessions.length, waiting: waitingCount }"
        @compare="emit('compare')"
        @stop-compare="model.panelBase.value = ''"
      />
    </template>
    <template #error-action>
      <Button
        v-if="
          model?.unavailable.value &&
          model.currentFolder.value &&
          (model.currentFolder.value.missing ||
            model.currentCopy.value?.kind === 'project' ||
            model.current.value?.kind === 'workspace')
        "
        quiet
        :text="t('streamB.removeTheFolderFromTheNode.9e68fe')"
        :disabled="offline"
        @click="act(() => removeNodePathFolder(model!, model!.currentFolder.value!))"
      />
    </template>
    <template v-if="model">
      <NodePlace
        :node="node?.name"
        :folder="model.currentFolder.value?.name"
        :branch="git && !model.unavailable.value ? model.currentCopy.value?.branch : undefined"
        :busy="model.busy.value"
        @pick="emit('pick-place')"
        @menu="emit('place-menu', $event)"
      >
        <!-- The branch against its base, in codes, close under its name. -->
        <BranchCodes
          v-if="branch && branchSays"
          :state="branch.state"
          :branch="model.currentCopy.value?.branch ?? ''"
          size="panel"
          pickable
          @choose-base="emit('compare')"
        />
      </NodePlace>
      <template v-if="!model.unavailable.value">
        <!-- A rebase stopped on conflicts: go on once they are resolved and staged, or stop it. -->
        <div v-if="stopped" class="abele-node-sidebar__stopped" role="status">
          <Icon icon="triangle-alert" size="xs" color="red" :interactive="false" />
          <span class="abele-node-sidebar__stopped-text">{{
            t('streamBMeta.stoppedOperation', {
              kind: stopped.kind,
              ref: stopped.onto,
              count: stopped.conflicts,
            })
          }}</span>
          <Button
            :text="t('streamB.continue.31fbef')"
            :disabled="!!model.gitBusy.value || offline || stopped.conflicts > 0"
            :loading="model.gitBusy.value === 'continue'"
            :tooltip="
              stopped.conflicts > 0
                ? t('streamB.stageTheInConflictFirst.9f0b2f', {
                    v0: String(stopped.conflicts),
                    v1: String(streamBWord(stopped.conflicts, 'file')),
                  })
                : t('streamB.finishThe.72914d', { v0: String(stopped.kind) })
            "
            @click="act(() => model!.continueStopped(stopped!.kind))"
          />
          <Button
            :text="t('streamB.stopThe.b0527e', { v0: String(stopped.kind) })"
            quiet
            :disabled="!!model.gitBusy.value || offline"
            :loading="model.gitBusy.value === 'abort'"
            :tooltip="t('streamB.putTheBranchBackAsItWas.b6174b', { v0: String(stopped.kind) })"
            @click="act(() => model!.abortStopped(stopped!.kind))"
          />
        </div>
        <!-- One action at a time: the commit while something is staged, else the branch's next step. -->
        <CommitBox
          v-if="canGit && mode === 'changes' && staged"
          class="abele-node-sidebar__commit"
          :staged="staged"
          :conflicts="conflicts"
          :disabled="!!model.gitBusy.value || offline"
          @commit="(message) => act(() => model!.commit(message))"
        />
        <div v-else-if="step" class="abele-node-sidebar__step">
          <Button
            :text="step.text"
            :icon="step.icon"
            :tooltip="step.tooltip"
            :disabled="!!model.gitBusy.value || offline"
            :loading="model.gitBusy.value === (step.id === 'publish' ? 'push' : step.id)"
            @click="emit('step', step.id)"
          />
        </div>
        <div v-if="!model.current.value" class="search-empty-state">
          {{
            node?.name != null
              ? t('streamBMeta.7be7370b62', { p0: node.name })
              : t('streamBMeta.b8b90dce28')
          }}
        </div>
        <FileTree
          v-else-if="mode === 'files' || mode === 'changes'"
          :key="`${model.current.value?.id}:${mode}`"
          :entries="model.entries.value"
          :search-key="model.receivedAt.value"
          :search="
            model.port.search && ((query) => model.port.search!(model.current.value!, query))
          "
          :cursors="model.treeCursors.value"
          :progress="model.treeProgress.value"
          :changes="model.changes.value"
          :branch-changes="mode === 'changes' ? (branch?.committed ?? []) : []"
          :base="branch?.state.base ?? undefined"
          :grouped="mode === 'changes'"
          :actions="canGit && mode === 'changes' && !offline"
          :mode="mode === 'files' ? 'all' : 'changed-tree'"
          :modes="false"
          :git="git"
          :stale="node?.status !== 'connected'"
          :selected="file"
          :label="
            t('streamB.filesOf.dd59b9', {
              v0: String(model.currentCopy.value?.branch ?? model.currentFolder.value?.name),
            })
          "
          @retry="model.refreshCurrent().catch((error) => model.report(error))"
          @expand="(path) => model.loadFolder(path).catch((error) => model.report(error))"
          @more="(path) => model.loadMore(path).catch((error) => model.report(error))"
          @open="
            (path, stage) =>
              emit(
                'open-file',
                path,
                stage === 'committed'
                  ? { kind: 'committed', base: branch?.state.baseRef ?? model.panelBase.value }
                  : stage
              )
          "
          @menu="(event, path) => emit('file-menu', event, path)"
          @stage="(path) => act(() => model!.stage([path]))"
          @unstage="(path) => act(() => model!.unstage([path]))"
          @stage-all="act(() => model!.stage('all'))"
          @unstage-all="act(() => model!.unstage('all'))"
          @discard="(path) => emit('discard', path)"
        />
        <!-- The node's sessions at this place, each opening its chat. -->
        <SessionTree
          v-else-if="mode === 'sessions'"
          class="abele-node-sidebar__sessions"
          :sessions="sessions"
          :active="model.selectedChat.value || undefined"
          @open="(id) => emit('open-chat', id)"
        />
        <div v-else-if="mode === 'history'" class="abele-node-sidebar__history">
          <div v-if="history?.error.value" class="abele-node-sidebar__error" role="alert">
            <NodeErrorText :error="history.error.value" />
          </div>
          <HistoryView
            :commits="history?.commits.value ?? []"
            :copy="model.currentCopy.value"
            :head="false"
            :more="!!history?.cursor.value"
            :base="model.inspection.value?.base"
            @open-commit="(hash) => emit('open-commit', hash)"
            @more="history?.load(true).catch((error) => model?.report(error))"
          />
        </div>
        <NodePullList
          v-else
          :pulls="pulls?.pulls ?? []"
          :connected="pulls?.connected ?? false"
          :remote="!!pulls?.remote"
          @open="(n) => emit('open-pull', n)"
          @connect="emit('connect-service')"
        />
      </template>
    </template>
  </NodePanel>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiField } from '@/i18n/streamBErrors'
import { streamBWord } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
// The node's side panel: one place (a folder and its branch) chosen from a row that opens the
// search of all of them, and the place's files, changes, history or pull requests under it.
import { computed, watch } from 'vue'
import type { NodePathModel, PathFileStage } from '@/node/NodePathModel'
import { removeNodePathFolder } from '@/node/NodePathController'
import NodePanel from './NodePanel.vue'
import NodePlace from './NodePlace.vue'
import NodeModes from './NodeModes.vue'
import NodePullList from './NodePullList.vue'
import SessionTree from '../nodeSession/SessionTree.vue'
import type { ChildSession } from '@/node/sessionLive'
import FileTree from './FileTree.vue'
import HistoryView from './HistoryView.vue'
import BranchCodes from './BranchCodes.vue'
import CommitBox from './CommitBox.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import { nextStep, type BranchStep } from './branchStep'
import { GIT_WRITE_CAPABILITY } from '@/node/nodePathGit'
import { shortRef } from '@/node/presentation'
import type { NodeSummary } from './types'
const props = withDefaults(
  defineProps<{
    model?: NodePathModel
    phase: 'looking' | 'found' | 'connecting' | 'not-found' | 'remote' | 'ready'
    node?: NodeSummary
    file?: string
    error?: string
  }>(),
  { model: undefined, node: undefined, file: undefined, error: undefined }
)
const emit = defineEmits<{
  connect: []
  pair: []
  'open-folder': []
  'new-chat': []
  history: []
  refresh: []
  retry: []
  'node-menu': [event: MouseEvent]
  copy: [text: string]
  'pick-place': []
  'place-menu': [event: MouseEvent]
  'open-file': [path: string, stage?: PathFileStage]
  'file-menu': [event: MouseEvent, path: string]
  'open-commit': [hash: string]
  'open-pull': [number: number]
  'connect-service': []
  compare: []
  step: [id: BranchStep['id']]
  discard: [path: string]
  'open-chat': [id: string]
}>()
const git = computed(
  () => !props.model?.unavailable.value && (props.model?.currentFolder.value?.git ?? false)
)
/** A folder without git has its files and its sessions only, whatever mode was last chosen. */
const mode = computed(() => {
  const chosen = props.model?.panelMode.value
  return git.value || chosen === 'sessions' ? chosen : 'files'
})
/** The sessions at this place as the tree draws them: the node does not say yet which one
 *  started which, so they stand side by side. */
const sessions = computed<ChildSession[]>(() =>
  (props.model?.currentCopy.value?.chats ?? props.model?.currentFolder.value?.chats ?? []).map(
    (chat) => ({
      id: chat.id,
      title: chat.title,
      agent: '',
      kind: 'chat',
      state: chat.waiting ? 'waiting' : chat.failed ? 'failed' : chat.running ? 'running' : 'done',
      started: chat.since ?? 0,
      ...(chat.bypass ? { mode: 'bypass' as const } : {}),
    })
  )
)
const waitingCount = computed(() => sessions.value.filter((s) => s.state === 'waiting').length)
const changeCount = computed(
  () => new Set((props.model?.changes.value ?? []).map((c) => c.path)).size
)
const history = computed(() => props.model?.panelHistory.value)
const branch = computed(() => props.model?.panelBranch.value)
const offline = computed(() => props.node?.status !== 'connected')
/** The node can stage, commit and push in this worktree. */
const canGit = computed(
  () =>
    // Read with the node's capabilities, so a node that gains git writes on reconnect shows them.
    !!props.model?.capabilities.value.includes(GIT_WRITE_CAPABILITY) &&
    !!props.model.port?.git &&
    props.model.current.value?.kind === 'worktree'
)
const staged = computed(
  () =>
    (props.model?.changes.value ?? []).filter((c) => c.stage === 'staged' || c.stage === 'partly')
      .length
)
const conflicts = computed(
  () => (props.model?.changes.value ?? []).filter((c) => c.kind === 'conflict').length
)
const stopped = computed(() => (canGit.value ? branch.value?.state.stopped : undefined))
/** The one step the branch waits for, when the node (and the git service) can take it. */
const step = computed(() => {
  const copy = props.model?.currentCopy.value
  if (!canGit.value || !branch.value || !copy) return null
  const next = nextStep(branch.value.state, copy)
  if (!next) return null
  if (next.id === 'create-pr' && !props.model?.port?.createPull) return null
  return next
})
/** A git action from the panel; what went wrong is said in the panel's notice. */
const act = (run: () => Promise<unknown>) => {
  void run().catch((error: unknown) => props.model?.report(error))
}
/** A folder's own main branch, even with its remote and no other base, says nothing: no codes. */
const branchSays = computed(() => {
  const state = branch.value?.state
  return (
    !!state &&
    !(
      props.model?.currentCopy.value?.kind === 'project' &&
      !props.model.panelBase.value &&
      !state.ahead &&
      !state.behind &&
      !state.unpushed &&
      !state.pr &&
      !state.stopped
    )
  )
})
// The branch is read again whenever the node observes the worktree anew or another base is chosen.
watch(
  () =>
    [
      props.model,
      props.model?.current.value?.id,
      JSON.stringify(props.model?.inspection.value?.revision ?? null),
      props.model?.panelBase.value,
    ] as const,
  ([model, id]) => {
    if (model && id && git.value) void model.loadPanelBranch().catch((e) => model.report(e))
  },
  { immediate: true }
)
const pulls = computed(() => props.model?.panelPulls.value)
// History and pull requests are read when their mode is shown, for the place shown.
watch(
  () => [props.model, mode.value, props.model?.current.value?.id] as const,
  ([model, shown]) => {
    if (!model) return
    if (shown === 'history') void model.loadPanelHistory().catch((e) => model.report(e))
    if (shown === 'pulls') void model.loadPanelPulls().catch((e) => model.report(e))
  },
  { immediate: true }
)
</script>
<style lang="scss">
.abele-node-sidebar__step {
  display: flex;
  padding: var(--size-4-4) var(--size-4-2) 0;

  > button {
    flex: 1;
  }
}
// The commit field on the search field's line, both a frame over the tree.
.abele-node-sidebar__commit {
  padding: var(--size-4-4) var(--size-4-2) 0;
}
.abele-node-sidebar__stopped {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2) var(--size-4-3);
  margin: var(--size-4-4) var(--size-4-2) 0;
  padding: var(--size-4-2) var(--size-4-3);
  border-radius: var(--radius-m);
  background-color: rgba(var(--color-red-rgb), 0.08);
  color: var(--text-normal);
  font-size: var(--font-ui-small);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-node-sidebar__stopped-text {
  flex: 1 1 10em;
  min-width: 0;
}
.abele-node-sidebar__error {
  padding: var(--size-4-2);
  color: var(--text-error);
  overflow-wrap: anywhere;
}
// The place, then a step, then the mode's content to the foot.
.abele-node-sidebar .abele-node-place {
  padding-top: var(--size-4-2);
}
.abele-node-sidebar__history,
.abele-node-sidebar__sessions,
.abele-node-sidebar .abele-node-pulls {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: var(--size-4-4);
}
// Room at the sides, so a commit's light is not cut by the scrolling edge.
.abele-node-sidebar__history {
  padding-inline: var(--size-4-2);
}
// On a computer the panel itself does not scroll: its header, the place and the files' search
// stay where they are, and only the files under them move, as the file explorer keeps its header.
.abele-node-sidebar .abele-file-tree {
  flex: 1;
  min-height: 0;
}
.abele-node-sidebar .abele-file-tree__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
// One hairline in the panel, where the files start to scroll under the header. The header's
// groups (place, its action, the search) stand a step apart; inside a group things touch.
.abele-node-sidebar .abele-file-tree__bar {
  padding-top: var(--size-4-4);
  border-top: none;
  border-bottom: var(--border-width) solid var(--background-modifier-border);
}
// A phone's drawer is too short to hold the header and the place still with room for files
// under them: there the whole panel scrolls and only the files' search stays, at the top, so it
// can always be reached. The drawer then pads the end of the panel clear of its floating buttons.
body.is-phone .abele-node-sidebar {
  .abele-node-panel {
    height: auto;
  }

  .abele-file-tree {
    flex: none;
  }

  .abele-file-tree__body {
    overflow: visible;
  }

  .abele-file-tree__bar {
    position: sticky;
    top: 0;
    z-index: 1;
    // The drawer's own colour, so the files passing under it do not show through.
    background-color: var(--mobile-sidebar-background, var(--background-secondary));
  }
}
.abele-node-sidebar .abele-node-panel {
  height: 100%;
}
</style>
