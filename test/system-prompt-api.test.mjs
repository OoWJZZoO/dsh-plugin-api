import test from 'node:test'
import assert from 'node:assert/strict'
import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createSystemPromptApi } from '../lib/system-prompt.js'

function createMockSystemPrompt() {
  const calls = []
  const disposers = {
    section: () => 'section-disposer',
    context: () => 'context-disposer',
    variable: () => 'variable-disposer',
    tools: () => 'tools-disposer',
    suppressRuntimeContext: () => 'suppress-disposer',
  }
  return {
    calls,
    service: {
      section(section) {
        calls.push(['section', section])
        return disposers.section()
      },
      context(context) {
        calls.push(['context', context])
        return disposers.context()
      },
      variable(name, provider) {
        calls.push(['variable', name, provider])
        return disposers.variable()
      },
      tools(provider) {
        calls.push(['tools', provider])
        return disposers.tools()
      },
      suppressRuntimeContext() {
        calls.push(['suppressRuntimeContext'])
        return disposers.suppressRuntimeContext()
      },
    },
  }
}

test('system prompt passthroughs forward to the official service with the same arguments and return its disposer', () => {
  const mock = createMockSystemPrompt()
  const api = createSystemPromptApi({ systemPrompt: mock.service })

  const section = { name: 's1', order: 10, text: 'hello' }
  assert.equal(api.section(section), 'section-disposer')
  assert.deepEqual(mock.calls[0], ['section', section])

  const context = { name: 'c1', order: 20, text: 'ctx' }
  assert.equal(api.context(context), 'context-disposer')
  assert.deepEqual(mock.calls[1], ['context', context])

  const provider = () => undefined
  assert.equal(api.variable('v', provider), 'variable-disposer')
  assert.deepEqual(mock.calls[2], ['variable', 'v', provider])

  const tools = () => ({ schemas: [] })
  assert.equal(api.tools(tools), 'tools-disposer')
  assert.deepEqual(mock.calls[3], ['tools', tools])

  assert.equal(api.suppressRuntimeContext(), 'suppress-disposer')
  assert.deepEqual(mock.calls[4], ['suppressRuntimeContext'])
})

test('system prompt passthroughs propagate official service errors unchanged', () => {
  const sentinel = new Error('duplicate section name')
  const service = {
    section() {
      throw sentinel
    },
    context() {},
    variable() {},
    tools() {},
    suppressRuntimeContext() {},
  }
  const api = createSystemPromptApi({ systemPrompt: service })

  assert.throws(() => api.section({ name: 'dup', order: 0, text: 'x' }), (error) => error === sentinel)
})

test('render returns exactly the official renderPrompt result', () => {
  const api = createSystemPromptApi({ systemPrompt: createMockSystemPrompt().service })
  const assembly = {
    sections: [
      { name: 's1', text: 'Hello {{name}}' },
      { name: 's2', text: 'Empty next' },
    ],
    contexts: [{ name: 'c1', text: 'Context {{where}}' }],
    tools: [],
    variables: { name: 'World', where: 'here' },
  }

  assert.equal(api.render(assembly), dshSystemPrompt.renderPrompt(assembly))
})

test('renderContextSections returns exactly the official renderContextSections result', () => {
  const api = createSystemPromptApi({ systemPrompt: createMockSystemPrompt().service })
  const assembly = {
    sections: [],
    contexts: [
      { name: 'c1', text: 'Context {{where}}' },
      { name: 'c2', text: '' },
    ],
    tools: [],
    variables: { where: 'here' },
  }

  assert.deepEqual(api.renderContextSections(assembly), dshSystemPrompt.renderContextSections(assembly))
})

test('render propagates official helper errors unchanged', () => {
  const api = createSystemPromptApi({ systemPrompt: createMockSystemPrompt().service })
  const assembly = {
    sections: [{ name: 's1', text: 'Hello {{missing}}' }],
    contexts: [],
    tools: [],
    variables: {},
  }

  let officialMessage
  assert.throws(() => dshSystemPrompt.renderPrompt(assembly), (error) => {
    officialMessage = error.message
    return true
  })
  assert.throws(() => api.render(assembly), (error) => error.message === officialMessage)
})

test('renderContextSections propagates official helper errors unchanged', () => {
  const api = createSystemPromptApi({ systemPrompt: createMockSystemPrompt().service })
  const assembly = {
    sections: [],
    contexts: [{ name: 'c1', text: 'Context {{missing}}' }],
    tools: [],
    variables: {},
  }

  let officialMessage
  assert.throws(() => dshSystemPrompt.renderContextSections(assembly), (error) => {
    officialMessage = error.message
    return true
  })
  assert.throws(() => api.renderContextSections(assembly), (error) => error.message === officialMessage)
})

test('render propagates malformed reference errors exactly like the official helper', () => {
  const api = createSystemPromptApi({ systemPrompt: createMockSystemPrompt().service })
  const assembly = {
    sections: [{ name: 's1', text: 'Hello {{bad name}}' }],
    contexts: [],
    tools: [],
    variables: {},
  }

  let officialMessage
  assert.throws(() => dshSystemPrompt.renderPrompt(assembly), (error) => {
    officialMessage = error.message
    return true
  })
  assert.throws(() => api.render(assembly), (error) => error.message === officialMessage)
})
