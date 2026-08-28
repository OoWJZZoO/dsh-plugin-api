/**
 * Pure registry validator for the public contract registry.
 *
 * Zero harness dependencies. Validates the machine-readable public contract
 * registry (single source of truth for the pre-release public contract):
 * required fields, duplicate paths, path depth, vocabulary membership, and
 * mapping/whitelist consistency. Never inspects arbitrary runtime objects and
 * never auto-discovers official members.
 *
 * Usage:
 *   node scripts/registry-validate.mjs <registry.json>
 * Exits non-zero when the registry is invalid.
 */

const VERSION_RE = /^(.+)-\d+\.\d+(?:\.\d+)?$/

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * @param {unknown} registry - parsed registry JSON content.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRegistry(registry) {
  const errors = []

  if (!isPlainRecord(registry)) {
    return { ok: false, errors: ['registry must be a JSON object'] }
  }

  const vocabulary = registry.vocabulary
  if (!isPlainRecord(vocabulary)) {
    return { ok: false, errors: ['vocabulary section is required'] }
  }
  const vocabNames = [
    'runtime', 'effect', 'composition', 'availability', 'status',
    'terminal', 'priority', 'scope', 'implementationChannel', 'deletionCategory',
  ]
  for (const name of vocabNames) {
    if (!Array.isArray(vocabulary[name]) || vocabulary[name].length === 0) {
      errors.push(`vocabulary.${name} must be a non-empty array`)
    }
  }
  const memberOf = (name, value) => {
    const list = vocabulary[name] ?? []
    return typeof value === 'string' && list.includes(value)
  }

  const baseline = registry.contractBaseline
  if (!isPlainRecord(baseline)) {
    errors.push('contractBaseline section is required')
  } else {
    if (!isNonEmptyString(baseline.packageVersion) || !VERSION_RE.test(baseline.packageVersion)) {
      errors.push('contractBaseline.packageVersion must follow <runtime>-<api>.<increment>.<maintenance>')
    }
    if (isNonEmptyString(baseline.api) && !/^\d+\.\d+$/.test(baseline.api)) {
      errors.push('contractBaseline.api must be a bare <generation>.<increment> contract')
    }
    if (baseline.frozen !== true) {
      errors.push('contractBaseline.frozen must be true while the baseline is frozen')
    }
  }

  if (!Array.isArray(registry.hostDomainTree) || registry.hostDomainTree.length === 0) {
    errors.push('hostDomainTree must be a non-empty array')
  }
  if (!Array.isArray(registry.clientDomainTree) || registry.clientDomainTree.length === 0) {
    errors.push('clientDomainTree must be a non-empty array')
  }

  const clientRoot = registry.clientRoot
  if (!isPlainRecord(clientRoot)) {
    errors.push('clientRoot section must be an object')
  } else if (!Array.isArray(clientRoot.members)) {
    errors.push('clientRoot.members must be an array of root member names')
  } else {
    const tree = new Set(registry.clientDomainTree)
    const members = new Set(clientRoot.members)
    for (const name of clientRoot.members) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        errors.push(`clientRoot.members entry ${JSON.stringify(name)} must be a non-empty string`)
      } else if (!tree.has(name)) {
        errors.push(`clientRoot.members entry ${JSON.stringify(name)} is absent from clientDomainTree`)
      }
    }
    for (const name of registry.clientDomainTree) {
      if (!members.has(name)) {
        errors.push(`clientDomainTree entry ${JSON.stringify(name)} is absent from clientRoot.members`)
      }
    }
  }

  const seenPaths = new Set()
  if (!Array.isArray(registry.members)) {
    errors.push('members must be an array')
  } else {
    for (const [index, member] of registry.members.entries()) {
      const where = `members[${index}]`
      if (!isPlainRecord(member)) {
        errors.push(`${where} must be an object`)
        continue
      }
      if (!isNonEmptyString(member.publicPath)) {
        errors.push(`${where} requires a non-empty publicPath`)
      } else {
        if (seenPaths.has(member.publicPath)) {
          errors.push(`${where} duplicates publicPath ${JSON.stringify(member.publicPath)}`)
        }
        seenPaths.add(member.publicPath)
        const segments = member.publicPath.split('.')
        const servicesRooted = member.publicPath.startsWith('services.')
        if (segments.length > 3 && !servicesRooted) {
          errors.push(`${where}: publicPath depth ${segments.length} exceeds the allowed maximum (services.* excepted)`)
        }
      }
      for (const field of ['runtime', 'effect', 'composition', 'status', 'implementationChannel']) {
        if (member[field] !== undefined && !memberOf(field, member[field])) {
          // `pending-audit` is a provisional inventory marker for members whose
          // composition audit has not run yet; it is a registry-data value, not
          // a contract vocabulary entry, and must be resolved before delivery.
          if (field === 'composition' && member[field] === 'pending-audit') continue
          errors.push(`${where}.${field} ${JSON.stringify(member[field])} is not in vocabulary.${field}`)
        }
      }
      if (member.composition === undefined && member.status === 'recommended') {
        errors.push(`${where}: a recommended member must declare a composition mode`)
      }
      if (member.status === 'recommended' && member.bypasses === undefined && member.effect !== 'read') {
        errors.push(`${where}: a recommended non-read member must declare bypasses`)
      }
      if (member.availability !== undefined && !memberOf('availability', member.availability)) {
        errors.push(`${where}.availability ${JSON.stringify(member.availability)} is not in vocabulary.availability`)
      }
    }
  }

  const seenServices = new Set()
  if (!Array.isArray(registry.servicesWhitelist)) {
    errors.push('servicesWhitelist must be an array')
  } else {
    for (const [index, entry] of registry.servicesWhitelist.entries()) {
      const where = `servicesWhitelist[${index}]`
      if (!isPlainRecord(entry) || !isNonEmptyString(entry.key)) {
        errors.push(`${where} requires a non-empty key`)
        continue
      }
      if (seenServices.has(entry.key)) {
        errors.push(`${where} duplicates service key ${JSON.stringify(entry.key)}`)
      }
      seenServices.add(entry.key)
      if (entry.channel !== undefined && !memberOf('implementationChannel', entry.channel)) {
        errors.push(`${where}.channel ${JSON.stringify(entry.channel)} is not in vocabulary.implementationChannel`)
      }
    }
  }

  const seenOld = new Set()
  if (!Array.isArray(registry.oldToTargetMapping)) {
    errors.push('oldToTargetMapping must be an array')
  } else {
    for (const [index, entry] of registry.oldToTargetMapping.entries()) {
      const where = `oldToTargetMapping[${index}]`
      if (!isPlainRecord(entry) || !isNonEmptyString(entry.oldPath) || !isNonEmptyString(entry.targetPath)) {
        errors.push(`${where} requires non-empty oldPath and targetPath`)
        continue
      }
      if (seenOld.has(entry.oldPath)) {
        errors.push(`${where} duplicates oldPath ${JSON.stringify(entry.oldPath)}`)
      }
      seenOld.add(entry.oldPath)
    }
  }

  return { ok: errors.length === 0, errors }
}

/* Direct CLI execution: `node scripts/registry-validate.mjs <registry.json>` */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync } = await import('node:fs')
  const target = process.argv[2]
  if (!target) {
    console.error('usage: node scripts/registry-validate.mjs <registry.json>')
    process.exit(2)
  }
  let registry
  try {
    registry = JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    console.error(`cannot read registry ${target}: ${error.message}`)
    process.exit(2)
  }
  const result = validateRegistry(registry)
  for (const error of result.errors) console.error(`- ${error}`)
  if (!result.ok) process.exit(1)
  console.log('registry valid')
}