<template>
  <Modal :title="'sample.ts'" size="tall" close-in-footer @close="emit('close')">
    <FileView :path="'sample.ts'" :text="text" mode="file" :code-target="target" :line="line" />
    <span v-if="destination" data-lsp-destination hidden>{{ destination }}</span>
    <FileView
      v-if="destination.startsWith('node_modules/')"
      data-lsp-dependency
      path="node_modules/sample-types/index.d.ts"
      :text="'/** Sample dependency documentation. */\n\nexport declare const sample: string'"
      mode="file"
      :line="3"
    />
    <template #footer
      ><Button data-lsp-close :text="t('streamB.close.7d9eb7')" @click="emit('close')"
    /></template>
  </Modal>
</template>
<script setup lang="ts">
import { provide, ref } from 'vue'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import Modal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import { t } from '@/i18n'
import FileView from '@/components/nodeWork/FileView.vue'
import { LSP_CONNECTION } from '@/node/lspConnection'
const props = defineProps<{ state: 'missing' | 'untrusted' | 'loading' | 'errors' | 'eslint' }>()
const emit = defineEmits<{ close: [] }>()
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-node',
  projectId: 'sample-project',
  kind: 'workspace' as const,
  id: 'sample-workspace',
}
const text = 'export const sample: string = 42\nconsole.log(sample)\n'
const line = ref<number>()
const destination = ref('')
const installed = ref(false)
const client = new NodeClient(
  { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: '0'.repeat(64) },
  new MemoryClientStore()
)
// Advertised wire metadata, without opening a transport or launching a process.
Object.defineProperty(client, 'channel', {
  value: { channel: { welcome: { methods: ['lsp.v1.install'] } } },
})
client.describe = async () => ({
  capabilities: { capabilities: { lsp_v1: { status: 'supported' } } },
})
client.subscribe = async () => ({})
client.lsp.status = async () =>
  ['typescript', 'eslint'].map((language) => ({
    language,
    server: null,
    version: null,
    found: props.state !== 'missing' || installed.value,
    ...(props.state === 'untrusted' ? { reason: 'untrusted_folder' as const } : {}),
    ...(language === 'eslint'
      ? {
          project_eslint:
            props.state === 'eslint' ? 'missing: install eslint in this project' : 'found',
        }
      : {}),
  }))
client.lsp.open = async () => ({
  servers:
    props.state === 'untrusted' || (props.state === 'missing' && !installed.value)
      ? []
      : ['typescript', 'eslint'],
})
client.lsp.close = async () => ({})
client.lsp.install = async (languages) => {
  installed.value = true
  return languages.map((language) => ({ language, message: 'Sample server installed' }))
}
client.lsp.diagnostics = async (_root, _path, signal) => {
  if (props.state === 'loading')
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve(), { once: true })
    )
  return props.state === 'errors'
    ? ['typescript', 'eslint'].map((source) => ({
        source,
        severity: source === 'typescript' ? 1 : 2,
        message:
          source === 'typescript'
            ? 'Type number is not assignable to type string.'
            : 'Sample identifier must follow the configured naming convention.',
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      }))
    : []
}
client.lsp.hover = async () => ({ text: 'const sample: string\nSample documentation.' })
client.lsp.definition = async () => [
  {
    path: 'node_modules/sample-types/index.d.ts',
    range: { start: { line: 2, character: 21 }, end: { line: 2, character: 27 } },
  },
]
client.lsp.references = async () => [
  {
    path: 'sample.ts',
    range: { start: { line: 1, character: 12 }, end: { line: 1, character: 18 } },
  },
]
provide(LSP_CONNECTION, {
  client,
  connect: async () => {},
  navigate(locations) {
    line.value = locations[0].range.start.line + 1
    destination.value = `${locations[0].path}:${line.value}`
  },
})
</script>
