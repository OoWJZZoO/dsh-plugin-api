export const CLIENT_CODEC_FEATURE = 'clientCodec'

/**
 * Build strict wire codecs from the zod copy loaded by the browser bundle.
 * Passing zod explicitly keeps this leaf independent of package composition;
 * The browser bundle supplies the single bundled copy to the public client facade.
 */
export function createClientCodec(zod) {
  if (!zod || typeof zod.object !== 'function' || typeof zod.array !== 'function') {
    throw new TypeError('client codec requires a zod v4 implementation')
  }
  const json = zod.lazy(() => zod.union([
    zod.null(), zod.boolean(), zod.string(), zod.number().finite(),
    zod.array(json), zod.record(zod.string(), json),
  ]))
  const strictCodecs = new WeakSet()
  const strict = (schema, typeSymbol) => {
    if (!isOwnZodSchema(zod, schema) || typeof typeSymbol !== 'string' || typeSymbol.length === 0) {
      throw new TypeError('client codec schema must be a zod v4 schema')
    }
    const codec = Object.freeze({ mode: 'strict', typeSymbol, schema })
    strictCodecs.add(codec)
    return codec
  }
  const validateInvocation = (descriptor) => {
    if (!isPlainObject(descriptor) || !isExactDirectInvocation(descriptor.invocation)) {
      throw new TypeError('invocation descriptor must use the direct invocation contract')
    }
    if (Object.keys(descriptor).some((key) => !['id', 'service', 'namespace', 'method', 'invocation', 'parameters', 'result'].includes(key))) {
      throw new TypeError('invocation descriptor contains unsupported fields')
    }
    const { id, service, namespace, method, parameters = [], result } = descriptor
    for (const value of [id, service, namespace, method]) {
      if (typeof value !== 'string' || value.length === 0) throw new TypeError('invocation descriptor identity must be non-empty strings')
    }
    for (const value of [service, namespace, method]) {
      if (!isWireSegment(value)) throw new TypeError('invocation descriptor identity contains an invalid wire segment')
    }
    if (!Array.isArray(parameters)) throw new TypeError('invocation descriptor parameters must be an array')
    const wires = new Set()
    for (const parameter of parameters) {
      if (!isPlainObject(parameter) || Object.keys(parameter).some((key) => !['name', 'wire', 'source', 'lookup', 'acceptsUndefined', 'codec'].includes(key)) || ['name', 'wire'].some((key) => typeof parameter[key] !== 'string' || !isWireSegment(parameter[key])) || !['json', 'lookup'].includes(parameter.source) || !strictCodecs.has(parameter.codec)) {
        throw new TypeError('invocation descriptor parameter requires metadata and a strict codec from this client bundle')
      }
      if (wires.has(parameter.wire)) throw new TypeError('invocation descriptor parameters must use distinct wire fields')
      wires.add(parameter.wire)
      if (parameter.source === 'lookup' ? typeof parameter.lookup !== 'string' || parameter.lookup.length === 0 : parameter.lookup !== undefined) {
        throw new TypeError('invocation descriptor lookup metadata is malformed')
      }
      if (parameter.source === 'lookup' && parameter.acceptsUndefined !== undefined) {
        throw new TypeError('invocation descriptor lookup parameters cannot accept undefined')
      }
      if (parameter.source === 'json' && parameter.acceptsUndefined !== undefined && parameter.acceptsUndefined !== true) {
        throw new TypeError('invocation descriptor acceptsUndefined must be true when present')
      }
    }
    if (!strictCodecs.has(result)) throw new TypeError('invocation descriptor requires a strict result codec from this client bundle')
    return true
  }
  const invocation = (descriptor) => {
    const { id, service, namespace, method, parameters = [], result } = descriptor ?? {}
    const invocation = Object.freeze({
      id, service, namespace, method,
      invocation: Object.freeze({ kind: 'direct' }),
      parameters: Object.freeze([...parameters]),
      result,
    })
    validateInvocation(invocation)
    return invocation
  }
  return Object.freeze({ json, strict, invocation, validate: validateInvocation })
}

function isOwnZodSchema(zod, schema) {
  return schema != null && typeof schema.parse === 'function' && '_zod' in schema && (typeof zod.core?.$ZodType !== 'function' || schema instanceof zod.core.$ZodType)
}

function isPlainObject(value) { return value != null && typeof value === 'object' && !Array.isArray(value) }
function isExactDirectInvocation(value) { return isPlainObject(value) && value.kind === 'direct' && Object.keys(value).length === 1 }
function isWireSegment(value) { return /^[A-Za-z0-9_$.-]+$/.test(value) && value !== '.' && value !== '..' }
