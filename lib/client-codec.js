export const CLIENT_CODEC_FEATURE = 'clientCodec'

/**
 * Build strict wire codecs from the zod copy loaded by the browser bundle.
 * Passing zod explicitly keeps this leaf independent of package composition;
 * W5 supplies the single bundled copy to the public client facade.
 */
export function createClientCodec(zod) {
  if (!zod || typeof zod.object !== 'function' || typeof zod.array !== 'function') {
    throw new TypeError('client codec requires a zod v4 implementation')
  }
  const json = zod.lazy(() => zod.union([
    zod.null(), zod.boolean(), zod.string(), zod.number().finite(),
    zod.array(json), zod.record(zod.string(), json),
  ]))
  const strict = (schema, typeSymbol) => {
    if (!schema || typeof schema.parse !== 'function' || !('_zod' in schema)) {
      throw new TypeError('client codec schema must be a zod v4 schema')
    }
    return Object.freeze({ mode: 'strict', typeSymbol, schema })
  }
  const invocation = ({ id, service, namespace, method, parameters = [], result }) => {
    for (const value of [id, service, namespace, method]) {
      if (typeof value !== 'string' || value.length === 0) throw new TypeError('invocation descriptor identity must be non-empty strings')
    }
    if (!Array.isArray(parameters)) throw new TypeError('invocation descriptor parameters must be an array')
    if (!result || result.mode !== 'strict') throw new TypeError('invocation descriptor requires a strict result codec')
    return Object.freeze({
      id, service, namespace, method,
      invocation: Object.freeze({ kind: 'direct' }),
      parameters: Object.freeze([...parameters]),
      result,
    })
  }
  return Object.freeze({ zod, json, strict, invocation })
}
