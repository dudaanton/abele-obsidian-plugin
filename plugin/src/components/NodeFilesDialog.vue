<template>
  <Modal :title="t('streamB.workspaceFilesAndReview.1b959c')" size="full" @close="close">
    <div class="abele-node-files">
      <div v-if="onRepository" class="abele-node-files__actions">
        <Button
          :text="t('streamB.openRepository.2284f8')"
          icon="folder-git-2"
          :disabled="busy || offline"
          @click="
            act(async () => {
              await onRepository!()
              close()
            })
          "
        />
        <span>{{ t('streamB.filesWorkspacesCommitsAndWorkingTreeChanges.cbff1e') }}</span>
      </div>
      <div
        class="abele-node-files__actions"
        role="tablist"
        :aria-label="t('streamB.workspaceViews.808336')"
      >
        <Button
          :text="t('streamB.files.abc7e9')"
          :accent="tab === 'files'"
          @click="tab = 'files'"
        />
        <Button
          :text="t('streamB.diffs.1c4721')"
          :accent="tab === 'diffs'"
          @click="tab = 'diffs'"
        />
        <Button :text="t('streamB.history.0e7696')" :accent="tab === 'history'" @click="history" />
      </div>
      <p v-if="error" role="alert"><NodeErrorText :error="error" /></p>
      <p v-if="offline" role="status">
        {{ t('streamB.offlineRetainedViewsRemainAvailableReconnectTo.d47525') }}
      </p>
      <template v-if="tab === 'files'">
        <div class="abele-node-files__actions">
          <Button
            v-if="model.directory.value"
            :text="t('streamB.parentFolder.158f5a')"
            icon="arrow-up"
            :disabled="busy || offline"
            @click="act(() => model.list(parent, false, lifetime.signal))"
          />
          <Button
            :text="t('streamB.refreshFolder.f962de')"
            icon="refresh-cw"
            :disabled="busy || offline"
            @click="act(() => model.list(model.directory.value, false, lifetime.signal))"
          />
          <span class="abele-node-files__path">{{ model.directory.value || '/' }}</span>
          <Icon
            v-if="fileRequests.available.value"
            icon="list-video"
            :tooltip="t('requests.file.openPanel')"
            @click="
              act(async () => {
                await fileRequests.open()
                close()
              })
            "
          />
        </div>
        <div :aria-label="t('streamB.workspaceFiles.bb2e2d')" class="abele-node-files__listing">
          <button
            v-for="entry in model.entries.value"
            :key="entry.path"
            class="abele-node-files__entry"
            :disabled="busy || offline || !['file', 'directory'].includes(entry.kind)"
            @click="open(entry)"
          >
            <Icon
              :icon="
                entry.kind === 'directory'
                  ? 'folder'
                  : entry.kind === 'symlink'
                    ? 'link'
                    : 'file-text'
              "
              no-hover
            />
            <span>{{ entry.name }}</span
            ><small>{{
              entry.kind === 'symlink'
                ? t('streamB.symbolicLinkNotFollowed.a17fac')
                : entry.kind === 'file'
                  ? t('streamB.bytes.869a57', { v0: String(entry.size) })
                  : ''
            }}</small>
          </button>
          <Button
            v-if="model.next.value"
            :text="t('streamB.moreFiles.594130')"
            :disabled="busy || offline"
            @click="act(() => model.list(model.directory.value, true, lifetime.signal))"
          />
        </div>
        <template v-if="model.document.value">
          <h3 class="abele-node-files__path">{{ model.filePath.value }}</h3>
          <p>{{ t('streamBMeta.6fce708969', { p0: String(model.document.value.size) }) }}</p>
          <NodeFileSaveState
            :model="model"
            :offline="offline"
            :locked="busy"
            :changed-on-disk="changedOnDisk"
            @reconciled="changedOnDisk = false"
          />
          <p
            v-if="
              !model.fileEditable.value &&
              !model.document.value.binary &&
              !model.document.value.tooLarge
            "
          >
            {{ t('streamB.thisVersionIsReadOnlyTheBounded.89264a') }}
          </p>
          <p v-if="model.document.value.tooLarge">
            {{ t('streamB.thisFileExceedsTheNodeSRetained.5707a2') }}
          </p>
          <p v-else-if="model.document.value.binary">
            {{ t('streamB.binaryFileNoTextPreview.6018e8') }}
          </p>
          <template
            v-if="
              model.draft.value || (!model.document.value.binary && !model.document.value.tooLarge)
            "
          >
            <p
              v-if="
                model.draft.value && (model.document.value.binary || model.document.value.tooLarge)
              "
            >
              {{ t('streamB.retainedLocalTextTheCurrentFileCannot.545af1') }}
            </p>
            <p v-if="model.document.value.large">
              {{ t('streamB.largeFileRetainedContentShownBelow.0bab19') }}
            </p>
            <GithubCode
              :key="model.filePath.value"
              :text="
                model.editing.value || model.document.value.binary || model.document.value.tooLarge
                  ? model.draftText.value
                  : model.document.value.text || ''
              "
              :editable="
                model.editing.value && !busy && !model.saving.value && !model.draft.value?.pending
              "
              :path="model.filePath.value"
              :range="model.fileRange.value"
              :focus="
                model.fileRange.value ? { line: model.fileRange.value.start, context: 3 } : null
              "
              @change="editText"
            />
            <details
              v-if="
                model.editing.value &&
                model.document.value.text !== undefined &&
                model.draftText.value !== model.document.value.text
              "
            >
              <summary>{{ t('streamB.lastLoadedVersionReloadToInspectCurrent.bf3b4f') }}</summary>
              <GithubCode :text="model.document.value.text || ''" :path="model.filePath.value" />
            </details>
          </template>
        </template>
      </template>
      <template v-else-if="tab === 'diffs'">
        <Setting :name="t('streamB.nextSnapshotComparison.221fdf')">
          <select
            v-model="mode"
            :aria-label="t('streamB.diffMode.83c93c')"
            :disabled="busy || offline"
            @change="loadDiff"
          >
            <option value="head">{{ t('streamB.headWorktree.6b9a2c') }}</option>
            <option value="staged">{{ t('streamB.stagedHeadIndex.c6d80a') }}</option>
            <option value="unstaged">{{ t('streamB.unstagedIndexWorktree.01bbb6') }}</option>
            <option value="base">{{ t('streamB.branchBaseMergeBaseToHead.9de11c') }}</option>
            <option value="commit">{{ t('streamB.commitChange.8a5497') }}</option>
          </select>
        </Setting>
        <Setting v-if="mode === 'commit'" :name="t('streamB.commitIdentity.c32322')"
          ><Input
            v-model="commit"
            :aria-label="t('streamB.commitIdentity.c32322')"
            :placeholder="t('streamB.fullCommitHash.952238')"
        /></Setting>
        <Button
          :text="t('streamB.openNewSnapshot.7ba70f')"
          icon="refresh-cw"
          :disabled="busy || offline || (mode === 'commit' && !commit)"
          @click="loadDiff"
        />
        <p v-if="model.snapshot.value" class="abele-node-files__path">
          {{ t('streamBMeta.3135711e46', { p0: String(model.snapshot.value.diff_id) }) }}<br />
          {{
            t('streamBMeta.f2ed32069a', { p0: String(diffModeLabels[model.snapshot.value.mode]) })
          }}
          <template v-if="model.snapshot.value.commit"
            ><br />{{
              t('streamBMeta.66e576cb3c', { p0: String(model.snapshot.value.commit) })
            }}</template
          >
          <template v-if="model.snapshot.value.merge_base"
            ><br />{{
              t('streamBMeta.d24b776832', { p0: String(model.snapshot.value.merge_base) })
            }}</template
          >
        </p>
        <p v-if="model.snapshot.value && !model.files.value.length">
          {{ t('streamB.noChangesInThisComparison.a1a1f5') }}
        </p>
        <GithubDiffFile
          v-for="file in model.files.value"
          :key="`${model.snapshot.value?.diff_id}/${file.path}`"
          :file="file"
          initially-open
          @select="select(file, $event)"
        >
          <template #selection="{ span, label }"
            ><Button
              :text="t('streamB.comment.e5dbf9', { v0: String(label) })"
              icon="message-square"
              :disabled="model.reviewLocked.value || !model.sessionId"
              @click="select(file, span, true)"
          /></template>
        </GithubDiffFile>
        <div v-if="selection && commenting" class="abele-node-files__comment">
          <p class="abele-node-files__path">
            {{
              t('streamBMeta.76abe4b076', {
                p0: String(selection.path),
                p1: String(
                  selection.span.side === 'L'
                    ? t('streamB.before.9bb725')
                    : t('streamB.after.7b68fe')
                ),
                p2: String(selection.span.start),
                p3: String(selection.span.end),
                p4: String(selection.diffId),
              })
            }}
          </p>
          <Setting :name="t('streamB.reviewComment.c8866a')">
            <textarea
              v-model="comment"
              :aria-label="t('streamB.reviewComment.c8866a')"
              rows="3"
              maxlength="2000"
              :disabled="model.reviewLocked.value"
            />
          </Setting>
          <Button
            :text="t('streamB.addToReview.24cfb7')"
            :disabled="busy || !comment.trim() || model.reviewLocked.value"
            @click="addComment"
          />
        </div>
      </template>
      <template v-else>
        <Button
          :text="t('streamB.refreshHistory.70f3d2')"
          :disabled="busy || offline"
          @click="history"
        />
        <div class="abele-node-files__listing">
          <button
            v-for="row in model.logs.value"
            :key="row.commit"
            class="abele-node-files__entry"
            :disabled="busy || offline"
            @click="openCommit(row.commit)"
          >
            <span>{{ row.subject }}</span
            ><small>{{ row.commit.slice(0, 12) }}</small>
          </button>
        </div>
        <Button
          v-if="model.logs.value.length"
          :text="t('streamB.moreCommits.9b6bfa')"
          :disabled="busy || offline"
          @click="act(() => model.loadLog(true, lifetime.signal))"
        />
      </template>
      <details v-if="model.comments.value.length" open>
        <summary>
          {{ t('streamBMeta.4b9a66feb9', { p0: String(model.comments.value.length) }) }}
        </summary>
        <div
          v-for="(anchor, index) in model.comments.value"
          :key="index"
          class="abele-node-files__comment"
        >
          <p class="abele-node-files__path">
            {{ anchor.path }} · {{ anchor.side }} · {{ anchor.start_line }}–{{ anchor.end_line }}
          </p>
          <p>{{ anchor.comment }}</p>
          <Button
            :text="t('streamB.removeComment.6c9206')"
            :disabled="model.reviewLocked.value || busy"
            @click="model.removeComment(index)"
          />
        </div>
      </details>
      <p v-if="model.reviewStatus.value" role="status">{{ model.reviewStatus.value }}</p>
      <details v-if="model.submittedReview.value.length">
        <summary>{{ t('streamB.lastSubmittedReviewRetainedSelections.62e0f6') }}</summary>
        <div
          v-for="(item, index) in model.submittedReview.value"
          :key="index"
          class="abele-node-files__comment"
        >
          <p class="abele-node-files__path">
            {{ item.anchor.path }} · {{ item.anchor.side }} · {{ item.anchor.start_line }}–{{
              item.anchor.end_line
            }}
          </p>
          <p>
            {{
              item.stale
                ? t('streamB.staleWorkspaceChangedOrCouldNotBe.878186')
                : t('streamB.selectionMatchedAtAcceptance.8e2c0b')
            }}
          </p>
          <p>{{ item.anchor.comment }}</p>
        </div>
      </details>
      <p v-if="!model.sessionId">{{ t('streamB.browseOnlyOpenFilesFromAWorkspace.fdf960') }}</p>
    </div>
    <template #footer>
      <Button
        v-if="model.pendingReview.value"
        :text="t('streamB.checkQueuedReview.1bcc6a')"
        :disabled="busy"
        @click="act(() => model.checkReview())"
      />
      <Button
        v-else
        :text="t('streamB.sendReview.f0f751', { v0: String(model.comments.value.length) })"
        accent
        :disabled="
          busy || model.reviewLocked.value || !model.sessionId || !model.comments.value.length
        "
        @click="act(() => model.submit())"
      />
      <Button :text="t('streamB.close.7d9eb7')" @click="close" />
    </template>
  </Modal>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { DiffMode } from '@abele/node-client'
