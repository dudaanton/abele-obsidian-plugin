<template>
  <Modal :title="t('debuggerAccess.title')" size="tall" @close="emit('close')">
    <Section :desc="t('debuggerAccess.issuerOnly')">
      <template #lead>
        <span class="setting-item-description">{{ label }} · {{ t('debuggerAccess.issued') }}</span>
      </template>
      <template #actions>
        <Icon
          icon="rotate-cw"
          :tooltip="t('debuggerAccess.refresh')"
          :disabled="busy"
          @click="load"
        />
      </template>
    </Section>
    <p v-if="!model.supported && loaded" role="status">{{ t('debuggerAccess.updateNode') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loaded && model.supported && !model.grants.length">
      {{ t('debuggerAccess.empty') }}
    </p>
    <Setting
      v-for="grant in model.grants"
      :key="grant.grant_id"
      :name="grant.debug_session_id"
      :desc="grantDescription(grant)"
    >
      <Icon
        v-if="!grant.revoked"
        icon="shield-off"
        :tooltip="t('debuggerAccess.revoke')"
        :disabled="busy || !model.canManage(grant)"
        @click="change(grant.grant_id, false)"
      />
      <Icon
        icon="trash-2"
        :tooltip="t('debuggerAccess.deleteTip')"
        :disabled="busy || !model.canManage(grant)"
        @click="change(grant.grant_id, true)"
      />
    </Setting>
  </Modal>
</template>
<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
import Modal from '@/components/obsidian/Modal.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Section from '@/components/obsidian/Section.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { DebuggerAccess, debuggerAccessLabel, type DebuggerGrant } from './access'
import { useI18n } from '@/i18n/useI18n'
import { formatDate } from '@/i18n'
const { t, locale } = useI18n()
const props = defineProps<{ connection: NodeConnection; label: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const model = reactive(
  new DebuggerAccess((method, params) => props.connection.client.request(method, params))
)
const busy = ref(false),
  loaded = ref(false),
  error = ref('')
async function load() {
  busy.value = true
  error.value = ''
  try {
    await props.connection.connect()
    await model.loadGrants(await props.connection.client.describe())
    loaded.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('debuggerAccess.grantsUnavailable')
  } finally {
    busy.value = false
  }
}
async function change(id: string, remove: boolean) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    // grant.list is issuer-filtered by the authenticated node; other owners' rows never get actions.
    if (remove) await model.remove(id)
    else await model.revoke(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('debuggerAccess.changeFailed')
  } finally {
    busy.value = false
  }
}
function grantDescription(grant: DebuggerGrant) {
  const state = grant.revoked
    ? t('debuggerAccess.state.revoked')
    : Date.parse(grant.expires_at) <= Date.now()
      ? t('debuggerAccess.state.expired')
      : t('debuggerAccess.state.active')
  return t('debuggerAccess.grantDescription', {
    state,
    actions: grant.actions.map(debuggerAccessLabel).join(', '),
    mode: grant.mode === 'ask' ? t('debuggerAccess.mode.ask') : t('debuggerAccess.mode.allowAll'),
    conversation: grant.conversation_id,
    expires: formatDate(new Date(grant.expires_at), locale.format, {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
  })
}
onMounted(load)
</script>
