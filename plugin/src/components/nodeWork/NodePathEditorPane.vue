<template>
  <div class="abele-node-main">
    <div v-if="error" role="alert">{{ error }}</div>
    <div v-if="offline" role="status">Offline · your local draft is retained.</div>
    <div v-if="locked" role="status">
      Editing is not enabled for this target. Use the header action to approve this external
      worktree.
    </div>
    <NodeFileSaveState :model="model" :offline="offline" :locked="locked" />
    <GithubCode
      v-if="model.document.value"
      :text="model.editing.value ? model.draftText.value : (model.document.value.text ?? '')"
      :path="model.filePath.value"
      :editable="
        model.editing.value && !locked && !model.saving.value && !model.draft.value?.pending
      "
      @change="model.editText($event)"
    />
  </div>
</template>
<script setup lang="ts">
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import GithubCode from '../github/GithubCode.vue'
import NodeFileSaveState from '../NodeFileSaveState.vue'
withDefaults(
  defineProps<{ model: NodeFilesModel; error?: string; offline?: boolean; locked?: boolean }>(),
  { error: '', offline: false, locked: false }
)
</script>
