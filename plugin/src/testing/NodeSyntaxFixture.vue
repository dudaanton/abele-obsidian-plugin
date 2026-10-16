<template>
  <Modal title="Sample file highlighting" size="tall" @close="$emit('close')">
    <div class="abele-syntax-fixture">
      <FileView v-if="kind !== 'diff'" :path="path" :text="text" mode="file" />
      <Diff v-else :text-left="text" :text-right="text.replace('1', '2')" path="sample.ts" />
      <p>Tool code</p>
      <pre><code><SyntaxText :text="text" :path="path" /></code></pre>
      <p>Obsidian code block</p>
      <div ref="reference" class="markdown-rendered" />
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Component, MarkdownRenderer } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import Modal from '@/components/obsidian/Modal.vue'
import FileView from '@/components/nodeWork/FileView.vue'
import Diff from '@/components/Diff.vue'
import SyntaxText from '@/components/SyntaxText.vue'
const props = defineProps<{ kind: 'sh' | 'ts' | 'diff' }>()
defineEmits<{ (event: 'close'): void }>()
const path = props.kind === 'sh' ? 'sample.sh' : 'sample.ts'
const text =
  props.kind === 'sh'
    ? '#!/bin/bash\nset -e\nvalue="sample"\nif [ -z "$value" ]; then\n  exit 1\nfi\n'
    : 'export const sample = 1\nfunction value() {\n  return "sample"\n}\n'
const reference = ref<HTMLElement>()
const component = new Component()
onMounted(async () => {
  component.load()
  if (reference.value)
    await MarkdownRenderer.render(
      GlobalStore.getInstance().app,
      '```' + (props.kind === 'sh' ? 'bash' : 'typescript') + '\n' + text + '```',
      reference.value,
      '',
      component
    )
})
onBeforeUnmount(() => component.unload())
</script>
