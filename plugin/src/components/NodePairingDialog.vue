<template>
  <Modal :title="t('streamB.pairARemoteNode.0cc6ed')" @close="emit('close')">
    <div class="abele-node-pairing">
      <template v-if="!invite">
        <p>
          {{ t('streamB.onTheNodeCreateAnInvitationWith.ef6ee3') }}
          <code>abele-node pair invite</code>{{ t('streamB.keepItPrivatePasteItsJsonOr.8c08df') }}
        </p>
        <Setting :name="t('streamB.nodeLabel.30d828')"
          ><Input v-model="label" :aria-label="t('streamB.remoteNodeLabel.a83cf4')"
        /></Setting>
        <Setting :name="t('streamB.invitation.af4ea0')">
          <Input
            v-model="raw"
            as-text-area
            :aria-label="t('streamB.nodeInvitation.8bfe00')"
            :placeholder="t('streamB.pasteInvitationJson.7183a3')"
          />
        </Setting>
        <div class="abele-node-pairing__actions">
          <Button
            :text="t('streamB.scanInvitationQr.4d2cf3')"
            :disabled="busy"
            @click="photo?.click()"
          />
          <Button
            :text="t('streamB.reviewInvitation.a26f0c')"
            :disabled="busy || !raw.trim()"
            @click="review"
          />
        </div>
        <input
          ref="photo"
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          :aria-label="t('streamB.invitationQrPhoto.e89adb')"
          @change="readPhoto"
        />
        <Button
          v-for="device in pending"
          :key="device.node_id"
          wrap
          :text="t('streamB.resumePairing.36faff', { v0: String(device.enrollment.label) })"
          @click="resume(device)"
        />
      </template>
      <template v-else>
        <p>{{ label }} · {{ invite.endpoint }}</p>
        <p>{{ t('streamB.compareTheFullNodeKeyFingerprintWith.913ed9') }}</p>
        <code :aria-label="t('streamB.nodeKeyFingerprint.4514b9')">{{
          invite.node_fingerprint
        }}</code>
        <template v-if="previousPin && previousPin !== invite.node_fingerprint">
          <p>{{ t('streamB.theNodeKeyChangedAFailedConnection.230e3c') }}</p>
          <p>{{ t('streamB.previouslyPinnedNodeKey.d8ed7d') }}</p>
          <code>{{ previousPin }}</code>
          <label class="abele-node-pairing__verification">
            <input
              v-model="verified"
              type="checkbox"
              :aria-label="t('streamB.ownerVerifiedNewNodeKey.403281')"
            />
            {{ t('streamB.iIndependentlyVerifiedTheNewNodeKey.24ae0f') }}
          </label>
        </template>
        <template v-if="previousEndpoint && previousEndpoint !== invite.endpoint">
          <p>{{ t('streamB.theEndpointChangedCompareBothAddressesWith.ec60d9') }}</p>
          <p>{{ t('streamB.previouslyBoundEndpoint.c22df0') }}</p>
          <code :aria-label="t('streamB.previousNodeEndpoint.eeb0fd')">{{ previousEndpoint }}</code>
          <p>{{ t('streamB.newEndpoint.980eb5') }}</p>
          <code :aria-label="t('streamB.newNodeEndpoint.6af731')">{{ invite.endpoint }}</code>
          <label class="abele-node-pairing__verification">
            <input
              v-model="endpointVerified"
              type="checkbox"
              :aria-label="t('streamB.ownerVerifiedNewEndpoint.dbc9e4')"
            />
            {{ t('streamB.iIndependentlyVerifiedTheNewEndpointWith.f9249c') }}
          </label>
        </template>
        <template v-if="!node">
          <p v-if="deviceFingerprint">
            {{ t('streamB.thisDeviceSFingerprint.21e53a') }} <code>{{ deviceFingerprint }}</code>
          </p>
          <Button
            :text="t('streamB.pairThisDevice.f7815e')"
            accent
            :disabled="
              busy ||
              !label.trim() ||
              (!!previousPin && previousPin !== invite.node_fingerprint && !verified) ||
              (!!previousEndpoint && previousEndpoint !== invite.endpoint && !endpointVerified)
            "
            @click="pair"
          />
          <p>{{ t('streamB.onlyOwnerConfirmationOfThisDeviceS.4f42cd') }}</p>
          <Button
            :text="t('streamB.useAnotherInvitation.5681b8')"
            :disabled="busy"
            @click="reset"
          />
        </template>
        <template v-else>
          <p role="status">
            {{
              connected
                ? t('streamB.connectedOverPairedWss.f5f622')
                : t('streamB.waitingForOwnerConfirmation.4a882d')
            }}
          </p>
          <p>{{ t('streamB.askTheOwnerToCompareThisFull.bc9571') }}</p>
          <code :aria-label="t('streamB.deviceKeyFingerprint.a129dd')">{{
            deviceFingerprint
          }}</code>
          <p>{{ t('streamBMeta.55a08c3f08', { p0: String(installationId) }) }}</p>
          <p v-if="!connected">{{ t('streamB.leaveThisOpenOrReturnToNodes.3517f3') }}</p>
          <Button
            :text="t('streamB.checkOwnerConfirmation.f02ff7')"
            :disabled="busy || connected"
            @click="check"
          />
          <Button
            :text="t('streamB.useAnotherInvitation.5681b8')"
            :disabled="busy"
            @click="reset"
          />
        </template>
      </template>
      <p v-if="message" role="alert"><NodeErrorText :error="message" /></p>
      <p>
        {{ t('streamB.revocationIsDoneByTheOwnerWith.3898eb') }} <code>abele-node pair revoke</code
        >{{ t('streamB.toRePairUseAFreshInvitation.e0e6d1') }}
      </p>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { ref, onMounted, onUnmounted } from 'vue'
