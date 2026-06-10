import { parseDtcResponse } from '@/core/utils/dtcParser';

describe('parseDtcResponse', () => {
  it('returns empty array when no DTCs stored (43 00)', () => {
    expect(parseDtcResponse('43 00 00 00 00 00 00')).toHaveLength(0);
  });

  it('returns empty array for malformed input', () => {
    expect(parseDtcResponse('NODATA')).toHaveLength(0);
    expect(parseDtcResponse('')).toHaveLength(0);
  });

  it('parses a single P0300 (random misfire)', () => {
    // P0300: high byte = 0x03 → system P (bits 00), code 0x0300
    // DTC bytes: 03 00
    const result = parseDtcResponse('43 01 03 00 00 00 00 00 00 00');
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('P0300');
    expect(result[0]?.system).toBe('P');
    expect(result[0]?.severity).toBe('critical');
  });

  it('parses a P0171 (system too lean)', () => {
    // P0171: 0x01 0x71
    const result = parseDtcResponse('43 01 01 71 00 00 00 00 00 00');
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('P0171');
    expect(result[0]?.description).toContain('Lean');
  });

  it('parses multiple DTCs', () => {
    // P0300 (03 00) and P0171 (01 71)
    const result = parseDtcResponse('43 02 03 00 01 71 00 00 00 00');
    expect(result).toHaveLength(2);
    const codes = result.map((d) => d.code);
    expect(codes).toContain('P0300');
    expect(codes).toContain('P0171');
  });

  it('skips 0000 placeholder bytes', () => {
    // Only one real DTC, rest are 00 00 padding
    const result = parseDtcResponse('43 01 03 00 00 00 00 00 00 00');
    expect(result).toHaveLength(1);
  });

  it('assigns critical severity to misfire codes (P03xx)', () => {
    const result = parseDtcResponse('43 01 03 01 00 00 00 00 00 00');
    expect(result[0]?.severity).toBe('critical');
  });

  it('assigns warning severity to generic P0 codes outside critical ranges', () => {
    // P0420 — catalyst efficiency (not in critical range)
    const result = parseDtcResponse('43 01 04 20 00 00 00 00 00 00');
    expect(result[0]?.code).toBe('P0420');
    expect(result[0]?.severity).toBe('warning');
  });

  it('provides a fallback description for unknown codes', () => {
    // P0999 — not in the built-in table
    const result = parseDtcResponse('43 01 09 99 00 00 00 00 00 00');
    expect(result[0]?.description).toContain('diagnosis required');
  });
});
