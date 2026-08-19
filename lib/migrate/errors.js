export class MigrationToolError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'MigrationToolError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function fail(code, message, details) {
  throw new MigrationToolError(code, message, details)
}
