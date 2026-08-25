import { describe, expect, it } from 'vitest'
import { resolveOpenAIEndpoint } from './openAIEndpoint'

describe('resolveOpenAIEndpoint', () => {
  it('recognizes roots, v1 bases and complete endpoints', () => {
    expect(resolveOpenAIEndpoint('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions')
    expect(resolveOpenAIEndpoint('https://example.com/v1')).toBe('https://example.com/v1/chat/completions')
    expect(resolveOpenAIEndpoint('https://example.com/custom', 'api_root')).toBe('https://example.com/custom/v1/chat/completions')
  })

  it('preserves complete endpoint query parameters and permits local http', () => {
    expect(resolveOpenAIEndpoint('https://azure.example/openai/chat/completions?api-version=1', 'full_endpoint'))
      .toBe('https://azure.example/openai/chat/completions?api-version=1')
    expect(resolveOpenAIEndpoint('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  it('rejects unsafe and incomplete explicit endpoints', () => {
    expect(() => resolveOpenAIEndpoint('http://example.com/v1')).toThrow('HTTPS')
    expect(() => resolveOpenAIEndpoint('https://example.com/v1', 'full_endpoint')).toThrow('chat/completions')
  })
})
