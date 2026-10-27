<template>
  <Modal :title="'sample.ts'" size="tall" close-in-footer @close="emit('close')">
    <div
      class="abele-lsp-fixture-header"
      data-lsp-settle
      @lsp-settle="settle?.()"
      @reference-mode="changeReferencesMode"
    >
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
      :path="state === 'off' ? 'sample.txt' : previewPath"
      :text="previewText"
      :mode="admission === 'comparison' ? 'diff' : 'file'"
      :change="
        admission === 'comparison' || admission === 'contentUnavailable'
          ? {
              path: 'sample.ts',
              kind: 'modified',
              before: 'before',
              after: text,
              added: 1,
              removed: 1,
              ...(admission === 'contentUnavailable'
                ? { previewNote: 'Sample content omitted' }
                : {}),
            }
          : undefined
      "
      :revision="admission === 'pastRevision' ? 'sample-commit' : undefined"
      :offline="admission === 'offline'"
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
  admission?: string
}>()
let settle: (() => void) | undefined
const emit = defineEmits<{ close: [] }>()
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-node',
  projectId: 'sample-project',
  kind: props.admission === 'linkedWorktree' ? ('worktree' as const) : ('workspace' as const),
  id: props.admission === 'linkedWorktree' ? 'sample-linked-worktree' : 'sample-workspace',
}
const text =
  props.admission === 'fileTooLarge'
    ? '/*' + 'x'.repeat(512 * 1024) + '*/'
    : 'export const sample: string = 42\nconsole.log(sample)\n'
const line = ref<number>()
const previewPath = ref('sample.ts')
const previewText = ref(text)
const destination = ref('')
const installed = ref(false)
const referencesMode = ref('one')
function changeReferencesMode(event: Event) {
  referencesMode.value = (event as CustomEvent<string>).detail
  previewPath.value = 'sample.ts'
  previewText.value = text
  line.value = undefined
}
let referenceQuery = false
const client = new NodeClient(
  { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: '0'.repeat(64) },
  new MemoryClientStore()
)
// Advertised wire metadata, without opening a transport or launching a process.
Object.defineProperty(client, 'channel', {
  value: { channel: { welcome: { methods: ['lsp.v1.install', 'project.trust'] } } },
})
client.describe = async () => {
  if (props.admission === 'describeFailure') throw new Error('Sample description timeout')
  return {
    capabilities: {
      capabilities:
        props.admission === 'nodeUnsupported' ? {} : { lsp_v1: { status: 'supported' } },
    },
  }
}
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
client.lsp.open = async (root, path) => {
  if (
    props.admission === 'linkedWorktree' &&
    (!('worktree_id' in root) || root.worktree_id !== target.id || path !== 'sample.ts')
  )
    throw new Error('Sample linked worktree identity mismatch')
  if (props.admission === 'documentLimit')
    throw Object.assign(new Error('Sample analysis limit'), {
      details: { reason: 'lsp_document_limit' },
    })
  if (props.admission === 'noServers') return { servers: [] }
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
client.lsp.definition = async () =>
  !referenceQuery
    ? [
        {
          path: 'node_modules/sample-types/index.d.ts',
          range: { start: { line: 2, character: 21 }, end: { line: 2, character: 27 } },
        },
      ]
    : [
        {
          path: 'sample.ts',
          range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
        },
      ]
client.readFile = async (workspace_id, path) => ({
  workspace_id,
  path,
  content_id: path,
  size: 100,
  binary: false,
  large: false,
  too_large: false,
})
client.readContent = async (_workspaceId, contentId) => {
  const source =
    contentId === 'sample.ts' ? text : '  sample()\n\nexport declare const sample: string\n'
  return { offset: 0, total: source.length, base64: btoa(source) }
}
client.lsp.references = async () => {
  referenceQuery = true
  return referencesMode.value === 'empty'
    ? []
    : referencesMode.value === 'one'
      ? [
          {
            path: 'sample.ts',
            range: { start: { line: 1, character: 12 }, end: { line: 1, character: 18 } },
          },
        ]
      : [
          {
            path: 'sample.ts',
            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
          },
          {
            path: 'sample.ts',
            range: { start: { line: 1, character: 12 }, end: { line: 1, character: 18 } },
          },
          ...Array.from({ length: referencesMode.value === 'long' ? 108 : 4 }, (_, index) => ({
            path:
              index === 0
                ? 'node_modules/sample-types/index.d.ts'
                : `src/sample-${String(index).padStart(3, '0')}.ts`,
            range:
              index === 0
                ? { start: { line: 2, character: 21 }, end: { line: 2, character: 27 } }
                : { start: { line: 0, character: 2 }, end: { line: 0, character: 8 } },
          })),
        ]
}
if (props.admission !== 'noConnection')
  provide(LSP_CONNECTION, {
    client,
    connect: async () => {},
    navigate(locations) {
      line.value = locations[0].range.start.line + 1
      destination.value = `${locations[0].path}:${line.value}`
      if (referencesMode.value !== 'one') {
        previewPath.value = locations[0].path
        previewText.value = locations[0].path === 'sample.ts' ? text : '  sample()\n'
      }
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
