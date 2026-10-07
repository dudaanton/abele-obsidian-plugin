<template>
  <Modal title="Workspace files and review" size="full" @close="close">
    <div class="abele-node-files">
      <div class="abele-node-files__actions" role="tablist" aria-label="Workspace views">
        <Button text="Files" :accent="tab === 'files'" @click="tab = 'files'" />
        <Button text="Diffs" :accent="tab === 'diffs'" @click="tab = 'diffs'" />
        <Button text="History" :accent="tab === 'history'" @click="history" />
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="offline" role="status">
        Offline · retained views remain available. Reconnect to browse.
      </p>
      <template v-if="tab === 'files'">
        <div class="abele-node-files__actions">
          <Button
            v-if="model.directory.value"
            text="Parent folder"
            icon="arrow-up"
            :disabled="busy || offline"
            @click="act(() => model.list(parent, false, lifetime.signal))"
          />
          <Button
            text="Refresh folder"
            icon="refresh-cw"
            :disabled="busy || offline"
            @click="act(() => model.list(model.directory.value, false, lifetime.signal))"
          />
          <span class="abele-node-files__path">{{ model.directory.value || '/' }}</span>
        </div>
        <div aria-label="Workspace files" class="abele-node-files__listing">
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
                ? 'Symbolic link · not followed'
                : entry.kind === 'file'
                  ? `${entry.size} bytes`
                  : ''
            }}</small>
          </button>
          <Button
            v-if="model.next.value"
            text="More files"
            :disabled="busy || offline"
            @click="act(() => model.list(model.directory.value, true, lifetime.signal))"
          />
        </div>
        <template v-if="model.document.value">
          <h3 class="abele-node-files__path">{{ model.filePath.value }}</h3>
          <p>{{ model.document.value.size }} bytes · retained version</p>
          <div class="abele-node-files__actions">
            <Button
              v-if="!model.editing.value"
              text="Edit file"
              icon="pencil"
              :disabled="busy || !model.fileEditable.value || !!model.draft.value?.pending"
              @click="act(() => model.beginEditing())"
            />
            <Button
              v-else-if="model.draft.value?.pending"
              text="Check save"
              :disabled="busy"
              @click="act(() => model.checkSave())"
            />
            <Button
              v-else
              text="Save file"
              accent
              :disabled="
                busy ||
                !model.draftDirty.value ||
                !!model.draftError.value ||
                model.draft.value?.status === 'conflict'
              "
              @click="act(() => model.saveFile())"
            />
            <Button
              text="Reload current version"
              icon="refresh-cw"
              :disabled="busy || offline || !!model.draftError.value"
              @click="act(() => model.openFile(model.filePath.value, lifetime.signal))"
            />
            <Button
              v-if="model.draft.value && !model.draft.value.pending"
              text="Discard local draft"
              :disabled="busy || !!model.draftError.value"
              @click="act(() => model.discardDraft())"
            />
          </div>
          <p v-if="model.draftError.value" role="alert">{{ model.draftError.value }}</p>
          <p
            v-if="
              model.editing.value &&
              !model.draft.value?.pending &&
              model.draft.value?.status === 'draft'
            "
            role="status"
          >
            Unsent edit · stored only on this device. Save uses the version you started from.
          </p>
          <p v-if="model.draft.value?.status === 'saved'" role="status">
            Saved · the node confirmed this version. External editors may change it afterwards.
          </p>
          <p v-if="model.draft.value?.status === 'conflict'" role="alert">
            Conflict · the workspace changed. Your local draft is retained and was not applied.
            Reload and inspect the current version before choosing a new base.
          </p>
          <p v-if="model.draft.value?.status === 'rejected'" role="alert">
            Save rejected · {{ model.draft.value.error }}. Your local draft is retained.
          </p>
          <p v-if="model.draft.value?.pending" role="alert">
            Save outcome unknown · keep this draft. Reconnect and check the same save; do not submit
            it again. A confirmed uncertain replacement requires inspection of the retained
            predecessor.
          </p>
          <p
            v-if="
              !model.fileEditable.value &&
              !model.document.value.binary &&
              !model.document.value.tooLarge
            "
          >
            This version is read only. The bounded editor accepts UTF-8 text up to 32,768 characters
            and does not edit Git metadata.
          </p>
          <Button
            v-if="
              model.draft.value &&
              !model.draft.value.pending &&
              model.document.value.contentId !== model.draft.value.baseContentId
            "
            text="Use loaded version as base for this draft"
            :disabled="busy || !model.fileEditable.value"
            @click="act(() => model.rebaseDraft())"
          />
          <details v-if="model.draft.value?.result" class="abele-node-files__comment">
            <summary>Save receipt and retained predecessor</summary>
            <p class="abele-node-files__path">
              Operation · {{ model.draft.value.result.operation_id }}<br />Outcome ·
              {{ model.draft.value.result.state }}<br />Predecessor ·
              {{ model.draft.value.result.predecessor_content_id || 'See recovery path'
              }}<template v-if="model.draft.value.result.recovery_path"
                ><br />Recovery path · {{ model.draft.value.result.recovery_path }}</template
              >
            </p>
            <Button
              v-if="model.draft.value.result.predecessor_content_id"
              text="Read retained predecessor"
              :disabled="busy || offline"
              @click="act(() => model.readPredecessor())"
            />
            <GithubCode
              v-if="model.predecessorText.value !== undefined"
              :text="model.predecessorText.value"
              :path="model.filePath.value"
            />
          </details>
          <p v-if="model.document.value.tooLarge">
            This file exceeds the node's retained-content limit. Its size is shown without loading
            its contents.
          </p>
          <p v-else-if="model.document.value.binary">Binary file · no text preview.</p>
          <template v-else>
            <p v-if="model.document.value.large">Large file · retained content shown below.</p>
            <GithubCode
              :key="model.filePath.value"
              :text="model.editing.value ? model.draftText.value : model.document.value.text || ''"
              :editable="model.editing.value && !model.saving.value && !model.draft.value?.pending"
              :path="model.filePath.value"
              :range="model.fileRange.value"
              :focus="
                model.fileRange.value ? { line: model.fileRange.value.start, context: 3 } : null
              "
              @change="editText"
            />
            <details
              v-if="model.editing.value && model.draftText.value !== model.document.value.text"
            >
              <summary>Last loaded version · reload to inspect current contents</summary>
              <GithubCode :text="model.document.value.text || ''" :path="model.filePath.value" />
            </details>
          </template>
        </template>
      </template>
      <template v-else-if="tab === 'diffs'">
        <Setting name="Next snapshot comparison">
          <select
            v-model="mode"
            aria-label="Diff mode"
            :disabled="busy || offline"
            @change="loadDiff"
          >
            <option value="head">HEAD / worktree</option>
            <option value="staged">Staged · HEAD / index</option>
            <option value="unstaged">Unstaged · index / worktree</option>
            <option value="base">Branch / base · merge-base to HEAD</option>
            <option value="commit">Commit change</option>
          </select>
        </Setting>
        <Setting v-if="mode === 'commit'" name="Commit identity"
          ><Input v-model="commit" aria-label="Commit identity" placeholder="Full commit hash"
        /></Setting>
        <Button
          text="Open new snapshot"
          icon="refresh-cw"
          :disabled="busy || offline || (mode === 'commit' && !commit)"
          @click="loadDiff"
        />
        <p v-if="model.snapshot.value" class="abele-node-files__path">
          Immutable snapshot · {{ model.snapshot.value.diff_id }}<br />
          Current comparison · {{ diffModeLabels[model.snapshot.value.mode] }}
          <template v-if="model.snapshot.value.commit"
            ><br />Commit · {{ model.snapshot.value.commit }}</template
          >
          <template v-if="model.snapshot.value.merge_base"
            ><br />Merge-base · {{ model.snapshot.value.merge_base }}</template
          >
        </p>
        <p v-if="model.snapshot.value && !model.files.value.length">
          No changes in this comparison.
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
              :text="`Comment · ${label}`"
              icon="message-square"
              :disabled="model.reviewLocked.value || !model.sessionId"
              @click="select(file, span, true)"
          /></template>
        </GithubDiffFile>
        <div v-if="selection && commenting" class="abele-node-files__comment">
          <p class="abele-node-files__path">
            {{ selection.path }} · {{ selection.span.side === 'L' ? 'Before' : 'After' }} · lines
            {{ selection.span.start }}–{{ selection.span.end }} · snapshot {{ selection.diffId }}
          </p>
          <Setting name="Review comment">
            <textarea
              v-model="comment"
              aria-label="Review comment"
              rows="3"
              maxlength="2000"
              :disabled="model.reviewLocked.value"
            />
          </Setting>
          <Button
            text="Add to review"
            :disabled="busy || !comment.trim() || model.reviewLocked.value"
            @click="addComment"
          />
        </div>
      </template>
      <template v-else>
        <Button text="Refresh history" :disabled="busy || offline" @click="history" />
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
          text="More commits"
          :disabled="busy || offline"
          @click="act(() => model.loadLog(true, lifetime.signal))"
        />
      </template>
      <details v-if="model.comments.value.length" open>
        <summary>
          Review batch · {{ model.comments.value.length }} comments across retained snapshots
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
            text="Remove comment"
            :disabled="model.reviewLocked.value || busy"
            @click="model.removeComment(index)"
          />
        </div>
      </details>
      <p v-if="model.reviewStatus.value" role="status">{{ model.reviewStatus.value }}</p>
      <details v-if="model.submittedReview.value.length">
        <summary>Last submitted review · retained selections</summary>
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
                ? 'Stale · workspace changed or could not be rechecked. Original selection was sent.'
                : 'Selection matched at acceptance.'
            }}
          </p>
          <p>{{ item.anchor.comment }}</p>
        </div>
      </details>
      <p v-if="!model.sessionId">
        Browse only. Open files from a workspace session to send review comments.
      </p>
    </div>
    <template #footer>
      <Button
        v-if="model.pendingReview.value"
        text="Check queued review"
        :disabled="busy"
        @click="act(() => model.checkReview())"
      />
      <Button
        v-else
        :text="`Send review (${model.comments.value.length})`"
        accent
        :disabled="
          busy || model.reviewLocked.value || !model.sessionId || !model.comments.value.length
        "
        @click="act(() => model.submit())"
      />
      <Button text="Close" @click="close" />
    </template>
  </Modal>
