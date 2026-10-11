// What the debugger screens draw. Plain data, so the views can be built and tested without a
// running program; the node's debug adapter only has to fill these shapes.

export type DebugStatus = 'starting' | 'running' | 'paused' | 'exited' | 'lost'

export interface DebugVariable {
  name: string
  value: string
  /** Shown in the tooltip ("number", "string", "Order"). */
  type?: string
  children?: DebugVariable[]
  /** Opaque scope reference; inspection is an explicit approved action. */
  handle?: string
  /** Changed by the last step. */
  changed?: boolean
}

export interface DebugFrame {
  name: string
  file: string
  line: number
}

export interface DebugBreakpoint {
  file: string
  line: number
  /** set: the adapter took it; pending: not confirmed yet; rejected: it cannot stop there. */
  state: 'set' | 'pending' | 'rejected'
  reason?: string
}

export interface DebugWatch {
  expression: string
  value?: string
  error?: string
}

export interface DebugSession {
  /** What runs: a script of package.json, a file, a test. */
  program: string
  status: DebugStatus
  /** Why it stopped: a breakpoint, a step, a pause, an exception. */
  reason?: string
  exitCode?: number
  /** When the last news came, said as it should read; shown while the node is away. */
  seen?: string
  frames: DebugFrame[]
  /** The frame being looked at; the top one unless picked. */
  frame: number
  variables: DebugVariable[]
  breakpoints: DebugBreakpoint[]
  watches: DebugWatch[]
  output: string
  /** ask: the agent asks before each action; allow: it acts by itself, in this session only. */
  mode: 'ask' | 'allow' | 'unknown'
}

/** An action the chat agent asks to take, or took, in the session. */
export interface DebugAction {
  id: string
  /** Node observation time, used to place cards between chat messages. */
  timestamp?: number
  /** step-over, step-into, step-out, continue, pause, evaluate, set, breakpoint, restart, stop. */
  kind: string
  /** The exact action in code form ("price * quantity", "total = 72"). */
  detail?: string
  /** Full normalized proposal, including complete resulting breakpoint intent. */
  exact?: string
  /** Where the program stood when it was asked ("total.ts:6"). */
  at: string
  status: 'asked' | 'done' | 'denied' | 'expired' | 'unknown'
  /** Already approved/dispatched: awaiting evidence, not another approvable request. */
  awaitingResult?: boolean
  /** What it gave back. */
  result?: string
}
