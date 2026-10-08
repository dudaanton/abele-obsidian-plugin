<template>
  <Modal title="Pair a remote node" @close="emit('close')">
    <div class="abele-node-pairing">
      <template v-if="!invite">
        <p>
          On the node, create an invitation with <code>abele-node pair invite</code>. Keep it
          private. Paste its JSON or photograph its QR code.
        </p>
        <Setting name="Node label"
          ><Input v-model="label" aria-label="Remote node label"
        /></Setting>
        <Setting name="Invitation">
          <Input
            v-model="raw"
            as-text-area
            aria-label="Node invitation"
            placeholder="Paste invitation JSON"
          />
        </Setting>
        <div class="abele-node-pairing__actions">
          <Button text="Scan invitation QR" :disabled="busy" @click="photo?.click()" />
          <Button text="Review invitation" :disabled="busy || !raw.trim()" @click="review" />
        </div>
        <input
          ref="photo"
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Invitation QR photo"
          @change="readPhoto"
        />
        <Button
          v-for="device in pending"
          :key="device.node_id"
          :text="`Resume pairing: ${device.enrollment!.label}`"
          @click="resume(device)"
        />
      </template>
      <template v-else>
        <p>{{ label }} · {{ invite.endpoint }}</p>
        <p>Compare the full node key fingerprint with the owner before pairing:</p>
        <code aria-label="Node key fingerprint">{{ invite.node_fingerprint }}</code>
        <template v-if="previousPin && previousPin !== invite.node_fingerprint">
          <p>The node key changed. A failed connection never authorizes this change.</p>
          <p>Previously pinned node key:</p>
          <code>{{ previousPin }}</code>
          <label class="abele-node-pairing__verification">
            <input v-model="verified" type="checkbox" aria-label="Owner verified new node key" />
            I independently verified the new node key with the owner.
          </label>
        </template>
        <template v-if="!node">
          <p v-if="deviceFingerprint">
            This device's fingerprint: <code>{{ deviceFingerprint }}</code>
          </p>
          <Button
            text="Pair this device"
            accent
            :disabled="
              busy ||
              !label.trim() ||
              (!!previousPin && previousPin !== invite.node_fingerprint && !verified)
            "
            @click="pair"
          />
          <p>Only owner confirmation of this device's exact fingerprint grants access.</p>
          <Button text="Use another invitation" :disabled="busy" @click="reset" />
        </template>
        <template v-else>
          <p role="status">
            {{ connected ? 'Connected over paired WSS' : 'Waiting for owner confirmation' }}
          </p>
          <p>Ask the owner to compare this full device fingerprint and confirm it on the node:</p>
          <code aria-label="Device key fingerprint">{{ deviceFingerprint }}</code>
          <p>Installation: {{ installationId }}</p>
          <p v-if="!connected">
            Leave this open, or return to Nodes later. A lost reply can be recovered with the same
            invitation and the same device key.
          </p>
          <Button text="Check owner confirmation" :disabled="busy || connected" @click="check" />
          <Button text="Use another invitation" :disabled="busy" @click="reset" />
        </template>
      </template>
      <p v-if="message" role="alert">{{ message }}</p>
      <p>
        Revocation is done by the owner with <code>abele-node pair revoke</code>. To re-pair, use a
        fresh invitation bound to the same installation. Removing a connection here does not revoke
        node access or delete history.
      </p>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { InviteSchema, assertPairedEndpoint, type PairingInvite } from '@abele/channel-protocol'
