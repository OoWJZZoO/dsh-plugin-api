/**
 * Typed errors for the dsh-plugin-api facade.
 *
 * All facade errors extend PluginApiError so third-party plugins can catch a
 * single base class while still switching on `code` when they need precise
 * behavior. Messages are intended to be human-readable on the front desk.
 */
export class PluginApiError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export class PluginApiInactiveError extends PluginApiError {
  constructor(message = 'dsh-plugin-api facade is inactive; the requested API is unavailable') {
    super('PLUGIN_API_INACTIVE', message)
  }
}

export class PluginApiFeatureDisabledError extends PluginApiError {
  constructor(feature, message) {
    super(
      'PLUGIN_API_FEATURE_DISABLED',
      message === undefined
        ? `dsh-plugin-api feature "${feature}" is disabled and its API is unavailable`
        : `dsh-plugin-api feature "${feature}" is disabled: ${message}`,
    )
    this.feature = feature
  }
}

export class PluginApiVersionError extends PluginApiError {
  constructor({ declared, required, pluginName } = {}) {
    const who = pluginName ? `plugin "${pluginName}"` : 'a third-party plugin'
    super(
      'PLUGIN_API_VERSION_MISMATCH',
      `dsh-plugin-api version mismatch: ${who} requires facade API ${required}, but the running facade declares ${declared}`,
    )
    this.declared = declared
    this.required = required
    if (pluginName !== undefined) this.pluginName = pluginName
  }
}

export class PluginApiEventPriorityError extends PluginApiError {
  constructor(priority) {
    super(
      'PLUGIN_API_INVALID_PRIORITY',
      `dsh-plugin-api events: invalid listener priority ${JSON.stringify(priority)}; ` +
        "expected one of 'lowest' | 'low' | 'normal' | 'high' | 'highest' | 'monitor'",
    )
    this.priority = priority
  }
}

export class PluginApiServiceUnavailableError extends PluginApiError {
  constructor(service) {
    super(
      'PLUGIN_API_SERVICE_UNAVAILABLE',
      `dsh-plugin-api requires official service "${service}", but it is unavailable in this composition`,
    )
    this.service = service
  }
}

export class PluginApiSettingsNamespaceError extends PluginApiError {
  constructor(ns) {
    super(
      'PLUGIN_API_SETTINGS_NAMESPACE_NOT_FOUND',
      `dsh-plugin-api settings: namespace "${ns}" was not registered through pluginApi.settings.register`,
    )
    this.ns = ns
  }
}

export class PluginApiRemoteError extends PluginApiError {
  constructor(message, { serviceKey } = {}) {
    const base = message === undefined
      ? 'the publication request is invalid'
      : message
    const suffix = serviceKey === undefined ? '' : ` (serviceKey: "${serviceKey}")`
    super('PLUGIN_API_REMOTE_INVALID', `dsh-plugin-api remote: ${base}${suffix}`)
    if (serviceKey !== undefined) this.serviceKey = serviceKey
  }
}

export class LlmRequestTransformRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('LLM_REQUEST_TRANSFORM_REGISTRATION_INVALID', message, options)
  }
}

export class LlmRequestTransformError extends PluginApiError {
  constructor(message, options) {
    super('LLM_REQUEST_TRANSFORM_FAILED', message, options)
  }
}

export class LlmRequestInvalidResultError extends PluginApiError {
  constructor(message, options) {
    super('LLM_REQUEST_INVALID_RESULT', message, options)
  }
}

export class LlmRequestCompatibilityError extends PluginApiError {
  constructor(message, options) {
    super('LLM_REQUEST_COMPATIBILITY_FAILED', message, options)
  }
}

export class LlmInputPolicyRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('LLM_INPUT_POLICY_REGISTRATION_INVALID', message, options)
  }
}

export class LlmInputPolicyError extends PluginApiError {
  constructor(message, options) {
    super('LLM_INPUT_POLICY_FAILED', message, options)
  }
}

export class RecoveryPolicyRegistrationError extends PluginApiError {
  constructor(message, options) {
    super('RECOVERY_POLICY_REGISTRATION_INVALID', message, options)
  }
}

export class RecoveryPolicyDecisionError extends PluginApiError {
  constructor(message, options) {
    super('RECOVERY_POLICY_DECISION_INVALID', message, options)
  }
}

export class RecoveryPolicyConsumeError extends PluginApiError {
  constructor(message, options) {
    super('RECOVERY_POLICY_CONSUME_INVALID', message, options)
  }
}

export class RecoveryPolicyBoundaryError extends PluginApiError {
  constructor(message, options) {
    super('RECOVERY_POLICY_UNSUPPORTED_BOUNDARY', message, options)
  }
}
