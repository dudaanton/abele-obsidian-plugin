<template>
  <Modal title="Workspace files and review" size="full" @close="emit('close')">
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
            @click="act(() => model.list(parent))"
          />
          <Button
            text="Refresh folder"
            icon="refresh-cw"
            :disabled="busy || offline"
            @click="act(() => model.list(model.directory.value))"
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
            @click="act(() => model.list(model.directory.value, true))"
          />
        </div>
        <template v-if="model.document.value">
          <h3 class="abele-node-files__path">{{ model.filePath.value }}</h3>
          <p>{{ model.document.value.size }} bytes · read only · retained content</p>
          <p v-if="model.document.value.tooLarge">
            This file exceeds the node's retained-content limit. Its size is shown without loading
            its contents.
          </p>
          <p v-else-if="model.document.value.binary">Binary file · no text preview.</p>
          <template v-else>
            <p v-if="model.document.value.large">Large file · retained content shown below.</p>
            <GithubCode
              :key="model.document.value.contentId || model.filePath.value"
              :text="model.document.value.text || ''"
              :path="model.filePath.value"
            />
          </template>
        </template>
      </template>
      <template v-else-if="tab === 'diffs'">
        <Setting name="Compare">
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
          Immutable snapshot · {{ model.snapshot.value.diff_id
          }}<template v-if="model.snapshot.value.merge_base"
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
          @select="select(file.path, $event)"
        >
          <template #selection="{ span, label }"
            ><Button
              :text="`Comment · ${label}`"
              icon="message-square"
              :disabled="!!model.pendingReview.value || !model.sessionId"
              @click="select(file.path, span, true)"
          /></template>
        </GithubDiffFile>
        <div v-if="selection && commenting" class="abele-node-files__comment">
          <p class="abele-node-files__path">
            {{ selection.path }} · {{ selection.span.side === 'L' ? 'Before' : 'After' }} · lines
            {{ selection.span.start }}–{{ selection.span.end }}
          </p>
          <Setting name="Review comment">
            <textarea v-model="comment" aria-label="Review comment" rows="3" maxlength="2000" />
          </Setting>
          <Button
            text="Add to review"
            :disabled="busy || !comment.trim() || !!model.pendingReview.value"
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
          @click="act(() => model.loadLog(true))"
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
            :disabled="!!model.pendingReview.value || busy"
            @click="model.comments.value.splice(index, 1)"
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
                ? 'Stale · workspace changed. Original selection was sent.'
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
        :disabled="busy || !model.sessionId || !model.comments.value.length"
        @click="act(() => model.submit())"
      />
      <Button text="Close" @click="emit('close')" />
    </template>
  </Modal>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DiffMode } from '@abele/node-client'
import type { DiffSpan } from '@/github/permalinks'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
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
  initialSelection?: { path: string; span: DiffSpan }
}>()
const emit = defineEmits<{ close: [] }>()
const tab = ref(props.initialTab || 'files'),
  error = ref(''),
  busy = ref(false),
  mode = ref<DiffMode>('head'),
  commit = ref(''),
  comment = ref(''),
  commenting = ref(!!props.initialSelection)
const selection = ref<{ path: string; span: DiffSpan } | null>(props.initialSelection || null)
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
const open = (entry: { path: string; kind: string }) =>
  act(() =>
    entry.kind === 'directory' ? props.model.list(entry.path) : props.model.openFile(entry.path)
  )
const loadDiff = () =>
  act(async () => {
    await props.model.loadDiff(mode.value, mode.value === 'commit' ? commit.value : undefined)
    selection.value = null
    commenting.value = false
  })
const history = () => {
  tab.value = 'history'
  return act(() => props.model.loadLog())
}
const openCommit = (sha: string) => {
  tab.value = 'diffs'
  mode.value = 'commit'
  commit.value = sha
  return loadDiff()
}
function select(path: string, span: DiffSpan | null, show = false) {
  if (span) selection.value = { path, span }
  else if (selection.value?.path === path) selection.value = null
  if (show) commenting.value = true
}
const addComment = () =>
  act(async () => {
    if (!selection.value) return
    await props.model.addComment(selection.value.path, selection.value.span, comment.value)
    comment.value = ''
    commenting.value = false
  })
onMounted(
  () =>
    void act(async () => {
      await props.model.list(props.model.directory.value)
      if (props.initialPath) await props.model.openFile(props.initialPath)
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
