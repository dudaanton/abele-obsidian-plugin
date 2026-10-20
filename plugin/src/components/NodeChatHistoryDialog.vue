<template>
  <Modal
    :title="action === 'edit' ? t('streamB.edit.464c4f') : t('streamB.rewindToHere.447575')"
    size="tall"
    close-in-footer
    @close="emit('close')"
  >
    <div class="abele-node-rewind">
      <template v-if="action === 'edit'">
        <Input
          v-model="text"
          as-text-area
          :aria-label="t('streamB.nodeHistoryEditPrompt')"
          :disabled="busy"
          :maxlength="32768"
        />
        <p v-if="text.length > 32768" role="alert">{{ t('streamB.nodeHistoryEditLimit') }}</p>
      </template>
      <template v-else>
        <Setting :name="t('streamB.putFilesBack.2a77d8')" :desc="t('streamB.nodeHistoryFilesOff')">
          <Checkbox
            :is-enabled="files"
            :disabled="busy || loading || blocked || !preview?.changes.length"
            @toggle="files = !files"
          />
        </Setting>
        <EmptyState v-if="loading" :text="t('streamB.readingTheFiles.86a22c')" />
        <EmptyState
          v-else-if="preview && !preview.changes.length"
          :text="t('streamB.theAgentChangedNoFilesFromHere.fd371d')"
        />
        <TreeItem
          v-for="change in preview?.changes ?? []"
          :key="change.path"
          :text="change.path"
          icon="file-diff"
          collapsible
          :collapsed="open !== change.path"
          @click="open = open === change.path ? '' : change.path"
        >
          <p>
            {{
              t('streamB.nodeHistoryFileMode', {
                before: mode(file(change.path)?.before_mode),
                after: mode(file(change.path)?.after_mode),
              })
            }}
          </p>
          <p v-if="file(change.path)?.truncated" role="status">
            {{ t('streamB.nodeHistoryTruncated') }}
          </p>
          <Diff
            v-if="diff(change.path)"
            :path="change.path"
            :text-left="diff(change.path)!.old"
            :text-right="diff(change.path)!.new"
          />
          <p v-else>{{ t('streamB.nodeHistoryBinary') }}</p>
        </TreeItem>
        <p v-if="preview?.files.some((item) => item.truncated)" role="status">
          {{ t('streamB.nodeHistoryTruncated') }}
        </p>
      </template>
      <div v-if="error" role="alert">
        <NodeErrorText :error="error" />
        <p>{{ t('streamB.nodeHistoryNoReplay') }}</p>
      </div>
      <Button
        v-if="error && action === 'rewind'"
        data-history-refresh
        :text="t('streamB.nodeHistoryRefreshPreview')"
        :disabled="busy || loading"
        @click="load"
      />
    </div>
    <template #footer>
      <Button
        data-history-cancel
        :text="t('streamB.cancel.19766e')"
        :disabled="busy"
        @click="emit('close')"
      />
      <Button
        data-history-confirm
        :text="
          action === 'edit'
            ? t('streamB.nodeHistoryEditSend')
            : files
              ? t('streamB.putFilesBackAndGoBack.d25972')
              : t('streamB.goBackInChat.1cec2a')
        "
        :warning="files"
        :accent="!files"
        :disabled="
          busy || loading || blocked || (action === 'edit' && (!text.trim() || text.length > 32768))
        "
        @click="confirm"
      />
    </template>
  </Modal>
</template>
<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { t } from '@/i18n'
import { presentUiError } from '@/i18n/streamBErrors'
import type { NodeChatPreview } from '@/node/NodeChatHistory'
import Modal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import EmptyState from './obsidian/EmptyState.vue'
import TreeItem from './obsidian/TreeItem.vue'
import Diff from './Diff.vue'
import NodeErrorText from './NodeErrorText.vue'
const props = defineProps<{
  action: 'rewind' | 'edit'
  initialText: string
  readPreview: () => Promise<NodeChatPreview>
  restore: (files?: NodeChatPreview, text?: string) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()
const preview = shallowRef<NodeChatPreview>()
const files = ref(false)
const text = ref(props.initialText)
const loading = ref(props.action === 'rewind')
const busy = ref(false)
const blocked = ref(false)
const error = ref('')
const open = ref('')
const file = (path: string) => preview.value?.files.find((item) => item.path === path)
const mode = (value?: number | null) => (value == null ? '—' : (value & 0o777).toString(8))
const decode = (value: string | null | undefined): string | null => {
  if (value === undefined) return null
  if (value === null) return ''
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
    )
    return text.includes(String.fromCharCode(0)) ? null : text
  } catch {
    return null
  }
}
const diff = (path: string) => {
  const item = file(path)
  const old = decode(item?.before_base64),
    next = decode(item?.after_base64)
  return old !== null && next !== null ? { old, new: next } : undefined
}
async function load() {
  loading.value = true
  files.value = false
  error.value = ''
  try {
    preview.value = await props.readPreview()
    blocked.value = false
  } catch (err) {
    error.value = presentUiError(err)
    blocked.value = true
  } finally {
    loading.value = false
  }
}
async function confirm() {
  if (busy.value || blocked.value || loading.value) return
  busy.value = true
  error.value = ''
  try {
    await props.restore(
      props.action === 'rewind' && files.value ? preview.value : undefined,
      props.action === 'edit' ? text.value : undefined
    )
    emit('close')
  } catch (err) {
    error.value = presentUiError(err)
    blocked.value = true
  } finally {
    busy.value = false
  }
}
onMounted(() => (props.action === 'rewind' ? load() : undefined))
</script>
<style lang="scss">
.abele-node-rewind {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
