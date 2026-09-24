/**
 * The test stand-in for Obsidian, with one difference that matters to a measurement: YAML is
 * written as YAML. The shared mock writes JSON, which is fine for asserting and wrong for
 * counting what a frontmatter listing costs.
 */
import { dump } from 'js-yaml'
export * from '../mocks/obsidian'

export function stringifyYaml(value: unknown): string {
  return dump(value, { lineWidth: -1 })
}
