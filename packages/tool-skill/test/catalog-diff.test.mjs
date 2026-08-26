import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateNotices,
  buildDelta,
  catalogDescription,
  digestCatalogEntries,
  readCatalogEntries,
  renderCatalogLine,
} from '../lib/catalog-diff.js'

const E1 = { name: 'alpha-skill', description: 'Alpha instructions' }
const E2 = { name: 'beta-skill', description: 'Beta instructions' }
const E2_CHANGED = { name: 'beta-skill', description: 'Beta instructions v2' }
const E3 = { name: 'gamma-skill', description: 'Gamma instructions' }

test('catalogDescription normalizes whitespace and truncates exactly like the official shape', () => {
  assert.equal(catalogDescription('  a   b  ', 500), 'a b')
  assert.equal(catalogDescription('short', 500), 'short')
  assert.equal(catalogDescription('x'.repeat(500), 500), 'x'.repeat(500))
  const long = catalogDescription('x'.repeat(501), 500)
  assert.equal(long.length, 500)
  assert.equal(long.endsWith('...'), true)
})

test('digestCatalogEntries is stable per entry list and sensitive to changes', () => {
  const first = digestCatalogEntries([E1, E2])
  assert.equal(digestCatalogEntries([E1, E2]), first)
  assert.notEqual(digestCatalogEntries([E2, E1]), first)
  assert.notEqual(digestCatalogEntries([E1, E2_CHANGED]), first)
  assert.notEqual(digestCatalogEntries([E1]), first)
})

test('readCatalogEntries returns undefined for unusable sources', () => {
  assert.deepEqual(readCatalogEntries({ entries: [E1, E2] }), [E1, E2])
  assert.equal(readCatalogEntries({ entries: 'nope' }), undefined)
  assert.equal(readCatalogEntries({}), undefined)
  assert.equal(readCatalogEntries(undefined), undefined)
  assert.equal(readCatalogEntries({ entries: [E1, { name: '', description: 'x' }] }), undefined)
  assert.equal(readCatalogEntries({ entries: [E1, { name: 'n', description: 3 }] }), undefined)
})

test('renderCatalogLine escapes the description only', () => {
  assert.equal(renderCatalogLine(E1), '- `alpha-skill`: Alpha instructions')
  assert.equal(renderCatalogLine({ name: 'a', description: 'x & <y> > z' }), '- `a`: x &amp; &lt;y&gt; &gt; z')
})

test('buildDelta classifies added, removed and changed by name and description', () => {
  assert.deepEqual(buildDelta([], [E1, E2]), { added: [{ name: 'alpha-skill', summary: 'Alpha instructions' }, { name: 'beta-skill', summary: 'Beta instructions' }], removed: [], changed: [] })
  assert.deepEqual(buildDelta([E1, E2], [E1]), { added: [], removed: [{ name: 'beta-skill' }], changed: [] })
  assert.deepEqual(buildDelta([E1, E2], [E1, E2_CHANGED]), { added: [], removed: [], changed: [{ name: 'beta-skill', summary: 'Beta instructions v2' }] })
  assert.deepEqual(buildDelta([E1, E2], [E2_CHANGED, E3]), {
    added: [{ name: 'gamma-skill', summary: 'Gamma instructions' }],
    removed: [{ name: 'alpha-skill' }],
    changed: [{ name: 'beta-skill', summary: 'Beta instructions v2' }],
  })
  // Same entries in any order: no delta (digest already covers identity).
  assert.deepEqual(buildDelta([E1, E2], [E2, E1]), { added: [], removed: [], changed: [] })
})

test('aggregateNotices renders the three English templates, aggregated, null on empty delta', () => {
  const delta = {
    added: [{ name: 'gamma-skill', summary: 'Gamma instructions' }],
    removed: [{ name: 'alpha-skill' }],
    changed: [{ name: 'beta-skill', summary: 'Beta instructions v2' }],
  }
  const lines = aggregateNotices(delta, 500)
  assert.deepEqual(lines, [
    'Skill `alpha-skill` has been removed',
    'Skill `gamma-skill` has been added',
    'Skill `beta-skill` has changed; its new shape is: `Beta instructions v2`',
  ])
  assert.equal(aggregateNotices({ added: [], removed: [], changed: [] }, 500), null)
})

test('aggregateNotices clamps changed summaries to the notice bound', () => {
  const long = 'y'.repeat(400)
  const [line] = aggregateNotices({ added: [], removed: [], changed: [{ name: 'beta-skill', summary: long }] }, 500)
  assert.equal(line.startsWith('Skill `beta-skill` has changed; its new shape is: `'), true)
  const summary = line.replace(/^.*is: `([^`]*)`$/, '$1')
  assert.equal(summary.length, 200)
  assert.equal(summary.endsWith('...'), true)
  // The catalog bound is respected when smaller than the notice bound.
  const [short] = aggregateNotices({ added: [], removed: [], changed: [{ name: 'beta-skill', summary: 'x'.repeat(120) }] }, 50)
  const shortSummary = short.replace(/^.*is: `([^`]*)`$/, '$1')
  assert.equal(shortSummary.length, 50)
})