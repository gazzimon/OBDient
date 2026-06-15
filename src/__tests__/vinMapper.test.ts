import { parseVinResponse } from '@/data/mappers/vin.mapper';

describe('parseVinResponse', () => {
  it('parses a clean single-line 0902 response', () => {
    // 49 02 01 + 17 hex bytes = "8AGEA76C0RR117525"
    const raw =
      '49 02 01 38 41 47 45 41 37 36 43 30 52 52 31 31 37 35 32 35';
    expect(parseVinResponse(raw)).toBe('8AGEA76C0RR117525');
  });

  it('parses a multi-frame response with ELM327 frame-line prefixes', () => {
    // ELM327 reassembles ISO 15765 frames and prefixes them with 0: 1: 2:
    const raw = [
      '0: 49 02 01 38 41 47',
      '1: 45 41 37 36 43 30 52',
      '2: 52 31 31 37 35 32 35',
    ].join('\r\n');
    expect(parseVinResponse(raw)).toBe('8AGEA76C0RR117525');
  });

  it('returns null when 49 02 header is missing', () => {
    expect(parseVinResponse('NO DATA')).toBeNull();
    expect(parseVinResponse('')).toBeNull();
  });

  it('returns null when VIN contains invalid characters (I, O, Q)', () => {
    // Replace one byte with 'I' (0x49 happens to be valid hex but 'I' is banned in VINs)
    const raw = '49 02 01 49 49 51 4F 41 37 36 43 30 52 52 31 31 37 35 32 35';
    expect(parseVinResponse(raw)).toBeNull();
  });

  it('returns null when fewer than 17 VIN bytes follow the header', () => {
    const raw = '49 02 01 38 41 47'; // only 3 bytes after header
    expect(parseVinResponse(raw)).toBeNull();
  });
});
