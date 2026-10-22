<template>
  <Modal :title="'sample.ts'" size="tall" close-in-footer @close="emit('close')">
    <div class="abele-lsp-fixture-header" data-lsp-settle @lsp-settle="settle?.()">
      <span>{{ state === 'off' ? 'sample.txt' : 'sample.ts' }}</span>
      <span ref="headerHost" class="abele-analysis-header">
        <Icon
          v-if="Platform.isPhone"
          data-lsp-overflow
          icon="more-horizontal"
          :tooltip="t('node.analysis.title')"
          @click="overflow"
        />
      </span>
    </div>
    <FileView
      :path="state === 'off' ? 'sample.txt' : 'sample.ts'"
      :text="text"
      mode="file"
      :code-target="target"
      :line="line"
    />
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
import { ANALYSIS_HEADER } from '@/node/analysisHeader'
import Icon from '@/components/obsidian/Icon.vue'
import { Menu, Platform } from 'obsidian'
const headerHost = ref<HTMLElement>()
let analysisMenu: ((menu: Menu) => void) | undefined
provide(ANALYSIS_HEADER, {
  get host() {
    return headerHost.value
  },
  register(populate) {
    analysisMenu = populate
    return () => {
      if (analysisMenu === populate) analysisMenu = undefined
    }
  },
})
function overflow(event: MouseEvent) {
  const menu = new Menu().setUseNativeMenu(false)
  analysisMenu?.(menu)
  menu.showAtMouseEvent(event)
}
const props = defineProps<{
  state: 'missing' | 'untrusted' | 'loading' | 'errors' | 'eslint' | 'failed' | 'off' | 'ready'
}>()
let settle: (() => void) | undefined
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
  value: { channel: { welcome: { methods: ['lsp.v1.install', 'project.trust'] } } },
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
client.lsp.open = async () => {
  if (props.state === 'failed') throw new Error('Sample analysis server stopped')
  return {
    servers:
      props.state === 'untrusted' || (props.state === 'missing' && !installed.value)
        ? []
        : ['typescript', 'eslint'],
  }
}
client.lsp.close = async () => ({})
client.lsp.install = async (languages) => {
  installed.value = true
  return languages.map((language) => ({ language, message: 'Sample server installed' }))
}
client.lsp.diagnostics = async (_root, _path, signal) => {
  if (props.state === 'loading')
    await new Promise<void>((resolve) => {
      settle = resolve
      signal?.addEventListener('abort', () => resolve(), { once: true })
    })
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
<style scoped>
.abele-lsp-fixture-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block: var(--size-4-2);
}
</style>
