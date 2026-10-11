import { BaseSequencer } from 'vitest/node'
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { selectShard } from './fast-shards.mjs'

export default class FastSequencer extends BaseSequencer {
  async sort(specifications) {
    if (!this.ctx.config.shard) throw new Error('A fast shard plan requires --shard=index/count')
    return super.sort(specifications)
  }

  async shard(specifications) {
    const plan = JSON.parse(readFileSync(process.env.ABELE_FAST_SHARD_PLAN, 'utf8'))
    const { index, count } = this.ctx.config.shard
    const name = (spec) => relative(this.ctx.config.root, spec.moduleId).split(sep).join('/')
    const selected = new Set(selectShard(plan, specifications.map(name), index, count))
    return specifications.filter((spec) => selected.has(name(spec)))
  }
}
