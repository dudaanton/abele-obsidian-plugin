<template>
  <ObsidianModal
    :title="isNew ? 'Add MCP server' : 'Edit MCP server'"
    size="tall"
    @close="emit('close')"
  >
    <div class="abele-mcp-server">
      <Setting name="Name" :desc="nameDesc">
        <Input v-model:model-value="form.name" placeholder="e.g. context7" />
      </Setting>
      <div v-if="clash" class="abele-mcp-server__error">
        Another server already has this name. Tool names come from it, so it has to differ.
      </div>

      <Setting name="URL" desc="The server's MCP endpoint, reached over HTTP.">
        <Input v-model:model-value="form.url" placeholder="https://example.com/mcp" />
      </Setting>

      <Setting name="On" desc="Off keeps it here and gives its tools to no agent.">
        <Checkbox :is-enabled="form.enabled" @toggle="form.enabled = !form.enabled" />
      </Setting>

      <Setting
        name="Token"
        desc="Sent as Authorization: Bearer. Stored in the keychain, never in the settings file."
      >
        <SecretField
          v-model="token"
          :value="forgetToken ? '' : storedToken"
          placeholder="Optional"
          replace-placeholder="New token..."
          save-tooltip="Save the token"
          what="The token"
          @save="saveToken"
        >
          <template #actions>
            <Icon
              icon="trash"
              tooltip="Forget the stored token when saving"
              @click="forgetToken = true"
            />
          </template>
        </SecretField>
      </Setting>

      <Setting name="Headers" :desc="headersDesc">
        <Input
          v-model:model-value="headersText"
          as-text-area
          :rows="3"
          :placeholder="HEADERS_EXAMPLE"
        />
      </Setting>

      <Section
        title="Tools"
        desc="What agents are told is this list as it was fetched. It changes only when you fetch it
          again here and save."
      >
        <div class="abele-mcp-server__fetch">
          <Button
            text="Fetch tools"
            :disabled="!form.url || fetching"
            :tooltip="
              form.url
                ? 'Connect to the server and read the tools it offers'
                : 'Needs the server URL first'
            "
            @click="fetchTools"
          />
          <span class="abele-mcp-server__status">{{ status }}</span>
        </div>
        <div v-if="fetchError" class="abele-mcp-server__error">{{ fetchError }}</div>

        <Setting
          v-for="tool in form.tools"
          :key="tool.name"
          :name="tool.title || tool.name"
          :desc="tool.description"
        />
      </Section>

      <div class="abele-mcp-server__actions">
        <Button
          text="Save"
          accent
          :disabled="!canSave"
          :tooltip="canSave ? 'Keep this server and close' : 'Needs a name of its own and a URL'"
          @click="onSave"
        />
        <Button
          v-if="!isNew"
          text="Delete"
          warning
          tooltip="Remove this server; agents lose its tools"
          @click="confirming = true"
        />
      </div>
    </div>

    <ConfirmModal
      v-if="confirming"
      title="Delete MCP server"
      :message="`Delete ${form.name || form.url}? Every agent loses its tools.`"
      :confirm-tooltip="`Delete ${form.name || form.url}`"
      @confirm="onDelete"
      @close="confirming = false"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Input from '../../obsidian/Input.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import SecretField from '../SecretField.vue'
import { McpService } from '@/ai/mcp/McpService'
import { formatHeaders, mcpKeyId, nameClash, parseHeaders } from '@/ai/mcp/settings'
import { mcpServerSlug } from '@/ai/mcp/names'
import { secrets } from '@/secrets/SecretStore'
import type { McpServer } from '@/ai/mcp/types'

const props = defineProps<{
  server: McpServer
  servers: McpServer[]
  isNew?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** `token`: a new one to store, `null` to forget the stored one, absent to leave it. */
  (e: 'save', server: McpServer, token?: string | null): void
  (e: 'delete'): void
}>()

/** Written out here: a `${…}` in a template attribute reads like an expression to a person. */
const HEADERS_EXAMPLE = 'X-Api-Key: ${abele_key:name}'
const headersDesc =
  'One per line, as Name: value. Write a secret as ${abele_key:name}, a key kept under AI → ' +
  'General → Stored keys, so it stays out of the settings file.'

const form = reactive<McpServer>(JSON.parse(JSON.stringify(props.server)) as McpServer)
const headersText = ref(formatHeaders(form.headers))
const token = ref('')
const forgetToken = ref(false)
const fetching = ref(false)
const fetchError = ref('')
/** Held open until the question is answered — see docs/Design.md. */
const confirming = ref(false)

const storedToken = ref(props.server.keyId ? secrets().get(props.server.keyId) : '')

/** The tick beside the field: the token goes into the keychain now, under this server's slot. */
function saveToken(): void {
  const typed = token.value.trim()
  if (!typed) return
  form.keyId = mcpKeyId(form.id)
  secrets().set(form.keyId, typed)
  storedToken.value = typed
  forgetToken.value = false
  token.value = ''
}
const clash = computed(() => !!form.name.trim() && nameClash(props.servers, form.name, form.id))
const canSave = computed(() => !!form.name.trim() && !!form.url.trim() && !clash.value)

const nameDesc = computed(
  () => `Also the start of its tools' names: mcp_${mcpServerSlug(form.name || 'name')}_<tool>.`
)

const status = computed(() => {
  if (fetching.value) return 'Fetching…'
  if (!form.fetchedAt) return 'Not fetched yet'
  const count = form.tools.length
  const when = new Date(form.fetchedAt).toLocaleString()
  return `${count} ${count === 1 ? 'tool' : 'tools'}, fetched ${when}`
})

/** The server as the form has it now, for fetching before anything is saved. */
const current = (): McpServer => ({
  ...JSON.parse(JSON.stringify(form)),
  name: form.name.trim(),
  url: form.url.trim(),
  headers: parseHeaders(headersText.value),
})

async function fetchTools(): Promise<void> {
  fetching.value = true
  fetchError.value = ''
  try {
    const typed = token.value.trim()
    const options = typed ? { token: typed } : forgetToken.value ? { token: '' } : {}
    form.tools = await McpService.getInstance().fetchTools(current(), options)
    form.fetchedAt = new Date().toISOString()
  } catch (error) {
    fetchError.value = error instanceof Error ? error.message : String(error)
  } finally {
    fetching.value = false
  }
}

const onSave = () => {
  const typed = token.value.trim()
  emit('save', current(), typed ? typed : forgetToken.value ? null : undefined)
  emit('close')
}

const onDelete = () => {
  emit('delete')
  emit('close')
}
</script>

<style lang="scss">
.abele-mcp-server__fetch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-2);
}

.abele-mcp-server__status {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-mcp-server__error {
  color: var(--text-error);
  font-size: var(--font-ui-small);
  padding-bottom: var(--size-4-2);
  overflow-wrap: anywhere;
}

.abele-mcp-server__actions {
  display: flex;
  gap: var(--size-4-2);
  justify-content: flex-end;
  padding-top: var(--size-4-3);
  border-top: 1px solid var(--background-modifier-border);
  margin-top: var(--size-4-2);
}
</style>
