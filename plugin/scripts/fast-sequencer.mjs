import { BaseSequencer } from 'vitest/node'
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { selectShard } from './fast-shards.mjs'

export default class FastSequencer extends BaseSequencer {
  planPath = process.env.ABELE_FAST_SHARD_PLAN

  async sort(specifications) {
    if (!this.ctx.config.shard) throw new Error('A fast shard plan requires --shard=index/count')
    return super.sort(specifications)
  }

  async shard(specifications) {
    const plan = JSON.parse(readFileSync(this.planPath, 'utf8'))
    const { index, count } = this.ctx.config.shard
    const name = (spec) => relative(this.ctx.config.root, spec.moduleId).split(sep).join('/')
    const selected = new Set(selectShard(plan, specifications.map(name), index, count))
    // The directive belongs to this coordinator, not to nested test CLIs. Retain it on the
    // instance for repeated sequencing, but do not poison subprocess discovery/selection.
    if (process.env.ABELE_FAST_SHARD_PLAN === this.planPath)
      delete process.env.ABELE_FAST_SHARD_PLAN
    return specifications.filter((spec) => selected.has(name(spec)))
  }
}
