/**
 * Operation sub-face of the compaction replacement bundle: the additive
 * extension the main facade's compaction operation projects over.
 *
 * The main facade never imports this module: it detects the sub-face through
 * the shared `Symbol.for` marker and calls `run(spec)`, receiving a frozen
 * discriminated outcome instead of the public methods' overloaded `null`.
 *
 * The discriminating channel lives here, inside the replacement's own forked
 * engine: the veto sentinel carries the `compaction/request` decision reason
 * from its dispatch point, the selection-null (no candidate) happens before
 * the veto, and the range path's failures keep their stage on the thrown error
 * — so compacted / skipped / rejected(reason) / aborted / failed(code, stage)
 * are told apart by types and values, never by message matching.
 */
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import {
  InvalidRangeError,
  OpenTurnRequiredError,
  SurfaceChangedError,
  isCompactionRejected,
  selectCompactableRange,
} from './forked-engine.js'

/** Sole operation-sub-face marker between this bundle and the main facade. */
export const OPERATION_SUBFACE_SYMBOL = Symbol.for('dsh-plugin-api.compaction-events.operation')

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isInteger = (value) => Number.isInteger(value)

const outcome = (value) => Object.freeze(value)
const failed = (code, stage) => outcome({ kind: 'failed', code, ...(stage === undefined ? {} : { stage }) })

/** Project the engine's commit result onto the public lineage fields only. */
export function lineageOf(result) {
  return Object.freeze({
    compactionId: result.compactionId,
    shadowedRange: Object.freeze({ start: result.shadowedRange.start, end: result.shadowedRange.end }),
    shadowedSeqs: Object.freeze([...result.shadowedSeqs]),
    shadowedTokenCount: result.shadowedTokenCount,
    startSeq: result.startSeq,
    summarySeq: result.summarySeq,
    endSeq: result.endSeq,
    ...(result.sourceCommandId === undefined ? {} : { sourceCommandId: result.sourceCommandId }),
  })
}

/** Classify one engine failure into the declared operation codes. */
export function classifyOperationFailure(error, signal) {
  if (signal?.aborted === true) return outcome({ kind: 'aborted' })
  if (error?.name === 'AbortError') return outcome({ kind: 'aborted' })
  if (error instanceof OpenTurnRequiredError) return failed('open-turn-required')
  if (error instanceof InvalidRangeError) return failed('invalid-range')
  if (error instanceof SurfaceChangedError) return failed('surface-changed')
  if (error instanceof ManualCompactionError) {
    switch (error.code) {
      case 'busy': return failed('busy')
      case 'cancelled': return outcome({ kind: 'aborted' })
      case 'changed': return failed('surface-changed')
      case 'summary': return failed('summary-failed', 'summary')
      case 'commit': return failed('commit-failed', 'commit')
      case 'persistence': return failed('persistence-failed', 'commit')
      default: return failed('internal')
    }
  }
  // The direct/range path keeps the failure stage on the thrown error.
  const stage = error?.compactionStage
  if (stage === 'summary') return failed('summary-failed', 'summary')
  if (stage === 'commit') return failed('commit-failed', 'commit')
  return failed('internal')
}

/** Validate the spec shape (the facade validates too; this keeps the sub-face self-guarding). */
function validateSpec(spec) {
  if (!isPlainObject(spec)) return 'invalid-arguments'
  if (spec.mode !== 'now' && spec.mode !== 'range') return 'invalid-arguments'
  if (!isPlainObject(spec.agent) || !isPlainObject(spec.agent.session)) return 'invalid-target'
  if (spec.mode === 'range') {
    const range = spec.range
    if (!isPlainObject(range) || !isInteger(range.start) || !isInteger(range.end)) return 'invalid-arguments'
  }
  return null
}

/**
 * Build the operation sub-face over one forked engine instance.
 *
 * `run(spec)` mirrors the engine's own internal sequences — it does not
 * reinterpret the public methods' collapsed `null`:
 * - `mode 'now'`: the manual idle-session bracket (`runMaintenance`), the
 *   engine's own selection, then the manual region routing;
 * - `mode 'range'`: the direct region routing.
 *
 * The public `compactNow`/`compactRegion`/`compactIfNeeded` methods and every
 * `compaction/*` fact remain exactly as they are.
 */
export function createOperationSubface(engine) {
  const runNow = async (spec) => {
    const { agent, signal, sourceCommandId } = spec
    signal?.throwIfAborted()
    // The agent loop refuses a non-idle maintenance request SYNCHRONOUSLY; the
    // call and the await are separated so that refusal is classified by source
    // (the synchronous throw) and never by matching the upstream message.
    let job
    try {
      job = agent.runMaintenance(async (agentSignal) => {
        // The public method always receives a signal; the sub-face allows it to
        // be omitted, so the combined signal is built only when one exists.
        const operationSignal = signal === undefined ? agentSignal : AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          const range = selectCompactableRange(agent.session, engine.ctx.tokenMeter.measure(agent.session), 0)
          if (range === null) return outcome({ kind: 'skipped', reason: 'no-candidate' })
          const manual = await engine.compactRegionInternal(range.start, range.end, agent, 'manual', operationSignal, sourceCommandId)
          if (isCompactionRejected(manual)) return outcome({ kind: 'rejected', reason: manual.reason })
          return outcome({ kind: 'compacted', result: manual })
        } catch (error) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ManualCompactionError('cancelled', 'manual compaction was cancelled', { cause: error })
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch {
      // The synchronous non-idle refusal (the only synchronous throw of the
      // maintenance bracket) is the declared busy outcome.
      return failed('busy')
    }
    try {
      return await job
    } catch (error) {
      if (error instanceof ManualCompactionError) throw error
      if (error?.name === 'AbortError' || signal?.aborted === true) throw error
      throw error
    }
  }

  const runRange = async (spec) => {
    const { agent, signal, range, sourceCommandId } = spec
    signal?.throwIfAborted()
    const result = await engine.compactRegionInternal(range.start, range.end, agent, 'direct', signal, sourceCommandId)
    if (isCompactionRejected(result)) return outcome({ kind: 'rejected', reason: result.reason })
    return outcome({ kind: 'compacted', result })
  }

  return Object.freeze({
    [OPERATION_SUBFACE_SYMBOL]: true,
    async run(spec) {
      const invalid = validateSpec(spec)
      if (invalid !== null) return failed(invalid)
      try {
        const raw = spec.mode === 'now' ? await runNow(spec) : await runRange(spec)
        if (raw.kind === 'compacted') return outcome({ kind: 'compacted', lineage: lineageOf(raw.result) })
        return raw
      } catch (error) {
        return classifyOperationFailure(error, spec.signal)
      }
    },
  })
}

/** Attach the sub-face to one provider instance (idempotent, additive). */
export function attachOperationSubface(engine) {
  if (engine == null || typeof engine !== 'object') return false
  if (engine[OPERATION_SUBFACE_SYMBOL] === true && isPlainObject(engine.operation)) return true
  const subface = createOperationSubface(engine)
  try {
    Object.defineProperty(engine, 'operation', { value: subface, enumerable: false, configurable: true, writable: false })
    Object.defineProperty(engine, OPERATION_SUBFACE_SYMBOL, { value: true, enumerable: false, configurable: true, writable: false })
  } catch {
    return false
  }
  return true
}

/** Whether one provider carries the operation sub-face marker. */
export function hasOperationSubface(service) {
  return service != null && service[OPERATION_SUBFACE_SYMBOL] === true && isPlainObject(service.operation) && typeof service.operation.run === 'function'
}
