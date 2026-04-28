<template>
  <div class="abele-settings__links">
    <p class="setting-item-description">
      Create custom deeplinks that trigger scripts with URL parameters.<br />
      Format: <code>obsidian://abele-link?name=link-name&amp;param1=value1&amp;param2=value2</code>
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
          <Setting name="Script" desc="Script to execute when the link is opened.">
            <Dropdown
              :model-value="link.scriptName"
              :options="scriptOptions"
              @update:model-value="updateField(idx, 'scriptName', $event)"
            />
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
import { AbeleConfig, type LinkDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'

const config = AbeleConfig.getInstance()
const links = ref<LinkDefinition[]>(JSON.parse(JSON.stringify(config.links || [])))

const scriptOptions = computed(() => {
  const scripts = ScriptService.getInstance().getAll()
  return [
    { value: '', display: '(select script)' },
    ...scripts.map((s) => ({ value: s.meta.name, display: s.meta.name })),
  ]
})

const save = debounce(async () => {
  config.links = JSON.parse(JSON.stringify(links.value))
  await config.saveSettings()
}, 500)

const addLink = () => {
  links.value.push({ id: nanoid(8), name: '', scriptName: '' })
  save()
}

const removeLink = (idx: number) => {
  links.value.splice(idx, 1)
  save()
}

const updateField = (idx: number, field: 'name' | 'scriptName', value: string) => {
  links.value[idx][field] = field === 'name' ? value.replace(/[^a-zA-Z0-9_-]/g, '-') : value
  save()
}

const buildUrl = (link: LinkDefinition): string => {
  if (!link.name) return 'obsidian://abele-link?name=...'
  return `obsidian://abele-link?name=${link.name}`
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
