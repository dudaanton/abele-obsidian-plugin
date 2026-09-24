<template>
  <CardGrid stack class="abele-github-access">
    <Card title="Token" icon="key-round" :description="tokenLines">
      <template #badges>
        <Badge
          :text="report.token.attached ? 'Sent' : 'Not sent'"
          :color="report.token.attached ? 'green' : 'orange'"
        />
      </template>
    </Card>

    <Card
      v-for="row in report.rows"
      :key="row.permission"
      :title="row.permission"
      :icon="ICONS[row.state]"
      :subtitle="row.status ? `${row.request} → ${row.status}` : row.request"
      :description="rowLines(row)"
    >
      <template #badges>
        <Badge :text="LABELS[row.state]" :color="COLORS[row.state]" />
      </template>
    </Card>
  </CardGrid>
</template>

<script setup lang="ts">
/**
 * What "Check access" found: one card for the token — was it sent, whose is it, to which API —
 * and one per permission tried against the repository. The token itself is never shown; only
 * whether it went, its kind and its length, which is enough to tell a truncated paste.
 */
import { computed } from 'vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Badge from '../obsidian/Badge.vue'
import type { KitColor } from '@/constants/colors'
import type { AccessReport, AccessRow, RowState } from '@/github/accessCheck'
import type { TokenKind } from '@/github/refusal'

const props = defineProps<{ report: AccessReport }>()

const ICONS: Record<RowState, string> = { ok: 'check', refused: 'x', skipped: 'minus' }
const LABELS: Record<RowState, string> = { ok: 'OK', refused: 'Refused', skipped: 'Skipped' }
const COLORS: Record<RowState, KitColor> = { ok: 'green', refused: 'red', skipped: 'grey' }

const KINDS: Record<TokenKind, string> = {
  none: '',
  'fine-grained': 'a fine-grained personal access token',
  classic: 'a classic personal access token',
  oauth: 'an OAuth token',
  app: "a GitHub App's token",
  unknown: 'a token of a kind GitHub does not mark',
}

const tokenLines = computed(() => {
  const r = props.report
  const lines: string[] = []
  lines.push(
    r.token.attached
      ? `Sent with every request: ${KINDS[r.token.kind]}, ${r.token.length} characters.`
      : 'No token was sent with these requests.'
  )
  if (r.tokenNote) lines.push(r.tokenNote)
  if (r.tokenConfigured) lines.push(`Token is set for: ${r.tokenHost}`)
  if (r.repo) lines.push(`Repository: ${r.repo.owner}/${r.repo.repo} on ${r.host}`)
  if (r.login) lines.push(`Belongs to ${r.login}.`)
  if (r.expires) lines.push(`Expires ${r.expires}.`)
  if (r.scopes !== undefined && r.token.kind === 'classic') {
    lines.push(`Scopes: ${r.scopes || 'none'}.`)
  }
  if (r.identityError) lines.push(r.identityError)
  lines.push(`API: ${r.api}`)
  if (r.rateLimit) lines.push(`${r.rateLimit[0].toUpperCase()}${r.rateLimit.slice(1)}.`)
  return lines.join('\n')
})

const rowLines = (row: AccessRow): string | undefined => {
  const lines: string[] = []
  if (row.reason) lines.push(row.fix ? `${row.reason} ${row.fix}` : row.reason)
  if (row.needed) lines.push(`Needs: ${row.needed}`)
  if (row.githubSaid) lines.push(`GitHub said: "${row.githubSaid}"`)
  return lines.length ? lines.join('\n') : undefined
}
</script>
