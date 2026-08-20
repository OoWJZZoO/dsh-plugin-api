import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDisabledFacade,
  createDisabledServicesNamespace,
  createServicesNamespace,
  SERVICE_DEFINITIONS,
} from '../lib/services.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

const def = SERVICE_DEFINITIONS.find((d) => d.key === 'fs')
const compactionDef = SERVICE_DEFINITIONS.find((d) => d.key === 'compaction')
const jobsDef = SERVICE_DEFINITIONS.find((d) => d.key === 'jobs')
const shellEnvDef = SERVICE_DEFINITIONS.find((d) => d.key === 'shellEnv')

test('disabled facade throws inactive error when core is inactive', () => {
  const facade = buildDisabledFacade(def, () => false, 'test reason')
  assert.equal(facade.isActive, false)
  assert.throws(
    () => facade.readText(),
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    },
  )
})

test('disabled facade getter throws the same typed inactive error', () => {
  const facade = buildDisabledFacade(def, () => false, 'test reason')
  assert.throws(
    () => facade.sandboxMode,
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      return true
    },
  )
})

test('disabled facade throws feature-disabled error with per-service feature code', () => {
  const facade = buildDisabledFacade(def, () => true, 'official service "fs" is unavailable')
  assert.throws(
    () => facade.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'services.fs')
      assert.match(error.message, /official service "fs" is unavailable/)
      return true
    },
  )
})

test('feature-level disabled namespace throws feature-disabled error with feature code "services"', () => {
  const services = createDisabledServicesNamespace(() => true)
  assert.ok(Object.isFrozen(services))
  assert.throws(
    () => services.fs.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services')
      return true
    },
  )
})

test('per-service degradation facade does not call into official services', () => {
  let officialCalls = 0
  const ctx = {
    get(name) {
      if (name === 'fs') return undefined
      return {
        officialCalls,
        run() {
          officialCalls += 1
        },
      }
    },
  }
  const services = createServicesNamespace({ ctx, active: true })
  assert.equal(services.fs.isActive, false)
  assert.throws(() => services.fs.readText({}), PluginApiFeatureDisabledError)
  assert.equal(officialCalls, 0)
})

test('compaction degraded facade reports services.compaction without official calls', () => {
  let calls = 0
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'compaction') return undefined
        if (name === 'fs') {
          return {
            get sandboxMode() { return 'sandboxed' },
            resolve() { calls += 1 },
            processPath() {},
            fileUrl() {},
            contains() {},
            stat() {},
            lstat() {},
            readText() {},
            streamText() {},
            readBytes() {},
            listDir() {},
            writeText() {},
            editText() {},
          }
        }
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.compaction.isActive, false)
  for (const name of compactionDef.members.map((member) => member.name)) {
    assert.throws(
      () => services.compaction[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.compaction',
    )
  }
  assert.equal(calls, 0)
})

test('throwing compaction lookup degrades only compaction as degraded', () => {
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'compaction') throw new Error('lookup failed')
        if (name === 'fs') {
          return {
            sandboxMode: 'sandboxed',
            resolve() {},
            processPath() {},
            fileUrl() {},
            contains() {},
            stat() {},
            lstat() {},
            readText() {},
            streamText() {},
            readBytes() {},
            listDir() {},
            writeText() {},
            editText() {},
          }
        }
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.fs.isActive, true)
  assert.equal(services.compaction.isActive, false)
  assert.throws(
    () => services.compaction.compactIfNeeded(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.compaction',
  )
})

test('mounted active and degraded compaction facades prioritize inactive core errors', () => {
  let active = true
  let officialCalls = 0
  const complete = {
    compactIfNeeded() { officialCalls += 1 },
    compactNow() { officialCalls += 1 },
    compactRegion() { officialCalls += 1 },
  }
  const activeServices = createServicesNamespace({
    ctx: { get: (name) => (name === 'compaction' ? complete : undefined) },
    active: () => active,
  })
  const disabledServices = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'compaction') return undefined
        if (name === 'fs') return { resolve() {}, processPath() {}, fileUrl() {}, contains() {}, stat() {}, lstat() {}, readText() {}, streamText() {}, readBytes() {}, listDir() {}, writeText() {}, editText() {}, sandboxMode: 'x' }
        return undefined
      },
    },
    active: () => active,
  })

  active = false
  for (const name of compactionDef.members.map((member) => member.name)) {
    assert.throws(() => activeServices.compaction[name](), PluginApiInactiveError)
    assert.throws(() => disabledServices.compaction[name](), PluginApiInactiveError)
  }
  assert.equal(officialCalls, 0)
})

