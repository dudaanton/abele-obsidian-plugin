<template>
  <div ref="root" class="abele-node-main">
    <NodeLspTools
      v-if="target"
      :root="root"
      :glyph-host="glyphHost"
      :target="target"
      :path="model.filePath.value"
      :text="visibleText"
      :offline="offline"
    />
    <div ref="glyphHost" class="abele-file-view__tools" />
    <NodeFileTools
      :key="repository?.cacheNamespace ?? ''"
      :root="root"
      :glyph-host="glyphHost"
      :source="repository"
      :file="{ host: '', owner: '', repo: '', ref: revision ?? '', path: model.filePath.value }"
      :text="visibleText"
    />
    <div v-if="error" role="alert"><NodeErrorText :error="error" /></div>
    <div v-if="offline" role="status">
      {{ t('streamB.offlineYourLocalDraftIsRetained.ae9db3') }}
    </div>
    <div v-if="locked" role="status">
      {{ t('streamB.savingIsNotAllowedInThisWorktree.8eb83d') }}
    </div>
    <NodeFileSaveState :model="model" :offline="offline" :locked="locked" :actions="false" />
    <Diff
      v-if="model.document.value && comparison"
      :text-left="comparison.original"
      :text-right="visibleText"
      :path="model.filePath.value"
      :title="model.filePath.value"
      :context="Number.MAX_SAFE_INTEGER"
      overview
      :layout="comparison.split ? 'auto' : 'unified'"
    >
      <template #editor="{ layout }">
        <GithubCode
          :text="visibleText"
          :comparison="{ original: comparison.original, split: layout === 'split' }"
          :path="model.filePath.value"
          :editable="editable"
          @change="model.editText($event)"
        />
      </template>
    </Diff>
    <GithubCode
      v-else-if="model.document.value"
      :text="visibleText"
      :path="model.filePath.value"
      :range="range"
      :editable="editable"
      @change="model.editText($event)"
    />
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import type { CodeComparison } from '@/github/codeViewer'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import type { RepositorySource } from '@/repository/source'
import NodeFileTools from './NodeFileTools.vue'
import NodeLspTools from './NodeLspTools.vue'
import type { PathTarget } from '@/node/NodePathModel'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import GithubCode from '../github/GithubCode.vue'
import NodeFileSaveState from '../NodeFileSaveState.vue'
import Diff from '../Diff.vue'
const props = withDefaults(
  defineProps<{
    model: NodeFilesModel
    comparison?: CodeComparison
    target?: PathTarget
    error?: string
    offline?: boolean
    locked?: boolean
    repository?: RepositorySource
    revision?: string
    line?: number
    endLine?: number
  }>(),
  {
    comparison: undefined,
    error: '',
    offline: false,
    locked: false,
    repository: undefined,
    revision: undefined,
    target: undefined,
    line: undefined,
    endLine: undefined,
  }
)
const visibleText = computed(() =>
  props.model.editing.value ? props.model.draftText.value : (props.model.document.value?.text ?? '')
)
const editable = computed(
  () =>
    props.model.editing.value &&
    !props.locked &&
    !props.model.saving.value &&
    !props.model.draft.value?.pending
)
const range = computed(() => {
  if (!props.line) return
  const count = visibleText.value.split('\n').length
  return props.line <= count
    ? { start: props.line, end: Math.min(count, props.endLine ?? props.line) }
    : undefined
})
const root = ref<HTMLElement>()
const glyphHost = ref<HTMLElement>()
</script>