import type { DiffSpan } from '@/github/permalinks'
import type {
  NodeFilesModel,
  NodeDiffFile,
  ReviewSelection,
  CodeLineRange,
} from '@/node/NodeFilesModel'
import type { NodeConnection } from '@/node/NodeService'
import { useFileRequests } from '@/requests/useFileRequests'
import { WORKING_TREE } from '@/repository/node'
import type { NodeRepositoryTarget } from '@/repository/nodeLinks'
import type { RepositoryIdentity } from '@/repository/source'
import Modal from './obsidian/Modal.vue'
import NodeFileSaveState from './NodeFileSaveState.vue'
import Button from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Icon from './obsidian/Icon.vue'
import GithubCode from './github/GithubCode.vue'
import GithubDiffFile from './github/GithubDiffFile.vue'
const props = defineProps<{
  model: NodeFilesModel
  registrationId?: string
  onRepository?: () => Promise<unknown>
  subscribeChanges?: (listener: () => void) => () => void
  connection: Pick<NodeConnection, 'state'>
  initialPath?: string
  initialTab?: 'files' | 'diffs' | 'history'
  initialSelection?: ReviewSelection
  initialRange?: CodeLineRange
}>()
const emit = defineEmits<{ close: [] }>()
const requestPlace = shallowRef<Extract<RepositoryIdentity, { provider: 'node' }>>()
const requestTarget = computed<NodeRepositoryTarget | null>(() =>
  requestPlace.value && props.model.filePath.value
    ? {
        provider: 'node',
        source: requestPlace.value,
        location: { kind: 'file', ref: WORKING_TREE, path: props.model.filePath.value },
      }
    : null
)
const fileRequests = useFileRequests(requestTarget, () => close())
onMounted(() => {
  const client = props.model.client
  const registrationId = props.registrationId
  if (!registrationId || !client?.getWorkspace || !client.store) return
  void (async () => {
    const workspace = await client.getWorkspace(props.model.workspaceId)
    const installation = await client.store.transaction((state) => state.installation_id)
    if (!installation || lifetime.signal.aborted) return
    requestPlace.value = {
      provider: 'node',
      installation,
      node: registrationId,
      project: workspace.project_id,
      workspace: workspace.workspace_id,
    }
  })().catch((error) => console.debug('[requests] File dialog context unavailable', error))
})
const changedOnDisk = ref(false)
let stopChanges = () => {}
onMounted(() => {
  stopChanges =
    props.subscribeChanges?.(() => {
      changedOnDisk.value = true
    }) ?? (() => {})
})
onUnmounted(() => stopChanges())
watch(
  () => props.model.document.value?.contentId,
  () => {
    changedOnDisk.value = false
  }
)
const lifetime = new AbortController()
const close = () => {
  lifetime.abort()
  emit('close')
}
onUnmounted(() => lifetime.abort())
const tab = ref(props.initialTab || 'files'),
  error = ref(''),
  busy = ref(false),
  mode = ref<DiffMode>(props.model.snapshot.value?.mode ?? 'head'),
  commit = ref(props.model.snapshot.value?.commit ?? ''),
  comment = ref(''),
  commenting = ref(!!props.initialSelection)