import { InviteSchema, assertPairedEndpoint, type PairingInvite } from '@abele/channel-protocol'
import type { NodeService } from '@/node/NodeService'
import { type RegisteredNode, isPairedNode } from '@/node/NodeRegistry'

import { claimedEnrollment, type EnrollingDevice } from '@/node/NodeDeviceKeyStore'
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
  previousEndpoint = ref(''),
  endpointVerified = ref(false),
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
  message.value = error instanceof Error ? presentUiError(error) : t('streamB.pairingFailed.6c52d2')
}
const review = async () => {
  message.value = ''
  try {
    const parsed = InviteSchema.parse(JSON.parse(raw.value))
    assertPairedEndpoint(parsed.endpoint)
    const stored = await props.service.deviceKeys.load(parsed.node_id)
    if (closed) return
    previousPin.value = stored?.node_fingerprint ?? ''
    previousEndpoint.value = stored?.endpoint ?? ''
    endpointVerified.value = false
    verified.value = false
    invite.value = parsed
    raw.value = ''
  } catch {
    message.value = t('streamB.invalidInvitationPasteTheCompleteInvitationJson.cc55de')
  }
}
const resume = async (device: EnrollingDevice) => {
  // The pending list may predate another window's enrollment; use its current snapshot.
  const latest = await props.service.deviceKeys.load(device.node_id)
  if (latest?.enrollment) device = latest
  label.value = device.enrollment.label
  raw.value = JSON.stringify(device.enrollment.invite)
  await review()
  deviceFingerprint.value = await props.service.deviceFingerprint(device.node_id)
  const acknowledged = claimedEnrollment(device)
  const registered =
    acknowledged &&
    props.service.nodes.value.find(
      (n) =>
        isPairedNode(n) &&
        n.expectedNodeId === device.node_id &&
        n.installationId === acknowledged.installation_id &&
        n.url === acknowledged.endpoint &&
        n.nodeFingerprint === acknowledged.node_fingerprint
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
  previousEndpoint.value = ''
  endpointVerified.value = false
  verified.value = false
  message.value = ''
  connected.value = false
}
const pair = async () => {
  const current = invite.value
  if (!current || busy.value || !label.value.trim()) return
  if (previousPin.value && previousPin.value !== current.node_fingerprint && !verified.value) return
  if (
    previousEndpoint.value &&
    previousEndpoint.value !== current.endpoint &&
    !endpointVerified.value
  )
    return
  busy.value = true
  message.value = ''
  try {
    if (
      previousEndpoint.value &&
      previousEndpoint.value !== current.endpoint &&
      previousPin.value === current.node_fingerprint
    ) {
      await props.service.deviceKeys.authorizeEndpointChange(
        current,
        previousEndpoint.value,
        previousPin.value
      )
      previousEndpoint.value = current.endpoint
    }
    if (previousPin.value && previousPin.value !== current.node_fingerprint) {
      await props.service.pairedConnector.authorizeNodeKeyChange(current, previousPin.value)
      // The explicit pin transaction committed even if the following claim reply is lost.
      previousPin.value = current.node_fingerprint
      previousEndpoint.value = current.endpoint
    }
    node.value = await props.service.pair(label.value.trim(), current)
    installationId.value = isPairedNode(node.value) ? node.value.installationId : ''
    deviceFingerprint.value = await props.service.deviceFingerprint(current.node_id)
  } catch (error) {
    deviceFingerprint.value = await props.service.deviceFingerprint(current.node_id).catch(() => '')
    report(error)
    message.value += t('streamBMeta.2e55855058')
  } finally {
    busy.value = false
  }
  if (node.value && !closed) void check()
}
const check = async () => {
  if (!node.value || busy.value || closed) return
  window.clearTimeout(timer)
  busy.value = true
  let retry = true
  try {
    const target = node.value
    const invitation = invite.value
    const expected = claimedEnrollment(await props.service.deviceKeys.load(target.expectedNodeId))
    await props.service.connection(target.id).connect()
    if (closed) return
    if (
      !expected ||
      expected.invite_id !== invitation.invite_id ||
      expected.endpoint !== invitation.endpoint ||
      expected.node_fingerprint !== invitation.node_fingerprint ||
      !(await props.service.deviceKeys.finishEnrollment(target.expectedNodeId, expected))
    ) {
      retry = false
      message.value = t('streamB.pairingChangedInAnotherWindowResumeThe.bf435e')
      return
    }
    connected.value = true
    message.value = ''
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
    if (!closed && !connected.value && retry)
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
    padding-block: var(--size-4-1);
  }
  &__verification {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    margin-block: var(--size-4-2);
  }
}
</style>
