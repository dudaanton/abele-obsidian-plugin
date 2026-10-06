<template>
  <Section
    title="Nodes"
    desc="Connect this device to a local AbeleNode daemon. This stage offers non-executing fake sessions only. Connections, tokens and history caches stay on this device and are not transferred with settings."
  >
    <Setting
      v-for="node in service.nodes.value"
      :key="node.id"
      :name="node.label"
      :desc="`${node.url} · ${service.connection(node.id).state.value}${service.connection(node.id).error.value ? ' · ' + service.connection(node.id).error.value : ''}`"
    >
      <Button text="Check" tooltip="Check this device's node connection" @click="check(node.id)" />
      <Button
        text="Open session"
        tooltip="Create or pick a non-executing fake session"
        @click="open(node)"
      />
      <Button
        text="Remove"
        tooltip="Forget only this device's connection and token"
        @click="remove(node.id)"
      />
    </Setting>
    <Setting name="Label" desc="A name for this node on this device.">
      <Input v-model="label" placeholder="Local node" aria-label="Node label" />
    </Setting>
    <Setting
      name="URL"
      desc="Only the explicit loopback address is supported; no remote or phone connection yet."
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
import { ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { NodeService } from '@/node/NodeService'
import { pickNodeSession } from '@/node/openSession'
import type { RegisteredNode } from '@/node/NodeRegistry'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
const service = NodeService.getInstance()
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
    await service.connection(id).connect()
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
