<template>
  <div class="abele-tool-approval">
    <div class="abele-tool-approval__header">
      <Icon icon="shield-alert" />
      <span>{{ headerText }}</span>
    </div>

    <!-- Create: the file does not exist yet, so its content is all there is to show -->
    <template v-if="message.toolName === 'create'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <pre class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Write: an overwrite of a file that exists, so show what it does to it -->
    <template v-else-if="message.toolName === 'write'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="currentContent !== null"
        :text-left="currentContent"
        :text-right="String(params.content || '')"
        class="abele-tool-approval__diff"
      />
      <pre v-else class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Edit: show diff -->
    <template v-else-if="message.toolName === 'edit'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="params.old_string || params.new_string"
        :text-left="String(params.old_string || '')"
        :text-right="String(params.new_string || '')"
        class="abele-tool-approval__diff"
      />
    </template>

    <!-- eval_js: show code -->
    <template v-else-if="message.toolName === 'eval_js'">
      <pre class="abele-tool-approval__code"><code>{{ params.code }}</code></pre>
    </template>

    <!-- rm: just the path -->
    <template v-else-if="message.toolName === 'rm'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
    </template>

    <!-- mv / cp: from → to -->
    <template v-else-if="message.toolName === 'mv' || message.toolName === 'cp'">
      <div class="abele-tool-approval__move">
        <span>{{ params.from }}</span>
        <span class="abele-tool-approval__arrow">→</span>
        <span>{{ params.to }}</span>
      </div>
    </template>

    <!-- create_script: show name + code preview -->
    <template v-else-if="message.toolName === 'create_script'">
      <div class="abele-tool-approval__path">{{ params.name }}.js</div>
      <pre class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Fallback: readable key-value -->
    <template v-else>
      <div v-for="(val, key) in params" :key="key" class="abele-tool-approval__param">
        <span class="abele-tool-approval__param-key">{{ key }}</span>
        <span>{{ typeof val === 'string' ? val : JSON.stringify(val) }}</span>
      </div>
    </template>

    <!-- Edit JSON (toggle) -->
    <div v-if="isEditing" class="abele-tool-approval__editor">
      <Input
        :model-value="editedArgs"
        as-text-area
        placeholder="Edit arguments (JSON)"
        @update:model-value="editedArgs = $event"
      />
      <div v-if="parseError" class="abele-tool-approval__parse-error">{{ parseError }}</div>
    </div>

    <div class="abele-tool-approval__actions">
      <Button text="Approve" @click="approve" />
      <Button v-if="canAllowAll" text="Allow all" @click="allowAll" />
      <Button text="Edit" @click="toggleEdit" />
      <Button text="Reject" @click="reject" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Input from './obsidian/Input.vue'
import Diff from './Diff.vue'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'
import type { ChatMessage } from '@/ai/types'

const props = defineProps<{
  message: ChatMessage
}>()

const session = computed(() => ChatService.getInstance().activeSession.value)
const isEditing = ref(false)
const editedArgs = ref(JSON.stringify(props.message.toolParams, null, 2))
const params = computed(() => props.message.toolParams || {})

const headerText = computed(() => {
  switch (props.message.toolName) {
    case 'create':
      return 'Create file'
    case 'edit':
      return 'Edit file'
    case 'rm':
      return 'Delete file'
    case 'mv':
      return 'Move file'
    case 'cp':
      return 'Copy file'
    case 'eval_js':
      return 'Execute JavaScript'
    default:
      return `Execute ${props.message.toolName}`
  }
})

/**
 * What the file being written holds right now, or null when there is nothing to compare
 * against — the path names no file, or reading it failed.
 *
 * `write` replaces a file whole, and it only accepts a file that already exists: shown as
 * plain content, its preview says what the file will contain but not what is being taken
 * away. A diff answers the question actually being asked for approval. `create`, whose file
 * does not exist yet, keeps the plain preview: there is nothing to diff against.
 */
const currentContent = ref<string | null>(null)

watch(
  () => [props.message.toolName, params.value.path] as const,
  ([toolName, path]) => {
    currentContent.value = null
    if (toolName !== 'write' || typeof path !== 'string' || !path) return

    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return

    void app.vault
      .read(file)
      .then((content) => {
        // The path can change while the read is in flight; a stale answer must not land.
        if (params.value.path === path) currentContent.value = content
      })
      .catch(() => {
        // An unreadable file is not worth an error in an approval prompt — it falls back to
        // showing the content that would be written.
      })
  },
  { immediate: true }
)

const parseError = ref('')

const approve = () => {
  if (isEditing.value) {
    try {
      const modified = JSON.parse(editedArgs.value)
      parseError.value = ''
      session.value?.approveToolCall(modified)
    } catch (err: unknown) {
      parseError.value = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
      return
    }
  } else {
    session.value?.approveToolCall()
  }
}

const canAllowAll = computed(() => {
  const name = props.message.toolName
  if (!name) return false
  const s = session.value
  if (!s) return false
  // Can "allow all" if this tool is in ask mode (not auto yet)
  return s.getToolMode(name) === 'ask'
})

const allowAll = () => {
  const s = session.value
  const name = props.message.toolName
  if (!s || !name) return
  s.toolModes.value = { ...s.toolModes.value, [name]: 'auto' }
  s.approveToolCall()
}

const reject = () => {
  session.value?.rejectToolCall('User rejected this action')
}

const toggleEdit = () => {
  isEditing.value = !isEditing.value
}
</script>

<style lang="scss">
.abele-tool-approval {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3);
  margin: var(--size-4-2) 0;
  background-color: var(--background-secondary);
}

.abele-tool-approval__header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
  font-weight: 600;
  color: var(--text-normal);
}

.abele-tool-approval__path {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-accent);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__code {
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  max-height: 300px;
  overflow: auto;
  margin-bottom: var(--size-4-2);

  code {
    font-size: var(--font-small);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.abele-tool-approval__diff {
  margin-bottom: var(--size-4-2);
  border-radius: var(--radius-s);
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.abele-tool-approval__move {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__arrow {
  color: var(--text-faint);
}

.abele-tool-approval__param {
  font-size: var(--font-small);
  margin-bottom: var(--size-4-1);

  .abele-tool-approval__param-key {
    font-weight: 600;
    margin-right: var(--size-4-1);
    color: var(--text-muted);

    &::after {
      content: ':';
    }
  }
}

.abele-tool-approval__editor {
  margin-bottom: var(--size-4-2);

  textarea {
    width: 100%;
    min-height: 100px;
    font-family: var(--font-monospace);
    font-size: var(--font-small);
  }
}

.abele-tool-approval__parse-error {
  color: var(--text-error);
  font-size: var(--font-small);
  margin-top: var(--size-4-1);
}

.abele-tool-approval__actions {
  display: flex;
  gap: var(--size-4-2);
}
</style>
