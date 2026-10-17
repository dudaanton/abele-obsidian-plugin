<template>
  <Modal title="Agent debugger access" size="tall" @close="emit('close')">
    <p class="setting-item-description">
      {{ label }} · Grants issued by you on this device. Access ends when its run ends.
    </p>
    <p class="setting-item-description">
      Other owners’ grants are hidden. Only the owner who issued a grant can revoke or delete it.
    </p>
    <Button text="Refresh" :disabled="busy" @click="load" />
    <p v-if="!model.supported && loaded" role="status">{{ UPDATE_NODE }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loaded && model.supported && !model.grants.length">
      No debugger grants issued by you.
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
        tooltip="Revoke debugger access"
        :disabled="busy || !model.canManage(grant)"
        @click="change(grant.grant_id, false)"
      />
      <Icon
        icon="trash-2"
        tooltip="Delete this grant. Only grants you issued can be deleted. Operation history is retained."
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
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { DebuggerAccess, UPDATE_NODE, type DebuggerGrant } from './access'
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
    error.value = e instanceof Error ? e.message : 'Debugger grants unavailable'
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
    error.value = e instanceof Error ? e.message : 'Debugger grant could not be changed'
  } finally {
    busy.value = false
  }
}
function grantDescription(grant: DebuggerGrant) {
  const state = grant.revoked
    ? 'Revoked'
    : Date.parse(grant.expires_at) <= Date.now()
      ? 'Expired'
      : 'Active'
  return `${state} · ${grant.actions.join(', ')} · ${grant.mode} · ${grant.conversation_id} · Expires ${new Date(grant.expires_at).toLocaleString()}`
}
onMounted(load)
</script>
