import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyReport,
  redactDependencies,
  redactEvidence,
  redactReason,
  redactRemediation,
  redactValue,
  sanitizeDetail,
  AVAILABILITY_VALUES,
  BLOCKING_VALUES,
  HEALTH_VALUES,
  SEVERITY_VALUES,
  UNCERTAINTY_VALUES,
} from '../lib/diagnostics-normalize.js'

test('classifyReport accepts every legal primary vocabulary value', () => {
  for (const health of HEALTH_VALUES) {
    const { invalid, report } = classifyReport({ health })
    assert.equal(invalid, undefined)
    assert.equal(report.health, health)
  }
  for (const availability of AVAILABILITY_VALUES) {
    const { report } = classifyReport({ availability })
    assert.equal(report.availability, availability)
  }
  for (const severity of SEVERITY_VALUES) {
    const { report } = classifyReport({ severity })
    assert.equal(report.severity, severity)
  }
  for (const blocking of BLOCKING_VALUES) {
    const { report } = classifyReport({ blocking })
    assert.equal(report.blocking, blocking)
  }
  for (const uncertainty of UNCERTAINTY_VALUES) {
    const { report } = classifyReport({ uncertainty })
    assert.equal(report.uncertainty, uncertainty)
  }
})

test('classifyReport fills neutral defaults that never claim health', () => {
  const { report } = classifyReport({})
  assert.deepEqual(report, {
    health: 'unknown',
    availability: 'unknown',
    severity: 'info',
    blocking: 'unknown',
    uncertainty: 'inferred',
  })
})

test('classifyReport rejects out-of-vocabulary primary fields as invalid', () => {
  const cases = [
    { health: 'super' },
    { availability: 'online' },
    { severity: 'fatal' },
    { blocking: 'maybe' },
    { uncertainty: 'guessed' },
    { health: 1 },
    'raw string',
    null,
    undefined,
    [],
  ]
  for (const input of cases) {
    assert.equal(classifyReport(input).invalid, true, JSON.stringify(input))
  }
})

test('classifyReport carries evidence/reason/remediation through bounded redaction', () => {
  const { report } = classifyReport({
    health: 'degraded',
    availability: 'degraded-active',
    evidence: { package: 'dsh-llm', version: '1.2.3', runtime: '0.1.0', capability: 'stream', t0ken: 'leak' },
    reason: { code: 'mismatch', category: 'version', boundedDetail: 'installed 1.2.3 needed 2.0.0' },
    remediation: { actionId: 'upgrade', prerequisite: 'network', mode: 'manual' },
  })
  assert.equal(report.health, 'degraded')
  assert.equal(report.availability, 'degraded-active')
  assert.deepEqual(report.evidence, { package: 'dsh-llm', version: '1.2.3', runtime: '0.1.0', capability: 'stream' })
  assert.deepEqual(report.reason, { code: 'mismatch', category: 'version', boundedDetail: 'installed 1.2.3 needed 2.0.0' })
  assert.deepEqual(report.remediation, { actionId: 'upgrade', prerequisite: 'network', mode: 'manual' })
})

test('invalid or absent auxiliary fields degrade to omission, not check failure', () => {
  const { report } = classifyReport({
    health: 'healthy',
    evidence: 'not-an-object',
    reason: { category: 'no-code' },
    remediation: { mode: 'manual' },
    dependencies: 'nope',
  })
  assert.equal(report.health, 'healthy')
  assert.equal(report.evidence, undefined)
  assert.equal(report.reason, undefined)
  assert.equal(report.remediation, undefined)
})

test('redactValue drops secret-named keys and credential-shaped values', () => {
  assert.deepEqual(redactValue({ token: 'abc', safe: 'x', Authorization: 'Bearer sk-secret', 'api-key': 'k' }), {
    token: '[redacted]',
    safe: 'x',
    Authorization: '[redacted]',
    'api-key': '[redacted]',
  })
  assert.equal(redactValue('sk-abcdefghijklmn'), '[redacted]')
  assert.equal(redactValue('Bearer 12345678901234567890'), '[redacted]')
  assert.equal(redactValue('-----BEGIN RSA PRIVATE KEY-----'), '[redacted]')
  assert.equal(redactValue('plain text'), 'plain text')
})

test('redactValue is depth-bounded and never emits exotic objects', () => {
  const wrapped = redactValue({ a: { b: { c: { d: { e: 'deep' } } } } })
  assert.equal(wrapped.a.b.c.d, '[bounded]')
  assert.equal(redactValue(() => 'fn'), '[bounded]')
  assert.equal(redactValue(new Date(0)), '[bounded]')
})

test('redactValue fails closed to a marker when a getter throws', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'x', {
    enumerable: true,
    get() {
      throw new Error('boom')
    },
  })
  assert.equal(redactValue(hostile).x, '[redaction-failed]')
})

test('sanitizeDetail collapses lines, trims and caps length', () => {
  assert.equal(sanitizeDetail('  a\nb\rc '), 'a b c')
  assert.equal(sanitizeDetail(42), undefined)
  assert.equal(sanitizeDetail('   '), undefined)
  const long = 'x'.repeat(500)
  assert.equal(sanitizeDetail(long).length, 201)
})

test('redactEvidence keeps only the four allow-listed bounded fields', () => {
  assert.deepEqual(redactEvidence({ package: 'p', version: '1', runtime: 'r', capability: 'c', extra: 'x', token: 't' }), {
    package: 'p',
    version: '1',
    runtime: 'r',
    capability: 'c',
  })
  assert.equal(redactEvidence({ onlyExtra: 'x' }), undefined)
  assert.equal(redactEvidence('raw'), undefined)
})

test('redactReason requires a code and bounds the detail', () => {
  assert.deepEqual(redactReason({ code: 'err', category: 'cat', boundedDetail: 'detail' }), {
    code: 'err',
    category: 'cat',
    boundedDetail: 'detail',
  })
  assert.equal(redactReason({ category: 'no-code' }), undefined)
  assert.equal(redactReason('raw'), undefined)
})

test('redactRemediation validates mode safely and never exposes execution', () => {
  assert.deepEqual(redactRemediation({ actionId: 'fix', prerequisite: 'step', mode: 'manual' }), {
    actionId: 'fix',
    prerequisite: 'step',
    mode: 'manual',
  })
  assert.deepEqual(redactRemediation({ actionId: 'fix', mode: 'bogus' }), { actionId: 'fix', mode: 'informational' })
  assert.equal(redactRemediation({ mode: 'manual' }), undefined)
  assert.equal(redactRemediation({ actionId: 'fix', mode: 'manual' }).mode, 'manual')
})

test('redactDependencies normalizes bounded dependency summaries', () => {
  assert.deepEqual(redactDependencies([
    { id: 'llm', status: 'absent', evidence: { package: 'dsh-llm', token: 'x' } },
    { id: 'tools' },
    { extra: 'drop' },
    'raw',
  ]), [
    { id: 'llm', status: 'absent', evidence: { package: 'dsh-llm' } },
    { id: 'tools', status: 'unknown' },
  ])
  assert.equal(redactDependencies([]), undefined)
  assert.equal(redactDependencies('raw'), undefined)
})
