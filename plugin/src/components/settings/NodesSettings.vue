<template>
  <Section
    title="Nodes"
    desc="Connect to a local daemon or pair a remote AbeleNode over Tailscale. Choose projects and isolated workspaces, run Claude Code or pi when available, or open non-executing fake sessions. Connections, tokens, device keys and history caches stay on this device and never transfer with settings."
  >
    <Setting
      v-for="node in service.nodes.value"
      :key="node.id"
      :name="node.label"
      :desc="`${node.url} · ${service.connection(node.id).state.value}${service.connection(node.id).error.value ? ' · ' + service.connection(node.id).error.value : ''}`"
    >
      <Button
        v-if="isPairedNode(node)"
        text="Pairing / re-pair"
        tooltip="Review device pairing or use a fresh invitation"
        @click="showPairing(node.expectedNodeId)"
      />
      <Button text="Check" tooltip="Check this device's node connection" @click="check(node.id)" />
      <Button
        text="Open session"
        tooltip="Pick a session or manage projects and workspaces"
        @click="open(node)"
      />
      <Button text="Delegation grants" tooltip="Owner approval or revocation for plugin-agent delegation" @click="showGrants(node)" />
      <Button
        text="Remove"
        tooltip="Forget only this device's connection and token"
        @click="remove(node.id)"
      />
    </Setting>
    <Button
      text="Pair remote node"
      tooltip="Scan or paste an invitation; re-pair or verify a changed node key"
      @click="showPairing()"
    />
    <NodeDelegationGrantsDialog
      v-if="grantNode"
      :label="grantNode.label"
      :controller="service.connection(grantNode.id).delegation"
      :parents="parentChats"
      :initial-parent-id="ChatService.getInstance().activeSession.value?.delegationParentId"
      @close="grantNode = undefined"
    />
    <NodePairingDialog
      v-if="pairing"
      :service="service"
      :resume-node-id="resumeNodeId"
      @close="pairing = false"
    />
    <p>
      For a revoked device, ask the owner for a new invitation bound to the same installation and
      pair again. Revocation is performed on the node, not by removing this connection.
    </p>
    <Setting name="Label" desc="A name for this node on this device.">
      <Input v-model="label" placeholder="Local node" aria-label="Node label" />
    </Setting>
    <Setting
      name="URL"
      desc="Local-token connections use only the explicit loopback address. Use Pair remote node for a phone or a remote desktop."
    >
      <Input v-model="url" placeholder="http://127.0.0.1:7777" aria-label="Node URL" />
    </Setting>
    <Setting
      name="Installation token"
      desc="Paste the token returned by abele-node token create. Stored only in this device's keychain, never in the synced secret store."
    >
      <Input
        v-model="token"
        password
        placeholder="Paste token"
        aria-label="Node installation token"
      />
    </Setting>
    <Button
      text="Add node"
      tooltip="Authenticate and pin the local node identity on this device"
      :disabled="busy || !label.trim() || !token.trim()"
      @click="add"
    />
    <p v-if="message" role="status">{{ message }}</p>
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { NodeService } from '@/node/NodeService'
import { isPairedNode } from '@/node/NodeRegistry'
import { claimedEnrollment } from '@/node/NodeDeviceKeyStore'
import NodePairingDialog from '../NodePairingDialog.vue'
import NodeDelegationGrantsDialog from '../NodeDelegationGrantsDialog.vue'
import { pickNodeSession } from '@/node/openSession'
import type { RegisteredNode } from '@/node/NodeRegistry'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
const service = NodeService.getInstance()
const grantNode = ref<RegisteredNode>()
const parentChats = computed(() => {
  const chats = ChatService.getInstance()
  return chats.tabOrder.value.flatMap(id => {
    const parent = chats.getSession(id)
    return parent?.delegationParentId ? [{ id: parent.delegationParentId, title: parent.chatTitle.value || 'Untitled chat' }] : []
  })
})
const showGrants = async (node: RegisteredNode) => {
  try {
    await service.connection(node.id).connect()
    const chats = ChatService.getInstance()
    for (const id of chats.tabOrder.value) {
      const parent = chats.getSession(id)
      if (parent?.currentChatFile.value) await parent.ensureDelegationParentId()
    }
    grantNode.value = node
  } catch (error) { report(error) }
}
const pairing = ref(false)
const resumeNodeId = ref<string>()
const showPairing = (nodeId?: string) => {
  resumeNodeId.value = nodeId
  pairing.value = true
}
const label = ref('Local node')
const url = ref('http://127.0.0.1:7777')
const token = ref('')
const busy = ref(false)
const message = ref('')
const report = (error: unknown) => {
  message.value = error instanceof Error ? error.message : 'Node unavailable'
}
const add = async () => {
  busy.value = true
  message.value = ''
  try {
    await service.add(label.value.trim(), url.value.trim(), token.value.trim())
    token.value = ''
    message.value = 'Connected. Open a session here or from the new chat menu.'
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
  }
}
const check = async (id: string) => {
  try {
    const node = service.nodes.value.find((n) => n.id === id)
    const expected =
      node && isPairedNode(node)
        ? claimedEnrollment(await service.deviceKeys.load(node.expectedNodeId))
        : undefined
    await service.connection(id).connect()
    if (
      node &&
      isPairedNode(node) &&
      expected &&
      expected.endpoint === node.url &&
      expected.node_fingerprint === node.nodeFingerprint &&
      expected.installation_id === node.installationId
    )
      await service.deviceKeys.finishEnrollment(node.expectedNodeId, expected)
    message.value = 'Connected'
  } catch (error) {
    report(error)
  }
}
const open = async (node: RegisteredNode) => {
  try {
    await pickNodeSession(node)
  } catch (error) {
    report(error)
  }
}
const remove = async (id: string) => {
  const chats = ChatService.getInstance()
  for (const tab of [...chats.tabOrder.value])
    if (chats.getNodeSession(tab)?.reference.registrationId === id) await chats.closeTab(tab)
  service.remove(id)
  message.value =
    'Connection removed from this device. Node history and the daemon credential are unchanged.'
}
</script>