test('all-disabled fallback never exposes an active facade', () => {
  const services = createServicesNamespace({ ctx: { get: () => undefined }, active: true })
  for (const key of Object.keys(services)) {
    assert.equal(services[key].isActive, false)
  }
})

test('jobs degraded facade reports services.jobs without official calls', () => {
  const calls = { jobs: 0, fs: 0 }
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs') return undefined
        if (name === 'fs') {
          return {
            get sandboxMode() { return 'sandboxed' },
            resolve() { calls.fs += 1 },
            processPath() {}, fileUrl() {}, contains() {}, stat() {}, lstat() {},
            readText() {}, streamText() {}, readBytes() {}, listDir() {},
            writeText() {}, editText() {},
          }
        }
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.fs.isActive, true)
  assert.equal(services.jobs.isActive, false)
  for (const name of jobsDef.members.map((member) => member.name)) {
    assert.throws(
      () => services.jobs[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.jobs',
    )
  }
  assert.equal(calls.fs, 0)
})

test('shellEnv degraded facade reports services.shellEnv without official calls', () => {
  const calls = { shellEnv: 0, fs: 0 }
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'shellEnv') return undefined
        if (name === 'fs') {
          return {
            get sandboxMode() { return 'sandboxed' },
            resolve() { calls.fs += 1 },
            processPath() {}, fileUrl() {}, contains() {}, stat() {}, lstat() {},
            readText() {}, streamText() {}, readBytes() {}, listDir() {},
            writeText() {}, editText() {},
          }
        }
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.fs.isActive, true)
  assert.equal(services.shellEnv.isActive, false)
  for (const name of shellEnvDef.members.map((member) => member.name)) {
    assert.throws(
      () => services.shellEnv[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.shellEnv',
    )
  }
  assert.equal(calls.shellEnv, 0)
  assert.equal(calls.fs, 0)
})

test('throwing jobs lookup degrades only jobs as degraded while shellEnv sibling stays active', () => {
  const shellEnv = {
    register() {}, collect() {}, list() {},
  }
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs') throw new Error('lookup failed')
        if (name === 'shellEnv') return shellEnv
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.shellEnv.isActive, true)
  assert.equal(services.jobs.isActive, false)
  assert.throws(
    () => services.jobs.start(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.jobs',
  )
})

test('both jobs and shellEnv missing disables only those two while other services stay active', () => {
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs' || name === 'shellEnv') return undefined
        if (name === 'fs') {
          return {
            get sandboxMode() { return 'sandboxed' },
            resolve() {}, processPath() {}, fileUrl() {}, contains() {}, stat() {},
            lstat() {}, readText() {}, streamText() {}, readBytes() {}, listDir() {},
            writeText() {}, editText() {},
          }
        }
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.fs.isActive, true)
  assert.equal(services.jobs.isActive, false)
  assert.equal(services.shellEnv.isActive, false)
  assert.throws(
    () => services.jobs.start(),
    (error) => error.feature === 'services.jobs',
  )
  assert.throws(
    () => services.shellEnv.register({}),
    (error) => error.feature === 'services.shellEnv',
  )
})

test('jobs extras are never exposed on the active facade and never mutate the target', () => {
  const jobs = {
    start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
    onJobDone() {}, onJobsChanged() {}, attachController() {},
    layers: { internal: true },
    ownerCleanups: new Map(),
    servesOwner() {},
  }
  const services = createServicesNamespace({
    ctx: { get: (name) => (name === 'jobs' ? jobs : undefined) },
    active: true,
  })

  assert.equal(services.jobs.isActive, true)
  assert.ok(!('layers' in services.jobs))
  assert.ok(!('ownerCleanups' in services.jobs))
  assert.ok(!('servesOwner' in services.jobs))
  assert.equal(Object.isFrozen(jobs), false)
  assert.equal(typeof jobs.servesOwner, 'function')
})

test('shellEnv extras are never exposed on the active facade and never mutate the target', () => {
  const shellEnv = {
    register() {}, collect() {}, list() {},
    contributors: new Map(),
    keyOwners: new Map(),
    extraState: { x: 1 },
  }
  const services = createServicesNamespace({
    ctx: { get: (name) => (name === 'shellEnv' ? shellEnv : undefined) },
    active: true,
  })

  assert.equal(services.shellEnv.isActive, true)
  assert.ok(!('contributors' in services.shellEnv))
  assert.ok(!('keyOwners' in services.shellEnv))
  assert.ok(!('extraState' in services.shellEnv))
  assert.equal(Object.isFrozen(shellEnv), false)
})

