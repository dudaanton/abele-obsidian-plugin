<template>
  <ObsidianModal title="Share a group" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-group-review">
      <p v-if="!enabled" role="status">
        Group sharing is not active. No notes or images will be shared.
      </p>
      <p v-if="display && (!display.preview.certified || !display.preview.complete)" role="status">
        Some linked notes could not be checked. Review them before sharing.
      </p>
      <p>
        Choose the note that represents your group. Notes stay in their current folders, and linked
        images are shared only when you choose to share them.
      </p>
      <label
        >Group note path<input
          v-model="rootId"
          aria-label="Group note path"
          placeholder="Notes/project.md"
          :disabled="busy || !enabled" /></label
      ><label
        >Group name<input
          v-model="label"
          aria-label="Group share name"
          :disabled="busy || !enabled" /></label
      ><label
        >Access<select v-model="role" aria-label="Group access" :disabled="busy || !enabled">
          <option value="reader">Can view</option>
          <option value="editor">Can edit</option>
        </select></label
      >
      <Button
        text="Review group"
        tooltip="Check the group note and shared notes before continuing"
        :disabled="busy || !enabled || (!flow && !rootFlow)"
        @click="review"
      />
      <template v-if="display"
        ><p>
          Group note:
          <code :title="display.preview.root.fileId + ' / ' + display.preview.root.versionId">{{
            display.preview.root.path
          }}</code>
        </p>
        <p>
          Access: {{ sharingPermission(display.role) }}.
          {{
            display.preview.certified && display.preview.complete
              ? 'The shared notes have been checked'
              : 'Some notes still need to be checked'
          }}.
        </p>
        <h4>Notes in this group</h4>
        <ul>
          <li v-for="n in display.preview.notes" :key="n.fileId">
            <code :title="n.fileId + ' / ' + n.versionId">{{ n.path }}</code>
          </li>
        </ul>
        <h4>Other linked notes</h4>
        <ul>
          <li v-for="a in display.preview.anchors" :key="a.fileId">
            <code :title="a.fileId + ' / ' + a.versionId">{{ a.path }}</code>
          </li>
        </ul>
        <p v-if="display.preview.uncertain.length" role="status">
          Some linked notes could not be checked. They will not be shared yet.
        </p>
        <p>
          {{ display.preview.relations.length }}
          {{ display.preview.relations.length === 1 ? 'link needs' : 'links need' }} a separate
          sharing choice.
        </p>
        <label
          >Your email<input
            v-model="email"
            type="email"
            aria-label="Group owner email"
            :disabled="busy || !enabled" /></label
        ><label
          >Your password<input
            v-model="password"
            type="password"
            aria-label="Group owner password"
            :disabled="busy || !enabled" /></label
        ><Button
          text="Share this group"
          tooltip="Confirm the group and its access settings before sharing"
          :disabled="busy || !enabled || !flow || !password"
          @click="confirm"
      /></template>
      <template v-if="rootShown">
        <p>
          Group note:
          <code :title="rootShown.root.fileId + ' / ' + rootShown.root.versionId">{{
            rootShown.root.path
          }}</code
          >.
        </p>
        <p>
          Notes in this group will be checked before sharing. Images need a separate sharing choice.
        </p>
        <label
          >Your email<input
            v-model="email"
            type="email"
            aria-label="Group owner email"
            :disabled="busy"
        /></label>
        <label
          >Your password<input
            v-model="password"
            type="password"
            aria-label="Group owner password"
            :disabled="busy"
        /></label>
        <Button
          :text="grant?.state === 'preparing' ? 'Continue setup' : 'Share this group'"
          tooltip="Confirm your password and the current group note"
          :disabled="busy || !enabled || (!password && !grant)"
          @click="confirm"
        />
      </template>
      <Button
        v-if="rootFlow && grant?.state === 'active'"
        text="Create invitation"
        tooltip="Create a code to invite someone with the selected access"
        :disabled="busy"
        @click="invite"
      />
      <p v-if="invitationToken">
        Invitation code:
        <input :value="invitationToken" aria-label="Invitation code" readonly />
      </p>
      <p v-if="grant" role="status" :title="grant.id">
        {{ sharingGroupState(grant.state) }}
        Images and other linked notes need separate sharing choices.
      </p>
      <Button
        v-if="grant && flow"
        text="Share reviewed links"
        tooltip="Check these linked notes again before sharing them"
        :disabled="busy || !enabled || !flow"
        @click="approve"
      />
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close without keeping the password or invitation code on screen"
        @click="close"
      /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage, sharingPermission, sharingGroupState } from './sharingText'
