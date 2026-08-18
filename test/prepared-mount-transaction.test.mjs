import test from 'node:test'
import assert from 'node:assert/strict'
import { runPreparedMountTransaction } from '../lib/index.js'

function context({ fail = null } = {}) {
  const order = []
  return {
    order,
    effect(fn, label) {
      order.push(`effect:${label}`)
      if (fail === 'effect') throw new Error('effect failure')
      this.cleanup = fn()
    },
  }
}

test('prepared host transaction orders cleanup registration before commit then registry activation', () => {
  const ctx = context()
  const transaction = {
    cleanup() { ctx.order.push('dispose') },
    commit() { ctx.order.push('commit'); return true },
    rollback() { ctx.order.push('rollback') },
    activate() { ctx.order.push('activate') },
  }

  const cleanup = runPreparedMountTransaction({ ctx, featureName: 'owner', ...transaction })
  assert.deepEqual(ctx.order, ['effect:dsh-plugin-api: owner cleanup', 'commit', 'activate'])
  assert.equal(cleanup(), true)
  assert.equal(cleanup(), false)
  assert.deepEqual(ctx.order, ['effect:dsh-plugin-api: owner cleanup', 'commit', 'activate', 'rollback', 'dispose'])
})

test('effect, commit, and activation failure roll back and dispose once without leaking a later transaction', () => {
  for (const fail of ['effect', 'commit', 'activate']) {
    const ctx = context({ fail })
    const order = ctx.order
    const transaction = {
      cleanup() { order.push('dispose') },
      commit() { order.push('commit'); if (fail === 'commit') throw new Error('commit failure'); return true },
      rollback() { order.push('rollback') },
      activate() { order.push('activate'); if (fail === 'activate') throw new Error('activation failure') },
    }
    assert.throws(() => runPreparedMountTransaction({ ctx, featureName: 'owner', ...transaction }), /failure/)
    assert.equal(order.filter((item) => item === 'rollback').length, 1)
    assert.equal(order.filter((item) => item === 'dispose').length, 1)
  }
})