const diffModeLabels: Record<DiffMode, string> = {
  head: t('streamB.headWorktree.6b9a2c'),
  staged: t('streamB.stagedHeadIndex.c6d80a'),
  unstaged: t('streamB.unstagedIndexWorktree.01bbb6'),
  base: t('streamB.branchBaseMergeBaseToHead.9de11c'),
  commit: t('streamB.commitChange.8a5497'),
}
watch(
  () => props.model.snapshot.value,
  (snapshot) => {
    if (!snapshot) return
    mode.value = snapshot.mode
    commit.value = snapshot.commit ?? ''
  }
)
const selection = shallowRef<ReviewSelection | null>(props.initialSelection || null)
const offline = computed(() => props.connection.state.value !== 'connected')
const parent = computed(() => props.model.directory.value.split('/').slice(0, -1).join('/'))
async function act(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = e instanceof Error ? presentUiError(e) : t('streamB.nodeRequestFailed.3ded00')
  } finally {
    busy.value = false
  }
}
const editText = (text: string) => {
  void props.model.editText(text).catch((e: unknown) => {
    error.value =
      e instanceof Error ? presentUiError(e) : t('streamB.localDraftCouldNotBeStored.4af2a9')
  })
}
const open = (entry: { path: string; kind: string }) =>
  act(() =>
    entry.kind === 'directory'
      ? props.model.list(entry.path, false, lifetime.signal)
      : props.model.openFile(entry.path, lifetime.signal)
  )
