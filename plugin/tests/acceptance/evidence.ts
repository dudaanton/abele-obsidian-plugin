import { isDeepStrictEqual } from 'node:util'

export type EvidencePlatform = 'server' | 'Mac' | 'iPhone'
export type DriverKind = 'server' | 'desktop' | 'physical-phone' | 'simulation'
export interface Check {
  name: string
  expected: unknown
  actual: unknown
}
export interface Observation {
  checks: Check[]
  artifacts: string[]
}
export interface ScenarioDriver {
  id: number
  run(): Promise<Observation>
}
export interface Evidence extends Observation {
  scenario: string
  platform: EvidencePlatform
  driver: DriverKind
  status: 'verified' | 'failed' | 'unverified'
  reason?: string
  recordedAt: string
}
const desktopRanges = [
  [2, 23],
  [24, 28],
  [34, 34],
  [35, 56],
  [57, 58],
  [60, 61],
  [69, 74],
  [76, 90],
  [91, 91],
  [92, 107],
  [110, 110],
  [111, 116],
  [117, 117],
]
export function liveRequirements(id: number): EvidencePlatform[] {
  if (!Number.isInteger(id) || id < 1 || id > 124) throw new Error('Unknown acceptance scenario')
  return [
    'server',
    ...(desktopRanges.some(([first, last]) => id >= first && id <= last) ? ['Mac' as const] : []),
    ...(id >= 117 ? ['iPhone' as const] : []),
  ]
}
export function evidenceManifest() {
  return Array.from({ length: 124 }, (_, i) => ({
    id: i + 1,
    required: liveRequirements(i + 1),
    policy: 'specified',
  }))
}
/** Evidence is platform-specific. Missing implementations and hardware never count as passes. */
export async function runEvidence(
  platform: EvidencePlatform,
  driver: DriverKind,
  ids: number[],
  scenarios: ScenarioDriver[]
): Promise<Evidence[]> {
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length)
    throw new Error('Duplicate scenario driver')
  const results: Evidence[] = []
  for (const id of ids) {
    const required = liveRequirements(id)
    const row: Evidence = {
      scenario: String(id).padStart(3, '0'),
      platform,
      driver,
      status: 'unverified',
      checks: [],
      artifacts: [],
      recordedAt: new Date().toISOString(),
    }
    const candidate = scenarios.find((scenario) => scenario.id === id)
    const genuine =
      driver ===
      (platform === 'Mac' ? 'desktop' : platform === 'iPhone' ? 'physical-phone' : 'server')
    if (!required.includes(platform) || !genuine || !candidate) {
      row.reason = !genuine
        ? 'Required platform driver unavailable'
        : !candidate
          ? 'Scenario actions/assertions unavailable'
          : 'Platform evidence not required'
    } else {
      try {
        const observation = await candidate.run()
        row.checks = observation.checks
        row.artifacts = observation.artifacts
        if (
          !observation.checks.length ||
          observation.checks.some(
            (check) => !check.name || !isDeepStrictEqual(check.actual, check.expected)
          )
        ) {
          row.status = 'failed'
          row.reason = 'Behavioral assertions failed or absent'
        } else if (platform !== 'server' && !observation.artifacts.length) {
          row.status = 'failed'
          row.reason = 'Live artifact missing'
        } else row.status = 'verified'
      } catch (error) {
        row.status = 'failed'
        row.reason = error instanceof Error ? error.message : 'Scenario driver failed'
      }
    }
    results.push(row)
  }
  return results
}