</template>
<script setup lang="ts">
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
import Modal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Icon from './obsidian/Icon.vue'
import GithubCode from './github/GithubCode.vue'
import GithubDiffFile from './github/GithubDiffFile.vue'
const props = defineProps<{
  model: NodeFilesModel
  connection: Pick<NodeConnection, 'state'>
  initialPath?: string
  initialTab?: 'files' | 'diffs' | 'history'
  initialSelection?: ReviewSelection
  initialRange?: CodeLineRange
}>()
const emit = defineEmits<{ close: [] }>()
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
  head: 'HEAD / worktree',
  staged: 'Staged · HEAD / index',
  unstaged: 'Unstaged · index / worktree',
  base: 'Branch / base · merge-base to HEAD',
  commit: 'Commit change',
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
    error.value = e instanceof Error ? e.message : 'Node request failed'
  } finally {
    busy.value = false
  }
}
const editText = (text: string) => {
  void props.model.editText(text).catch((e: unknown) => {
    error.value = e instanceof Error ? e.message : 'Local draft could not be stored'
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
      error.value = 'Add or clear the current comment before choosing another selection'
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
    error.value = e instanceof Error ? e.message : 'Invalid selection'
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
      if (props.initialPath) {
        reads.push(
          props.initialRange
            ? props.model.openFile(props.initialPath, lifetime.signal, props.initialRange)
            : props.model.openResource(props.initialPath, lifetime.signal)
        )
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