const loadDiff = () =>
  act(async () => {
    await props.model.loadDiff(
      mode.value,
      mode.value === 'commit' ? commit.value : undefined,
      lifetime.signal
    )
    // A comment already being composed remains attached to its retained selection.
  })
const history = () => {
  tab.value = 'history'
  return act(() => props.model.loadLog(false, lifetime.signal))
}
const openCommit = (sha: string) => {
  tab.value = 'diffs'
  mode.value = 'commit'
  commit.value = sha
  return loadDiff()
}
function select(file: NodeDiffFile, span: DiffSpan | null, show = false) {
  if (commenting.value && !show) return
  try {
    const next = span ? props.model.selectLines(file, span) : null
    if (
      show &&
      commenting.value &&
      comment.value.trim() &&
      (next?.diffId !== selection.value?.diffId ||
        next?.path !== selection.value?.path ||
        next?.span.start !== selection.value?.span.start ||
        next?.span.end !== selection.value?.span.end ||
        next?.span.side !== selection.value?.span.side)
    ) {
      error.value = t('streamB.addOrClearTheCurrentCommentBefore.fd7216')
      return
    }
    if (next) selection.value = next
    else if (
      selection.value?.path === file.path &&
      selection.value?.diffId === file.document.snapshot.diff_id
    )
      selection.value = null
    if (show) commenting.value = true
  } catch (e) {
    error.value = e instanceof Error ? presentUiError(e) : t('streamB.invalidSelection.a2f76c')
  }
}
const addComment = () =>
  act(async () => {
    if (!selection.value) return
    await props.model.addComment(selection.value, comment.value)
    comment.value = ''
    commenting.value = false
  })
