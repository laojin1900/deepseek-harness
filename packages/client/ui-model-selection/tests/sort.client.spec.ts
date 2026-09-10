import { describe, expect, it } from 'vitest'
import { baseWeight, groupByVendor, sortWeight, vendorLabel, vendorOf } from '../src/client/sort.ts'

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

describe('groupByVendor', () => {
  it('buckets models by vendor and orders vendors by their top-model weight', () => {
    const models = [
      { id: 'minimax-m3', name: 'MiniMax-M3' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'deepseek-v3.2', name: 'DeepSeek-V3.2' },
      { id: 'kimi-k2.5', name: 'Kimi-K2.5' },
    ]
    const groups = groupByVendor('b-ai', models)
    expect(groups.map(group => group.vendor)).toEqual(['deepseek', 'kimi', 'glm', 'minimax'])
  })

  it('preserves per-vendor model order and returns one group for a single vendor', () => {
    const models = [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'glm-5.1', name: 'GLM-5.1' },
    ]
    const groups = groupByVendor('x', models)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.vendor).toBe('glm')
    expect(groups[0]!.models.map(model => model.id)).toEqual(['glm-5.2', 'glm-5.1'])
  })
})

describe('vendorLabel', () => {
  it('maps known vendor tokens to display names', () => {
    expect(vendorLabel('glm')).toBe('GLM')
    expect(vendorLabel('minimax')).toBe('MiniMax')
    expect(vendorLabel('xai')).toBe('xAI')
  })

  it('title-cases unknown vendors', () => {
    expect(vendorLabel('somevendor')).toBe('Somevendor')
  })
})
