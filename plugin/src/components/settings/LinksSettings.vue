<template>
  <div class="abele-settings__links">
    <p class="setting-item-description">
      Create custom deeplinks that trigger scripts or commands with URL parameters.<br />
      Format: <code>obsidian://abele?name=link-name&amp;param1=value1&amp;param2=value2</code>
    </p>

    <div v-if="links.length" class="abele-links__list">
      <div v-for="(link, idx) in links" :key="link.id" class="abele-links__item">
        <div class="abele-links__fields">
          <Setting name="Name" desc="URL-friendly identifier used in the link.">
            <Input
              :model-value="link.name"
              placeholder="e.g. add-movie"
              @update:model-value="updateField(idx, 'name', $event)"
            />
          </Setting>
          <Setting name="Type" desc="What to execute when the link is opened.">
            <Dropdown
              :model-value="link.type"
              :options="typeOptions"
              @update:model-value="updateField(idx, 'type', $event)"
            />
          </Setting>
          <Setting
            v-if="link.type === 'script'"
            name="Script"
            desc="Script to execute when the link is opened."
          >
            <Dropdown
              :model-value="link.scriptName"
              :options="scriptOptions"
              @update:model-value="updateField(idx, 'scriptName', $event)"
            />
          </Setting>
          <Setting
            v-if="link.type === 'command'"
            name="Command"
            desc="Obsidian command to execute when the link is opened."
          >
            <Dropdown
              :model-value="link.commandId"
              :options="commandOptions"
              @update:model-value="updateField(idx, 'commandId', $event)"
            />
          </Setting>
          <Setting name="Wait for sync" desc="Wait for Obsidian Sync to finish before executing.">
            <Checkbox :is-enabled="link.waitForSync" @toggle="toggleWaitForSync(idx)" />
          </Setting>
          <div class="abele-links__url">
            <code>{{ buildUrl(link) }}</code>
            <Icon icon="copy" @click="copyUrl(link)" />
          </div>
        </div>
        <Icon icon="trash" @click="removeLink(idx)" />
      </div>
    </div>

    <div v-else class="abele-links__empty">No links configured.</div>

    <Button text="Add link" @click="addLink" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { debounce, Notice } from 'obsidian'
import { nanoid } from 'nanoid'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig, type LinkDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { GlobalStore } from '@/stores/GlobalStore'

const config = AbeleConfig.getInstance()
const app = GlobalStore.getInstance().app
const vaultName = app.vault.getName()
const links = ref<LinkDefinition[]>(JSON.parse(JSON.stringify(config.links || [])))

const typeOptions = [
  { value: 'script', display: 'Script' },
  { value: 'command', display: 'Command' },
]

const scriptOptions = computed(() => {
  const scripts = ScriptService.getInstance().getAll()
  return [
    { value: '', display: '(select script)' },
    ...scripts.map((s) => ({ value: s.meta.name, display: s.meta.name })),
  ]
})

const commandOptions = computed(() => {
  const commands = (app as any).commands.listCommands() as { id: string; name: string }[]
  return [
    { value: '', display: '(select command)' },
    ...commands
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, display: c.name })),
  ]
})

const save = debounce(async () => {
  config.links = JSON.parse(JSON.stringify(links.value))
  await config.saveSettings()
}, 500)

const addLink = () => {
  links.value.push({
    id: nanoid(8),
    name: '',
    type: 'script',
    scriptName: '',
    commandId: '',
    waitForSync: true,
  })
  save()
}

const removeLink = (idx: number) => {
  links.value.splice(idx, 1)
  save()
}

const updateField = (idx: number, field: keyof LinkDefinition, value: string) => {
  if (field === 'name') {
    links.value[idx].name = value.replace(/[^a-zA-Z0-9_-]/g, '-')
  } else if (field === 'type') {
    links.value[idx].type = value as 'script' | 'command'
  } else if (field === 'scriptName' || field === 'commandId') {
    links.value[idx][field] = value
  }
  save()
}

const toggleWaitForSync = (idx: number) => {
  links.value[idx].waitForSync = !links.value[idx].waitForSync
  save()
}

const buildUrl = (link: LinkDefinition): string => {
  if (!link.name) return 'obsidian://abele?name=...'
  return `obsidian://abele?vault=${encodeURIComponent(vaultName)}&name=${link.name}`
}

const copyUrl = (link: LinkDefinition) => {
  navigator.clipboard.writeText(buildUrl(link))
  new Notice('Link copied')
}
</script>

<style lang="scss">
.abele-links__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  margin-bottom: var(--size-4-3);
}

.abele-links__item {
  display: flex;
  gap: var(--size-4-2);
  padding: var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);

  > .abele-links__fields {
    flex: 1;
    min-width: 0;
  }
}

.abele-links__url {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
  font-size: var(--font-small);
  color: var(--text-muted);

  code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.abele-links__empty {
  color: var(--text-muted);
  font-size: var(--font-small);
  margin-bottom: var(--size-4-3);
}
</style>
