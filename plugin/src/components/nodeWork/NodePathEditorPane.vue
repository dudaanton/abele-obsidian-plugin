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
    <GithubCode
      v-if="model.document.value"
      :text="visibleText"
      :path="model.filePath.value"
      :editable="
        model.editing.value && !locked && !model.saving.value && !model.draft.value?.pending
      "
      @change="model.editText($event)"
    />
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import type { RepositorySource } from '@/repository/source'
import NodeFileTools from './NodeFileTools.vue'
import NodeLspTools from './NodeLspTools.vue'
import type { PathTarget } from '@/node/NodePathModel'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import GithubCode from '../github/GithubCode.vue'
import NodeFileSaveState from '../NodeFileSaveState.vue'
const props = withDefaults(
  defineProps<{
    model: NodeFilesModel
    target?: PathTarget
    error?: string
    offline?: boolean
    locked?: boolean
    repository?: RepositorySource
    revision?: string
  }>(),
  {
    error: '',
    offline: false,
    locked: false,
    repository: undefined,
    revision: undefined,
    target: undefined,
  }
)
const root = ref<HTMLElement>()
const glyphHost = ref<HTMLElement>()
const visibleText = computed(() =>
  props.model.editing.value ? props.model.draftText.value : (props.model.document.value?.text ?? '')
)
</script>
