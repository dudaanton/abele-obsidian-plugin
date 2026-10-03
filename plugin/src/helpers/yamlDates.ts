import { DEFAULT_SCHEMA, dump, load, Type, type DumpOptions } from 'js-yaml'

export const isCalendarDate = (text: unknown): text is string =>
  typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)

// A companion read for source spelling only. Never use it in place of the note's reader:
// front-matter still owns value semantics (including YAML 1.1 numbers and nested Dates).
export const timestampTextSchema = DEFAULT_SCHEMA.extend({
  implicit: [
    new Type('tag:yaml.org,2002:timestamp', {
      kind: 'scalar',
      resolve: (text: string) => /^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt \t])/.test(text),
      construct: (text: string) => text,
    }),
  ],
})

// Template merges use direct js-yaml. Keep its native Dates and all other values, but
// remember which Dates came from calendar scalars so dumping cannot invent UTC datetimes.
const calendarDates = new WeakMap<Date, string>()

export function loadCalendarYaml(source: string): unknown {
  const data = load(source)
  const spelling = load(source, { schema: timestampTextSchema })
  const seen = new WeakSet<object>()
  function remember(value: unknown, text: unknown): void {
    if (value instanceof Date) {
      if (isCalendarDate(text)) calendarDates.set(value, text)
    } else if (value && typeof value === 'object' && text && typeof text === 'object') {
      if (seen.has(value)) return
      seen.add(value)
      for (const [key, child] of Object.entries(value)) {
        remember(child, (text as Record<string, unknown>)[key])
      }
    }
  }
  remember(data, spelling)
  return data
}

const calendarDumpSchema = DEFAULT_SCHEMA.extend({
  implicit: [
    new Type('tag:yaml.org,2002:timestamp', {
      kind: 'scalar',
      // Preserve the default resolver's quoting decisions without replacing its parser.
      resolve: (text: string) => {
        if (!/^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt \t])/.test(text)) return false
        try {
          return load(text) instanceof Date
        } catch {
          return false
        }
      },
      instanceOf: Date,
      represent: (value: object) => {
        const date = value as Date
        return calendarDates.get(date) ?? date.toISOString()
      },
    }),
  ],
})

export function dumpCalendarYaml(value: unknown, options: DumpOptions = {}): string {
  return dump(value, { ...options, schema: calendarDumpSchema })
}
