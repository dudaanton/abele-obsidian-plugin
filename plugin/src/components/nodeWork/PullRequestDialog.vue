<template>
  <div class="abele-pr-dialog">
    <div class="abele-pr-dialog__where">
      <Icon icon="git-pull-request-create" size="xs" :interactive="false" />
      <span
        ><b>{{ branch }}</b> into
        <a
          class="abele-pr-dialog__base"
          role="button"
          tabindex="0"
          @click="emit('choose-base')"
          @keydown.enter.prevent="emit('choose-base')"
          >{{ base }}</a
        >
        · {{ plural(commits, 'commit') }} · {{ plural(files, 'file') }}</span
      >
    </div>
    <label class="abele-pr-dialog__field">
      <span class="setting-item-name">Title</span>
      <Input v-model="title" aria-label="Title" placeholder="What the branch does" />
    </label>
    <label class="abele-pr-dialog__field">
      <span class="setting-item-name">Description</span>
      <textarea
        v-model="body"
        class="abele-pr-dialog__body"
        rows="6"
        aria-label="Description"
        placeholder="Why, and what to look at"
      />
    </label>
    <Setting name="Draft" desc="Not ready for review yet; it can be marked ready later.">
      <Checkbox :is-enabled="draft" aria-label="Open as a draft" @toggle="draft = !draft" />
    </Setting>
    <div class="modal-button-container">
      <Button text="Cancel" tooltip="Close without opening anything" @click="emit('cancel')" />
      <Button
        :text="pushed ? 'Create' : 'Push and create'"
        accent
        :disabled="!title.trim()"
        :tooltip="
          pushed
            ? `Open the pull request on ${host}`
            : `Push ${branch} first, then open the pull request on ${host}`
        "
        @click="emit('create', { title: title.trim(), body, draft })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Opening a pull request for a worktree's branch: into which branch, a title and a description
// filled from its commits, as a draft or not. The branch is pushed first when it is not yet.
import { ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Setting from '../obsidian/Setting.vue'
import { plural } from './codes'

const props = withDefaults(
  defineProps<{
    branch: string
    base: string
    commits: number
    files: number
    /** Filled from the branch's commits: the one subject, or the branch's name. */
    initialTitle: string
    initialBody?: string
    /** The branch is on the remote already. */
    pushed?: boolean
    /** Where the pull request opens ("GitHub"). */
    host?: string
  }>(),
  { initialBody: '', pushed: true, host: 'GitHub' }
)
const emit = defineEmits<{
  (e: 'create', pr: { title: string; body: string; draft: boolean }): void
  (e: 'choose-base' | 'cancel'): void
}>()
const title = ref(props.initialTitle)
const body = ref(props.initialBody)
const draft = ref(false)
</script>

<style lang="scss">
.abele-pr-dialog {
  display: flex;
  flex-direction: column;
}
.abele-pr-dialog__where {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  b {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
  }
  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-pr-dialog__base {
  color: var(--text-accent);
  font-weight: var(--font-semibold);
  cursor: var(--cursor-link);
}
.abele-pr-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2) 0;
}
.abele-pr-dialog__body {
  width: 100%;
  min-height: 7.5em;
  resize: vertical;
}
.abele-pr-dialog .modal-button-container {
  margin-top: var(--size-4-4);
}
</style>
