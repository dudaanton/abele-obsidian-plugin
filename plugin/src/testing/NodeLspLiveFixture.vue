<template>
  <Modal title="sample.ts" size="tall" close-in-footer @close="$emit('close')">
    <FileView path="sample.ts" :text="text" mode="file" :code-target="target" />
    <template #footer><Button data-lsp-close text="Close" @click="$emit('close')" /></template>
  </Modal>
</template>
<script setup lang="ts">
import type { PathTarget } from '@/node/NodePathModel'
import Modal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import FileView from '@/components/nodeWork/FileView.vue'
defineProps<{ target: PathTarget; text: string }>()
defineEmits<{ close: [] }>()
</script>
