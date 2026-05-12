import { describe, expect, it } from 'vitest';
import { MUTATION_TYPES, validateMutationEnvelope } from './sync-contracts.js';

describe('sync contracts', () => {
  it('accepts a valid entry save mutation', () => {
    const result = validateMutationEnvelope({
      id: 'm1',
      type: MUTATION_TYPES.ENTRY_SAVE,
      payload: {
        isoDate: '2026-05-11',
        raw: 'Hello world'
      }
    });
    expect(result.ok).toBe(true);
    expect(result.mutation.type).toBe(MUTATION_TYPES.ENTRY_SAVE);
  });

  it('rejects invalid date payloads', () => {
    const result = validateMutationEnvelope({
      id: 'm2',
      type: MUTATION_TYPES.ENTRY_SAVE,
      payload: {
        isoDate: 'bad-date',
        raw: 'Hello world'
      }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown mutation types', () => {
    const result = validateMutationEnvelope({
      id: 'm3',
      type: 'unknown',
      payload: {}
    });
    expect(result.ok).toBe(false);
  });
});
