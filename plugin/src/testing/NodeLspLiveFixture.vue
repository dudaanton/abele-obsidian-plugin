<template>
  <Modal title="sample.ts" size="tall" close-in-footer @close="$emit('close')">
    <GithubFiles
      v-if="comparison && changes"
      :files="changes.files.filter((file) => file.path === 'sample.ts')"
      :refs="{ head: changes.headSha, base: changes.mergeBaseSha }"
    />
    <FileView
      v-else-if="!comparison"
      path="sample.ts"
      :text="text"
      mode="file"
      :code-target="target"
    />
    <template #footer><Button data-lsp-close text="Close" @click="$emit('close')" /></template>
  </Modal>
</template>
<script setup lang="ts">
import type { PathTarget } from '@/node/NodePathModel'
import Modal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import FileView from '@/components/nodeWork/FileView.vue'
import GithubFiles from '@/components/github/GithubFiles.vue'
import { computed, onMounted, onBeforeUnmount, provide, shallowRef } from 'vue'
import { NodeRepositorySource } from '@/repository/node'
import { NodeService } from '@/node/NodeService'
import { REPOSITORY_SOURCE } from '@/repository/context'
import type { CompareData } from '@/repository/model'
const props = defineProps<{ target: PathTarget; text: string; comparison?: boolean }>()
const source = props.comparison
  ? new NodeRepositorySource(
      NodeService.connectionIfKnown(props.target.registrationId).client,
      {
        provider: 'node',
        installation: 'sample-installation',
        node: props.target.registrationId,
        project: props.target.projectId,
        workspace: props.target.id,
      },
      { node: 'Sample node', project: 'Sample project' }
    )
  : undefined
provide(
  REPOSITORY_SOURCE,
  computed(() => source ?? null)
)
const changes = shallowRef<CompareData>()
onMounted(async () => {
  if (source) changes.value = await source.compare('HEAD~1', 'HEAD')
})
onBeforeUnmount(() => source?.dispose())
defineEmits<{ close: [] }>()
</script>
