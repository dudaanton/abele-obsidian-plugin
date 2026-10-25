/** Derived status metadata shares the engine queue without acquiring file-effect authority. */
export const STATE_PROJECTION_PASS = Symbol.for('abele.sync.state-projection-pass-v1')
export type StateProjectionPass = <T>(work: () => Promise<T>) => Promise<T>
