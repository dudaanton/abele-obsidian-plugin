import fs from 'node:fs'
import path from 'node:path'

/** A missing expectation is never permission to approve current behaviour. */
export function snapshotBaseline<T>(file: string, current: T, update: boolean): T {
  if (update) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8')
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Missing snapshot baseline: ${file}. Review the result and use the explicit snapshot update flag to approve it.`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}
