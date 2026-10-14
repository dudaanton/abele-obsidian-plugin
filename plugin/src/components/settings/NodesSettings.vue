<template>
  <Section
    title="Nodes"
    desc="Computers the agent can work on for you: open one, pick a project, and watch and answer here. Their keys and history stay on this device."
  >
    <!-- A node as one row: its state as a dot, check, open; the rarer things in ⋯. -->
    <Setting
      v-for="node in service.nodes.value"
      :key="node.id"
      :name="node.label"
      :desc="nodeLine(node)"
    >
      <StatusDot
        :tone="stateTone(service.connection(node.id).state.value)"
        :label="stateLabel(service.connection(node.id).state.value)"
      />
      <Icon
        icon="refresh-cw"
        tooltip="Check this device's node connection"
        @click="check(node.id)"
      />
      <Button
        text="Open session"
        tooltip="Pick a session or manage projects and workspaces"
        @click="open(node)"
      />
      <Icon
        icon="more-horizontal"
        tooltip="Pairing, delegation, remove"
        @click="more($event, node)"
      />
    </Setting>
    <!-- Adding a node is a row like the nodes: what it is, and the one button that starts it. -->
    <Setting
      name="Pair a node on another computer"
      desc="A remote desktop or a server, by an invitation from it. A device that was revoked pairs again the same way."
    >
      <Button
        text="Pair"
        tooltip="Scan or paste an invitation; re-pair or verify a changed node key"
        @click="showPairing()"
      />
    </Setting>
    <Setting name="Add the node on this computer" desc="One running here, by the token it gives.">
      <Button
        text="Add"
        tooltip="Name the node here and paste its token"
        @click="addingLocal = true"
      />
    </Setting>
    <Setting
      name="Notes about recorded runs"
      desc="Vault folder for a note about a run the debugger recorded, yours or the agent's. The run itself stays on the node."
    >
      <Input
        :model-value="traceNotesFolder"
        placeholder="e.g. Trace"
        aria-label="Folder for notes about recorded runs"
        @update:model-value="updateTraceNotesFolder"
      />
    </Setting>
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
    <!-- What the last check, open or add said, under the list it was about. -->
    <p v-if="message && !addingLocal" class="setting-item-description" role="status">
      {{ message }}
    </p>
    <ObsidianModal
      v-if="addingLocal"
      title="Add the node on this computer"
      @close="addingLocal = false"
    >
      <Setting name="Name" desc="What this node is called on this device.">
        <Input v-model="label" placeholder="Local node" aria-label="Node label" />
      </Setting>
      <Setting name="Address" desc="Only this computer's own address; another computer is paired.">
        <Input v-model="url" placeholder="http://127.0.0.1:7777" aria-label="Node URL" />
      </Setting>
      <Setting
        name="Token"
        desc="The one abele-node token create prints. Kept in this device's keychain only."
      >
        <Input
          v-model="token"
          password
          placeholder="Paste token"
          aria-label="Node installation token"
        />
      </Setting>
      <p v-if="message" class="setting-item-description" role="status">{{ message }}</p>
      <template #footer>
        <div class="abele-modal__actions">
          <Button text="Cancel" tooltip="Close this and add nothing" @click="addingLocal = false" />
          <Button
            text="Add"
            accent
            tooltip="Authenticate and pin the local node identity on this device"
            :disabled="busy || !label.trim() || !token.trim()"
            @click="add"
          />
        </div>
      </template>
    </ObsidianModal>
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
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { Menu, debounce } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
const service = NodeService.getInstance()
const config = AbeleConfig.getInstance()
const traceNotesFolder = ref(config.traceNotesFolder)
const saveTraceNotesFolder = debounce(async (value: string) => {
  config.traceNotesFolder = value.trim()
  await config.saveSettings()
}, 500)
const updateTraceNotesFolder = (value: string) => {
  traceNotesFolder.value = value
  saveTraceNotesFolder(value)
}
const grantNode = ref<RegisteredNode>()
const parentChats = computed(() => {
  const chats = ChatService.getInstance()
  return chats.tabOrder.value.flatMap((id) => {
    const parent = chats.getSession(id)
    return parent?.delegationParentId
      ? [{ id: parent.delegationParentId, title: parent.chatTitle.value || 'Untitled chat' }]
      : []
  })
})
const showGrants = async (node: RegisteredNode) => {
  try {
    await service.connection(node.id).connect()
    const chats = ChatService.getInstance()
    // Opening owner approval must not rewrite unrelated chats or fail because an
    // unrelated file changed elsewhere. Choose the parent by activating it first.
    const parent = chats.activeSession.value
    if (parent?.currentChatFile.value) await parent.ensureDelegationParentId()
    grantNode.value = node
  } catch (error) {
    report(error)
  }
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
    addingLocal.value = false
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
const stateTone = (state: string) =>
  state === 'connected' ? 'green' : state === 'connecting' ? 'orange' : 'red'
/** The add window for the node on this computer. */
const addingLocal = ref(false)

/** Under a node's name: how it is in words, then where it is; a code from the node in words too. */
const nodeLine = (node: RegisteredNode) => {
  const conn = service.connection(node.id)
  const error = conn.error.value ? conn.error.value.replace(/_/g, ' ') : ''
  return [error || stateLabel(conn.state.value), node.url].join(' · ')
}

const stateLabel = (state: string) =>
  state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Not connected'

const more = (event: MouseEvent, node: RegisteredNode) => {
  const menu = new Menu()
  if (isPairedNode(node))
    menu.addItem((i) =>
      i
        .setTitle('Pairing / re-pair')
        .setIcon('link')
        .onClick(() => showPairing(node.expectedNodeId))
    )
  menu.addItem((i) =>
    i
      .setTitle('Delegation grants')
      .setIcon('key-round')
      .onClick(() => showGrants(node))
  )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle('Remove')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => remove(node.id))
  )
  menu.showAtMouseEvent(event)
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
