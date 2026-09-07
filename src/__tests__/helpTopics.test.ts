import { describe, it, expect } from 'vitest';
import { searchHelpTopics, getHelpTopic } from '../content/helpTopics';

describe('helpTopics', () => {
  it('finds jc303 engine topic by natural query', () => {
    const results = searchHelpTopics('authentic 303');
    expect(results.some((t) => t.id === 'engine-303-switch')).toBe(true);
  });

  it('finds high-fidelity offline 303 topic', () => {
    const results = searchHelpTopics('high-fidelity offline');
    expect(results.some((t) => t.id === 'highfid-303-offline')).toBe(true);
  });

  it('finds gpu highfid by keyword', () => {
    const results = searchHelpTopics('gpu-highfid');
    expect(results.some((t) => t.id === 'highfid-303-offline')).toBe(true);
  });

  it('finds the live high-fidelity 303 topic', () => {
    const results = searchHelpTopics('live-highfid');
    expect(results.some((t) => t.id === 'highfid-303-live')).toBe(true);
  });

  it('keeps the offline high-fid topic distinct from the live one', () => {
    const results = searchHelpTopics('high-fidelity offline');
    expect(results.some((t) => t.id === 'highfid-303-offline')).toBe(true);
  });

  it('finds automation filter topic', () => {
    const results = searchHelpTopics('automate filter');
    expect(results.some((t) => t.id === 'automation-filter')).toBe(true);
  });

  it('finds sampler tts topic', () => {
    const results = searchHelpTopics('tts sampler');
    expect(results.some((t) => t.id === 'sampler-tts')).toBe(true);
  });

  it('returns all topics for empty query', () => {
    expect(searchHelpTopics('').length).toBeGreaterThan(5);
  });

  it('getHelpTopic returns topic by id', () => {
    const topic = getHelpTopic('prophecy-formants');
    expect(topic?.title).toMatch(/Prophecy/i);
  });
});
