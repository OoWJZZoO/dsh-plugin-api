import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('README presents ctx.pluginApi as the recommended supported entry', () => {
  assert.match(readme, /inject:\s*\['pluginApi'\]/)
  assert.match(readme, /推荐用法|supported/)
  assert.match(readme, /ctx\.pluginApi/)
})

test('README documents the unsupported escape hatch boundary', () => {
  assert.match(readme, /逃生舱|escape hatch/)
  assert.match(readme, /unsupported/)
  assert.match(readme, /不拦截|不 patch|不 block|不保障/)
})

test('README references the F0.4 authoritative spec and F0.5 chain safety', () => {
  assert.match(readme, /plugin-api-facade-integrity/)
  assert.match(readme, /链安全|包装链/)
})
