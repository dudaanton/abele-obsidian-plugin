<template>
  <!-- A sum of several currencies at today's rates: always marked approximate, never in place of
       the exact sums beside it. An orange dot when the rates are old, a dashed ring when a currency
       had no rate and was left out; the words are in the tooltip. -->
  <span ref="el" class="abele-approx-amount">
    <span class="abele-approx-amount__sign" aria-hidden="true">≈</span>
    <span class="abele-approx-amount__value">{{ formatAmount(amount) }}</span>
    <span class="abele-approx-amount__code">{{ currency }}</span>
    <StatusDot v-if="stale" tone="orange" :label="tooltip" class="abele-approx-amount__stale" />
    <Icon
      v-if="missing.length"
      icon="circle-dashed"
      size="xs"
      class="abele-approx-amount__missing"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import { formatAmount } from '@/helpers/moneyFormat'
import { ratesStatus, ratesTooltip } from '@/finance/rates/exchangeRates'

const props = withDefaults(
  defineProps<{
    amount: number
    currency: string
    /** The currencies counted in it, for their rates in the tooltip. */
    currencies?: string[]
    /** Currencies left out for want of a rate. */
    missing?: string[]
    /** The exact sums it stands for, each in its own currency, ahead of the rates in the tooltip. */
    exact?: string[]
  }>(),
  { currencies: () => [], missing: () => [], exact: () => [] }
)

const stale = computed(() => ratesStatus() === 'stale')
const tooltip = computed(() =>
  [props.exact.join(' · '), ratesTooltip(props.currencies, props.missing)]
    .filter(Boolean)
    .join('\n')
)
const el = ref<HTMLElement>()
watchEffect(() => {
  if (el.value) setTooltip(el.value, tooltip.value)
})
</script>

<style lang="scss">
.abele-approx-amount {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-approx-amount__sign,
.abele-approx-amount__code {
  color: var(--text-faint);
}
.abele-approx-amount__stale {
  margin-inline-start: var(--size-2-1);
}
.abele-approx-amount__missing {
  color: var(--text-faint);
}
</style>