import { OWNER_SHARING_ENABLED } from '@/sync/sharing/folderSharing'
import type { GroupSharingFlow, GroupReview, GroupGrant } from '@/sync/sharing/groupSharing'
import type { OwnerGroupRootFlow, GroupRootReview } from '@/sync/sharing/ownerGroupRoot'
const props = withDefaults(
    defineProps<{
      flow?: GroupSharingFlow
      rootFlow?: OwnerGroupRootFlow
      preview?: GroupReview
      enabled?: boolean
    }>(),
    { enabled: OWNER_SHARING_ENABLED }
  ),
  emit = defineEmits<{ close: [] }>(),
  enabled = props.enabled ?? OWNER_SHARING_ENABLED
const rootId = ref(''),
  label = ref('Sample group'),
  role = ref<'reader' | 'editor'>('editor'),
  email = ref(''),
  password = ref(''),
  busy = ref(false),
  error = ref(''),
  rootShown = ref<GroupRootReview | null>(null),
  invitationToken = ref(''),
  shown = ref<GroupReview | null>(null),
  grant = ref<GroupGrant | null>(null),
  display = computed(() => shown.value ?? props.preview)
watch([rootId, label, role], () => {
  shown.value = null
  rootShown.value = null
  invitationToken.value = ''
  password.value = ''
  grant.value = null
  props.flow?.close()
  props.rootFlow?.close()
})
async function review() {
  if (!enabled || (!props.flow && !props.rootFlow)) return
  busy.value = true
  error.value = ''
  try {
    if (props.rootFlow)
      rootShown.value = await props.rootFlow.review(rootId.value, role.value, label.value)
    else shown.value = await props.flow!.review(rootId.value, role.value, label.value)
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not review this group. Check the group note path and try again.'
    )
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (!enabled || (!props.flow && !props.rootFlow) || (!shown.value && !rootShown.value)) return
  busy.value = true
  error.value = ''
  try {
    if (props.rootFlow && rootShown.value)
      grant.value = await props.rootFlow.confirm(
        rootShown.value,
        password.value,
        email.value || undefined
      )
    else
      grant.value = await props.flow!.confirm(
        shown.value!,
        password.value,
        email.value || undefined
      )
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not share this group. Review it and try again.')
  } finally {
    password.value = ''
    busy.value = false
  }
}
async function approve() {
  if (!enabled || !props.flow || !shown.value) return
  busy.value = true
  try {
    await props.flow.approveRelations(shown.value)
  } catch (e) {
    error.value = sharingErrorMessage(
      e,
      'Could not share these linked notes. Review them and try again.'
    )
  } finally {
    busy.value = false
  }
}
async function invite() {
  if (!props.rootFlow || busy.value) return
  busy.value = true
  try {
    invitationToken.value = await props.rootFlow.invitation(role.value)
  } catch (e) {
    error.value = sharingErrorMessage(e, 'Could not create an invitation. Try again.')
  } finally {
    busy.value = false
  }
}
function close() {
  password.value = ''
  invitationToken.value = ''
  props.rootFlow?.close()
  props.flow?.close()
  emit('close')
}
onUnmounted(() => {
  password.value = ''
  invitationToken.value = ''
  props.rootFlow?.close()
  props.flow?.close()
})
</script>
<style scoped>
.abele-group-review {
  overflow-y: auto;
  padding: 0 var(--size-4-1) var(--size-4-3);
}
.abele-group-review label {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-group-review code,
.abele-group-review p {
  overflow-wrap: anywhere;
}
.abele-modal__buttons {
  flex: 0 0 auto;
  padding-top: var(--size-4-3);
}
</style>
