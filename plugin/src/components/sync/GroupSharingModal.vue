<template>
  <ObsidianModal title="Share a group" size="tall" phone-sheet @close="close"
    ><div class="abele-modal__body abele-group-review">
      <p v-if="!enabled" role="status">
        Group sharing is not active. This read-only preview makes no management or publication
        request.
      </p>
      <p v-if="display && (!display.preview.certified || !display.preview.complete)" role="status">
        Scope preparing or incomplete. Root/anchor approval stays held; no inferred exposure.
      </p>
      <p>
        A root is a stable approved note identity, not a folder or matching basename. Notes and
        images keep their scattered original paths. Received edges and uncertain anchors never
        become owner approvals on an ordinary re-save.
      </p>
      <label
        >Root identity<input
          v-model="rootId"
          aria-label="Group root identity"
          :disabled="busy || !enabled" /></label
      ><label
        >Group name<input
          v-model="label"
          aria-label="Group share name"
          :disabled="busy || !enabled" /></label
      ><label
        >Role<select v-model="role" aria-label="Group role" :disabled="busy || !enabled">
          <option value="reader">Reader</option>
          <option value="editor">Editor</option>
        </select></label
      >
      <Button
        text="Review root and current scope"
        tooltip="Obtain a complete certified exact-version group/anchor preview before creation"
        :disabled="busy || !enabled || (!flow && !rootFlow)"
        @click="review"
      />
      <template v-if="display"
        ><p>
          Root <code>{{ display.preview.root.path }}</code> · {{ display.preview.root.fileId }} /
          {{ display.preview.root.versionId }}
        </p>
        <p>
          Rights: {{ display.role }}. Preview generation {{ display.preview.generation }}.
          {{
            display.preview.certified && display.preview.complete
              ? 'Certified current inventory'
              : 'Scope preparing or incomplete — approval held'
          }}.
        </p>
        <h4>Scattered member notes</h4>
        <ul>
          <li v-for="n in display.preview.notes" :key="n.fileId">
            <code>{{ n.path }}</code> · {{ n.fileId }} / {{ n.versionId }}
          </li>
        </ul>
        <h4>Explicit anchors</h4>
        <ul>
          <li v-for="a in display.preview.anchors" :key="a.fileId">
            <code>{{ a.path }}</code> · {{ a.fileId }} / {{ a.versionId }}
          </li>
        </ul>
        <p v-if="display.preview.uncertain.length" role="status">
          Uncertain: {{ display.preview.uncertain.join(', ') }}. No inferred authority.
        </p>
        <p>
          Reviewed relation approvals: {{ display.preview.relations.length }}. Each
          source/target/token/version is an explicit owner decision, separate from creating the
          grant.
        </p>
        <label
          >Owner email<input
            v-model="email"
            type="email"
            aria-label="Group owner email"
            :disabled="busy || !enabled" /></label
        ><label
          >Current password<input
            v-model="password"
            type="password"
            aria-label="Group owner password"
            :disabled="busy || !enabled" /></label
        ><Button
          text="Create this reviewed group"
          tooltip="Authenticate the owner and recheck the exact root/version/role preview"
          :disabled="busy || !enabled || !flow || !password"
          @click="confirm"
      /></template>
      <template v-if="rootShown">
        <p>
          Reviewed root <code>{{ rootShown.root.path }}</code> · {{ rootShown.root.fileId }} /
          {{ rootShown.root.versionId }}.
        </p>
        <p>
          The server prepares membership from this exact root. This is not a certified client graph
          preview and does not approve anchors or assets.
        </p>
        <label
          >Owner email<input
            v-model="email"
            type="email"
            aria-label="Group owner email"
            :disabled="busy"
        /></label>
        <label
          >Current password<input
            v-model="password"
            type="password"
            aria-label="Group owner password"
            :disabled="busy"
        /></label>
        <Button
          :text="
            grant?.state === 'preparing'
              ? 'Continue group preparation'
              : 'Create this reviewed group'
          "
          tooltip="Use fresh owner authentication and the exact current root version"
          :disabled="busy || !enabled || (!password && !grant)"
          @click="confirm"
        />
      </template>
      <Button
        v-if="rootFlow && grant?.state === 'active'"
        text="Create invitation"
        tooltip="Invite a member with the reviewed role using the fresh owner session"
        :disabled="busy"
        @click="invite"
      />
      <p v-if="invitationToken">
        Invitation token:
        <input :value="invitationToken" aria-label="Group invitation token" readonly />
      </p>
      <p v-if="grant" role="status">
        Grant {{ grant.id }}: {{ grant.state }}. No anchor or asset batch is implicitly approved.
      </p>
      <Button
        v-if="grant && flow"
        text="Approve reviewed relations"
        tooltip="Recheck certified source/target versions before explicit relation approval"
        :disabled="busy || !enabled || !flow"
        @click="approve"
      />
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="abele-modal__buttons">
      <Button
        text="Close"
        tooltip="Close and discard credentials/review; never create hidden authority"
        @click="close"
      /></div
  ></ObsidianModal>
</template>
<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
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
    error.value = e instanceof Error ? e.message : 'Group scope held'
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
    error.value = e instanceof Error ? e.message : 'Group creation held'
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
    error.value = e instanceof Error ? e.message : 'Group approval held'
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
    error.value = e instanceof Error ? e.message : 'Invitation held'
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
