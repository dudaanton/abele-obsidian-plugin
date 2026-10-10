<template>
  <div class="abele-worktree-dialog">
    <Setting name="Branch" :desc="branchNote" :error="problem">
      <Input
        ref="field"
        v-model="branch"
        placeholder="new-branch"
        aria-label="Branch"
        :invalid="!!problem"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="create"
      />
    </Setting>
    <Setting
      name="Start from"
      :desc="
        existing ? 'Not needed: the branch is already there.' : 'The branch the new one begins at.'
      "
    >
      <Button
        :text="base"
        icon="git-branch"
        :disabled="existing"
        tooltip="Choose the branch to start from"
        class="abele-worktree-dialog__base"
        @click="emit('choose-base')"
      />
    </Setting>
    <div class="abele-worktree-dialog__where">
      <Icon icon="folder" size="xs" :interactive="false" />
      <span class="abele-worktree-dialog__path">{{ where }}</span>
    </div>
    <div class="modal-button-container">
      <Button text="Cancel" tooltip="Close without making anything" @click="emit('cancel')" />
      <Button
        text="Create"
        accent
        :disabled="!branch.trim() || !!problem"
        tooltip="Make the worktree on the node"
        @click="create"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// A new worktree of a repository: a branch, and the branch it starts from. Typing the name of a
// branch that is already there checks that one out instead, and the line under the name says
// so. The node picks the folder itself; the last line shows where.
import { computed, onMounted, ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Setting from '../obsidian/Setting.vue'

const props = withDefaults(
  defineProps<{
    /** Branches the repository has. */
    branches: string[]
    /** Branches already checked out in a worktree, which git will not check out twice. */
    taken: string[]
    base: string
    /** Where the node keeps worktrees of this repository. */
    home: string
  }>(),
  {}
)

const emit = defineEmits<{
  (e: 'create', branch: string, base: string): void
  (e: 'choose-base'): void
  (e: 'cancel'): void
}>()

const branch = ref('')
const field = ref<InstanceType<typeof Input>>()
const name = computed(() => branch.value.trim())
const existing = computed(() => props.branches.includes(name.value))
const problem = computed(() =>
  props.taken.includes(name.value)
    ? `${name.value} is already open in another worktree.`
    : /\s|\.\.|[~^:?*[\\]/.test(name.value)
      ? 'A branch name has no spaces and none of ~ ^ : ? * [ \\'
      : undefined
)
const branchNote = computed(() =>
  existing.value ? 'This branch is already there; the worktree checks it out.' : 'A new branch.'
)
const where = computed(() => `${props.home}/${name.value || '…'}`)

function create() {
  if (name.value && !problem.value) emit('create', name.value, props.base)
}
onMounted(() => window.setTimeout(() => field.value?.inputRef?.focus()))
</script>

<style lang="scss">
.abele-worktree-dialog {
  display: flex;
  flex-direction: column;
}
.abele-worktree-dialog__where {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-height: calc(var(--font-ui-smaller) * var(--line-height-normal));
  padding-top: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-worktree-dialog__path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-worktree-dialog .modal-button-container {
  margin-top: var(--size-4-4);
}
</style>
