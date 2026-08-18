import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LlmInputPolicyError,
  LlmInputPolicyRegistrationError,
  LlmRequestCompatibilityError,
  LlmRequestInvalidResultError,
  LlmRequestTransformError,
  LlmRequestTransformRegistrationError,
  PluginApiError,
} from '../lib/errors.js'

const cases = [
  [LlmRequestTransformRegistrationError, 'LLM_REQUEST_TRANSFORM_REGISTRATION_INVALID'],
  [LlmRequestTransformError, 'LLM_REQUEST_TRANSFORM_FAILED'],
  [LlmRequestInvalidResultError, 'LLM_REQUEST_INVALID_RESULT'],
  [LlmRequestCompatibilityError, 'LLM_REQUEST_COMPATIBILITY_FAILED'],
  [LlmInputPolicyRegistrationError, 'LLM_INPUT_POLICY_REGISTRATION_INVALID'],
  [LlmInputPolicyError, 'LLM_INPUT_POLICY_FAILED'],
]

for (const [ErrorType, code] of cases) {
  test(`${ErrorType.name} exposes stable facade code`, () => {
    const cause = new Error('cause')
    const error = new ErrorType('failure', { cause })
    assert.ok(error instanceof PluginApiError)
    assert.ok(error instanceof Error)
    assert.equal(error.name, ErrorType.name)
    assert.equal(error.code, code)
    assert.equal(error.message, 'failure')
    assert.equal(error.cause, cause)
  })
}
