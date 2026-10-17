<template>
  <ObsidianModal
    :title="
      isNew
        ? t('settings.ai.McpServerModal.add_mcp_server.0e3e58f9')
        : t('settings.ai.McpServerModal.edit_mcp_server.35d90caa')
    "
    size="tall"
    @close="emit('close')"
  >
    <div class="abele-mcp-server">
      <Setting :name="t('settings.ai.McpServerModal.name.dcd1d522')" :desc="nameDesc">
        <Input
          v-model:model-value="form.name"
          :placeholder="
            t('settings.ai.McpServerModal.e_g_context.e900fc3c', { literal0: String('context7') })
          "
        />
      </Setting>
      <div v-if="clash" class="abele-mcp-server__error">
        {{ t('settings.ai.McpServerModal.another_server_already_has_this.8e96ea34') }}
      </div>

      <Setting
        name="URL"
        :desc="t('settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59')"
      >
        <Input v-model:model-value="form.url" placeholder="https://example.com/mcp" />
      </Setting>

      <Setting
        :name="t('settings.ai.McpServerModal.on.13001175')"
        :desc="t('settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37')"
      >
        <Checkbox :is-enabled="form.enabled" @toggle="form.enabled = !form.enabled" />
      </Setting>

      <Setting
        :name="t('settings.ai.McpServerModal.token.d2089be6')"
        :desc="t('settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3')"
      >
        <SecretField
          v-model="token"
          :value="forgetToken ? '' : storedToken"
          :placeholder="t('settings.ai.McpServerModal.optional.59be7133')"
          :replace-placeholder="t('settings.ai.McpServerModal.new_token.564f08bc')"
          :save-tooltip="t('settings.ai.McpServerModal.save_the_token.8326f085')"
          :what="t('settings.ai.McpServerModal.the_token.d22bffce')"
          @save="saveToken"
        >
          <template #actions>
            <Icon
              icon="trash"
              :tooltip="t('settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436')"
              @click="forgetToken = true"
            />
          </template>
        </SecretField>
      </Setting>

      <Setting :name="t('settings.ai.McpServerModal.headers.194e9fe6')" :desc="headersDesc">
        <Input
          v-model:model-value="headersText"
          as-text-area
          :rows="3"
          :placeholder="HEADERS_EXAMPLE"
        />
      </Setting>

      <Section
        :title="t('settings.ai.McpServerModal.tools.ea93d6a2')"
        :desc="t('settings.ai.McpServerModal.what_agents_are_told_is.7591a661')"
      >
        <div class="abele-mcp-server__fetch">
          <Button
            :text="t('settings.ai.McpServerModal.fetch_tools.4788d40d')"
            :disabled="!form.url || fetching"
            :tooltip="
              form.url
                ? t('settings.ai.McpServerModal.connect_to_the_server_and.db04f00f')
                : t('settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f')
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
    </div>

    <template #footer>
      <Button
        :text="t('settings.ai.McpServerModal.save.1509f561')"
        accent
        :disabled="!canSave"
        :tooltip="
          canSave
            ? t('settings.ai.McpServerModal.keep_this_server_and_close.f4798cef')
            : t('settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc')
        "
        @click="onSave"
      />
      <Button
        v-if="!isNew"
        :text="t('settings.ai.McpServerModal.delete.e2d0a549')"
        warning
        :tooltip="t('settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c')"
        @click="confirming = true"
      />
    </template>

    <ConfirmModal
      v-if="confirming"
      :title="t('settings.ai.McpServerModal.delete_mcp_server.1a969bef')"
      :message="
        t('settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d', {
          value0: String(form.name || form.url),
        })
      "
      :confirm-tooltip="
        t('settings.ai.McpServerModal.delete_value.8782b778', {
          value0: String(form.name || form.url),
        })
      "
      @confirm="onDelete"
      @close="confirming = false"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { settingsCount } from '@/i18n/settingsCounts'
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
const headersDesc = t('settings.mcp.headersDescription', { example: '${abele_key:name}' })

const form = reactive<McpServer>(JSON.parse(JSON.stringify(props.server)) as McpServer)
const headersText = ref(formatHeaders(form.headers))
const token = ref('')
/** Only a token entered in this dialog, never one read from a saved server. */
const draftToken = ref('')
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
  draftToken.value = typed
  forgetToken.value = false
  token.value = ''
}
const clash = computed(() => !!form.name.trim() && nameClash(props.servers, form.name, form.id))
const canSave = computed(() => !!form.name.trim() && !!form.url.trim() && !clash.value)

const nameDesc = computed(() =>
  t('settings.ai.McpServerModal.also_the_start_of_its.6f23c597', {
    value0: String(mcpServerSlug(form.name || 'name')),
  })
)

const status = computed(() => {
  if (fetching.value) return t('settings.ai.McpServerModal.fetching.8d0738c8')
  if (!form.fetchedAt) return t('settings.ai.McpServerModal.not_fetched_yet.d17fdec2')
  const count = form.tools.length
  const when = new Date(form.fetchedAt).toLocaleString()
  return t('settings.mcp.fetched', { tools: settingsCount('tool', count), when })
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
    const options = forgetToken.value
      ? { token: typed }
      : typed || draftToken.value
        ? { token: typed || draftToken.value }
        : {}
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
</style>