import type { NodeService } from '@/node/NodeService'
import type { RegisteredNode } from '@/node/NodeRegistry'
import { isPairedNode } from '@/node/NodeRegistry'
import type { EnrollingDevice } from '@/node/NodeDeviceKeyStore'
import { invitationPhoto } from '@/node/invitationPhoto'
import Modal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
const props = defineProps<{ service: NodeService; resumeNodeId?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const label = ref('Remote node'),
  raw = ref(''),
  message = ref(''),
  previousPin = ref(''),
  deviceFingerprint = ref('')
const invite = ref<PairingInvite>(),
  node = ref<RegisteredNode>(),
  busy = ref(false),
  verified = ref(false),
  connected = ref(false)
const pending = ref<EnrollingDevice[]>([]),
  photo = ref<HTMLInputElement>()
const installationId = ref('')
let closed = false
let timer: ReturnType<typeof setTimeout> | undefined
const report = (error: unknown) => {
  message.value = error instanceof Error ? error.message : 'Pairing failed'
}
const review = async () => {
  message.value = ''
  try {
    const parsed = InviteSchema.parse(JSON.parse(raw.value))
    assertPairedEndpoint(parsed.endpoint)
    const stored = await props.service.deviceKeys.load(parsed.node_id)
    if (closed) return
    previousPin.value = stored?.node_fingerprint ?? ''
    verified.value = false
    invite.value = parsed
    raw.value = ''
  } catch {
    message.value = 'Invalid invitation. Paste the complete invitation JSON from the node.'
  }
}
const resume = async (device: EnrollingDevice) => {
  label.value = device.enrollment.label
  raw.value = JSON.stringify(device.enrollment.invite)
  await review()
  deviceFingerprint.value = await props.service.deviceFingerprint(device.node_id)
  const registered = props.service.nodes.value.find(
    (n) =>
      isPairedNode(n) &&
      n.expectedNodeId === device.node_id &&
      n.installationId === device.installation_id
  )
  if (registered && isPairedNode(registered)) {
    node.value = registered
    installationId.value = registered.installationId
    void check()
  }
}
const reset = () => {
  window.clearTimeout(timer)
  invite.value = undefined
  node.value = undefined
  deviceFingerprint.value = ''
  previousPin.value = ''
  verified.value = false
  message.value = ''
  connected.value = false
}
const pair = async () => {
  const current = invite.value
  if (!current || busy.value || !label.value.trim()) return
  if (previousPin.value && previousPin.value !== current.node_fingerprint && !verified.value) return
  busy.value = true
  message.value = ''
  try {
    if (previousPin.value && previousPin.value !== current.node_fingerprint) {
      await props.service.pairedConnector.authorizeNodeKeyChange(current, previousPin.value)
      // The explicit pin transaction committed even if the following claim reply is lost.
      previousPin.value = current.node_fingerprint
    }
    node.value = await props.service.pair(label.value.trim(), current)
    installationId.value = isPairedNode(node.value) ? node.value.installationId : ''
    deviceFingerprint.value = await props.service.deviceFingerprint(current.node_id)
  } catch (error) {
    deviceFingerprint.value = await props.service.deviceFingerprint(current.node_id).catch(() => '')
    report(error)
    message.value +=
      '. Retry with this same invitation to recover a lost reply; do not create a new device key.'
  } finally {
    busy.value = false
  }
  if (node.value && !closed) void check()
}
const check = async () => {
  if (!node.value || busy.value || closed) return
  window.clearTimeout(timer)
  busy.value = true
  try {
    await props.service.connection(node.value.id).connect()
    if (closed) return
    connected.value = true
    message.value = ''
    await props.service.deviceKeys.finishEnrollment(node.value.expectedNodeId)
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
    if (!closed && !connected.value)
      timer = window.setTimeout(() => {
        void check()
      }, 2000)
  }
}
const readPhoto = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  message.value = ''
  try {
    raw.value = await invitationPhoto(file)
    await review()
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
    input.value = ''
  }
}
onMounted(() => {
  void props.service.deviceKeys
    .pending()
    .then(async (devices) => {
      if (closed) return
      pending.value = devices
      const selected = devices.find((d) => d.node_id === props.resumeNodeId)
      if (selected) await resume(selected)
    })
    .catch(report)
})
onUnmounted(() => {
  closed = true
  window.clearTimeout(timer)
})
</script>
<style lang="scss">
.abele-node-pairing {
  min-width: 0;
  overflow-wrap: anywhere;
  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .setting-item {
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }
  .setting-item-control {
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }
  textarea {
    width: 100%;
    min-height: 100px;
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    padding: var(--size-4-1);
  }
  &__verification {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    margin-block: var(--size-4-2);
  }
}
</style>
