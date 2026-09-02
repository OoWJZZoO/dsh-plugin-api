/**
 * Typed errors for the security policy facade (`pluginApi.security`).
 *
 * All errors extend the facade base error so third-party plugins can catch a
 * single base class while switching on `code` for precise behavior. Codes use
 * capability words only; no governance tokens.
 */
import { PluginApiError } from './errors.js'

/** Registration-time validation failure on the policy face. */
export class SecurityPolicyRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('SECURITY_POLICY_INVALID_SPEC', message, options)
  }
}

/** Policy evaluation denied a request through the model-request decision point. */
export class SecurityPolicyDeniedError extends PluginApiError {
  constructor(message, options) {
    super('SECURITY_POLICY_DENIED', message, options)
  }
}

/** Registration-time validation failure on the redaction face. */
export class SecurityRedactionRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('SECURITY_REDACTION_RULE_INVALID', message, options)
  }
}

/** Registration-time validation failure on the egress face. */
export class SecurityEgressRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('SECURITY_EGRESS_INVALID_SPEC', message, options)
  }
}

/** An egress policy denied an outbound target (denylist: only an explicit deny). */
export class SecurityEgressDeniedError extends PluginApiError {
  constructor(message, options) {
    super('SECURITY_EGRESS_DENIED', message, options)
  }
}