onMounted(
  () =>
    void act(async () => {
      // A requested resource and the cached folder listing are independent reads. A removed
      // folder must not suppress a valid file link (nor vice versa).
      const reads: Promise<unknown>[] = []
      if (props.model.draftError.value) {
        // An unpersisted private copy must stay visible until an explicit reload/copy action.
        error.value = presentUiField(props.model.draftError, 'value')
      } else if (props.initialPath) {
        reads.push(
          props.initialRange
            ? props.model.openFile(props.initialPath, lifetime.signal, props.initialRange)
            : props.model.openResource(props.initialPath, lifetime.signal)
        )
      } else if (props.model.filePath.value) {
        reads.push(props.model.openFile(props.model.filePath.value, lifetime.signal))
      }
      reads.push(props.model.list(props.model.directory.value, false, lifetime.signal))
      const results = await Promise.allSettled(reads)
      for (const result of results) if (result.status === 'rejected') throw result.reason
    })
)
</script>
<style lang="scss">
.abele-node-files {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
  // Obsidian draws control focus rings outside their box, including full-width actions.
  padding: var(--size-4-1);
  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-1);
  }
  &__path {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  &__listing {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
    padding: var(--size-4-1);
  }
  &__entry {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    height: auto;
    text-align: start;
    white-space: normal;
    min-width: 0;
    padding: var(--size-4-2);
    span {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    small {
      color: var(--text-muted);
    }
  }
  &__comment {
    padding: var(--size-4-2);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }
  textarea {
    width: 100%;
    min-width: 0;
  }
  .setting-item-control {
    min-width: 0;
    select {
      max-width: 100%;
    }
  }
}
</style>
