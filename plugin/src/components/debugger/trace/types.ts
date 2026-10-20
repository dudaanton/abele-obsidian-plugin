// What the recording of a data flow draws: a run of steps in time — values taken at record points
// in the code, the browser's requests — and what is worked out of them on the node: a value's
// shape, how it changed since the step before, where one value travels. Plain data, so the views
// can be built and tested without a node; the node only has to fill these shapes.

/** One level of a value's shape: its keys and types, how long its lists are, one example. */
export interface ShapeNode {
  /** The key or `[*]` for the elements of a list; none at the top. */
  key?: string
  /** `object`, `string`, `number`, `Contract`, `<item>` for an XML element. */
  type: string
  /** A list's length, an element's count. */
  count?: number
  /** Missing in some of the elements. */
  optional?: boolean
  /** One value, for a leaf. */
  example?: string
  children?: ShapeNode[]
}

/** A value taken whole at a step: a variable at a record point, a request's or response's body. */
export interface TraceValue {
  name: string
  /** How it reads in one line: `{ items: 214 }`, `"<?xml…"`, `1250`. */
  brief: string
  /** Its size in bytes, said by the view. */
  bytes: number
  format: 'json' | 'xml' | 'text' | 'number' | 'headers'
  /** The same content as the value of that name at the step before: nothing new to read. */
  same?: boolean
  /** A secret blanked before it was written: there is nothing behind it to show. */
  masked?: boolean
  /** It could not be taken, and why. */
  failed?: string
  shape?: ShapeNode
  /** Compared to the value of that name the last time it was taken. */
  changes?: { summary: string; before: string; after: string }
  /** The whole text, for the tab it opens in. */
  text?: string
}

/** A value the node found again in another step, offered as where this one came from. */
export interface TraceLink {
  value: string
  /** The step it came from. */
  from: string
  /** How that step reads: `GET /contracts/20418`. */
  label: string
  /** Confirmed by you or the agent; until then it is the node's suggestion. */
  confirmed?: boolean
}

export type TraceStepKind = 'probe' | 'http' | 'error' | 'browser-lost'

export interface TraceStep {
  id: string
  kind: TraceStepKind
  /** Milliseconds from the start of the run. */
  at: number
  /** The record point's note, a request's method and address, an error's message. */
  label: string
  /** Where in the code, for a record point or an error. */
  place?: { file: string; line: number; fn?: string }
  stack?: string[]
  /** How long the program stood while the values were taken. */
  pausedMs?: number
  /** HTTP traffic observed in the debugged program. */
  direction?: 'incoming' | 'outgoing'
  durationMs?: number
  /** A request's status. */
  status?: number
  /** The host a request went to; its label keeps the method and path. */
  host?: string
  /** The request it belongs to: steps of one request stand together. */
  chain?: string
  /** Put under its request only because it ran while the request was out, not by a header. */
  byTime?: boolean
  /** A request sent from the project's Requests, not by the browser. */
  sent?: boolean
  values: TraceValue[]
  /** A browser request: what went out and what came back. */
  request?: TraceValue[]
  response?: TraceValue[]
  links?: TraceLink[]
  /** Marked by you. */
  marked?: boolean
}

export interface TraceRun {
  id: string
  /** Its date and time, or the name you gave it. */
  name: string
  /** How long it went, said as it should read. */
  length: string
  steps: TraceStep[]
  /** Stopped by a lost connection rather than by you. */
  cut?: boolean
}

/** One place a followed value was seen. */
export interface TrailStop {
  step: string
  /** Where in the value: `$.items[7].id`. */
  path: string
  /** Said where it changed: `string → number`, `renamed`. */
  change?: string
}

export interface TraceTrail {
  value: string
  stops: TrailStop[]
  /** The last step it was seen at, when the run goes on past it. */
  lostAfter?: string
}

/** A recording going on now. */
export interface TraceRecording {
  /** How long it has gone, said as it should read: `1:42`. */
  elapsed: string
  steps: number
  browser: {
    state: 'connected' | 'none' | 'lost'
    /** The tab's title. */
    tab?: string
    via: 'chrome' | 'agent' | 'har'
    hosts: string[]
  }
  /** The folder on disk the run is written to. */
  folder: string
}

/** A run as the list of runs shows it. */
export interface TraceRunSummary {
  id: string
  name: string
  steps: number
  length: string
  cut?: boolean
}
