import { describe, expect, it } from 'vitest'
import { baseWeight, sortWeight, vendorOf } from '../src/client/sort.ts'

describe('vendorOf', () => {
  it('extracts the vendor from a bare vendor/model id', () => {
    expect(vendorOf('ai21/jamba-large-1.7')).toBe('ai21')
    expect(vendorOf('anthropic/claude-sonnet-5')).toBe('anthropic')
    expect(vendorOf('amazon/nova-pro-v1')).toBe('amazon')
  })

  it('unwraps a gateway prefix to the real vendor', () => {
    expect(vendorOf('openrouter/anthropic/claude-sonnet')).toBe('anthropic')
    expect(vendorOf('openrouter/google/gemini-3.7-flash')).toBe('google')
    expect(vendorOf('openrouter/qwen/qwen3.8-27b')).toBe('qwen')
  })

  it('keeps the first segment for non-openrouter multi-segment ids', () => {
    expect(vendorOf('auto/best-coding')).toBe('auto')
    expect(vendorOf('tllm/openrouter_gpt_4_o')).toBe('tllm')
  })

  it('extracts the vendor prefix from a slash-free id', () => {
    expect(vendorOf('minimax-m3')).toBe('minimax')
    expect(vendorOf('glm-5.2')).toBe('glm')
    expect(vendorOf('kimi-k2.5')).toBe('kimi')
    expect(vendorOf('qwen3.6-flash')).toBe('qwen')
    expect(vendorOf('deepseek-v3.2')).toBe('deepseek')
  })
})

describe('sortWeight', () => {
  it('gives flagship vendors a base weight even without usage', () => {
    const deepseek = sortWeight('x', 'deepseek-v4-pro')
    const unknown = sortWeight('x', 'some-random-model')
    expect(deepseek).toBeGreaterThan(unknown)
  })

  it('baseWeight matches on the model id vendor prefix', () => {
    expect(baseWeight('x', 'anthropic/claude-sonnet')).toBeGreaterThanOrEqual(82)
    expect(baseWeight('x', 'minimax-m3')).toBe(72)
  })
})