test('throwing shellEnv lookup degrades only shellEnv as degraded while the jobs sibling stays active', () => {
  const jobs = {
    start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
    onJobDone() {}, onJobsChanged() {}, attachController() {},
  }
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'shellEnv') throw new Error('lookup failed')
        if (name === 'jobs') return jobs
        return undefined
      },
    },
    active: true,
  })

  assert.equal(services.jobs.isActive, true)
  assert.equal(services.shellEnv.isActive, false)
  assert.throws(
    () => services.shellEnv.collect({}),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.shellEnv',
  )
})

test('hostile shellEnv construction degrades only shellEnv and keeps jobs active', () => {
  const jobs = {
    start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
    onJobDone() {}, onJobsChanged() {}, attachController() {},
  }
  const shellEnv = {
    register() {}, collect() {}, list() {},
  }
  Object.defineProperty(shellEnv, 'collect', {
    get() {
      throw new Error('hostile member getter')
    },
  })
  const loggerMessages = []
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'shellEnv') return shellEnv
        if (name === 'jobs') return jobs
        return undefined
      },
    },
    active: true,
    logger: { error(message) { loggerMessages.push(message) } },
  })

  assert.equal(services.shellEnv.isActive, false)
  assert.equal(services.jobs.isActive, true)
  assert.throws(
    () => services.shellEnv.collect({}),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.shellEnv',
  )
  assert.ok(loggerMessages.length >= 1)
  assert.ok(loggerMessages.some((m) => m.includes('services.shellEnv')))
})

test('hostile jobs construction degrades only jobs and keeps shellEnv active', () => {
  const shellEnv = {
    register() {}, collect() {}, list() {},
  }
  const jobs = {
    start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
    onJobDone() {}, onJobsChanged() {}, attachController() {},
  }
  Object.defineProperty(jobs, 'wait', {
    get() {
      throw new Error('hostile member getter')
    },
  })
  const loggerMessages = []
  const services = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs') return jobs
        if (name === 'shellEnv') return shellEnv
        return undefined
      },
    },
    active: true,
    logger: { error(message) { loggerMessages.push(message) } },
  })

  assert.equal(services.jobs.isActive, false)
  assert.equal(services.shellEnv.isActive, true)
  assert.throws(
    () => services.jobs.wait(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.jobs',
  )
  assert.ok(loggerMessages.length >= 1)
  assert.ok(loggerMessages.some((m) => m.includes('services.jobs')))
})

test('mounted active and degraded jobs/shellEnv facades prioritize inactive core errors', () => {
  let active = true
  let officialCalls = 0
  const completeJobs = {
    start() { officialCalls += 1 }, list() {}, get() {}, read() {}, kill() {}, wait() {},
    onJobDone() {}, onJobsChanged() {}, attachController() {},
  }
  const completeEnv = {
    register() {}, collect() {}, list() {},
  }
  const activeServices = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs') return completeJobs
        if (name === 'shellEnv') return completeEnv
        return undefined
      },
    },
    active: () => active,
  })
  const disabledServices = createServicesNamespace({
    ctx: {
      get(name) {
        if (name === 'jobs' || name === 'shellEnv') return undefined
        if (name === 'fs') return { resolve() {}, processPath() {}, fileUrl() {}, contains() {}, stat() {}, lstat() {}, readText() {}, streamText() {}, readBytes() {}, listDir() {}, writeText() {}, editText() {}, sandboxMode: 'x' }
        return undefined
      },
    },
    active: () => active,
  })

  assert.equal(activeServices.jobs.isActive, true)
  assert.equal(activeServices.shellEnv.isActive, true)
  assert.equal(disabledServices.jobs.isActive, false)
  assert.equal(disabledServices.shellEnv.isActive, false)

  active = false
  for (const name of jobsDef.members.map((member) => member.name)) {
    assert.throws(() => activeServices.jobs[name](), PluginApiInactiveError)
    assert.throws(() => disabledServices.jobs[name](), PluginApiInactiveError)
  }
  for (const name of shellEnvDef.members.map((member) => member.name)) {
    assert.throws(() => activeServices.shellEnv[name](), PluginApiInactiveError)
    assert.throws(() => disabledServices.shellEnv[name](), PluginApiInactiveError)
  }
  assert.equal(officialCalls, 0)
})
