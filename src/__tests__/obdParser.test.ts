import { parsePidResponse, isErrorResponse } from '@/core/utils/obdParser';

describe('isErrorResponse', () => {
  it('detects NODATA', () => {
    expect(isErrorResponse('NODATA')).toBe(true);
    expect(isErrorResponse('NO DATA')).toBe(true);
  });

  it('detects ERROR', () => {
    expect(isErrorResponse('ERROR')).toBe(true);
  });

  it('detects UNABLE TO CONNECT', () => {
    expect(isErrorResponse('UNABLE TO CONNECT')).toBe(true);
  });

  it('returns false for valid hex responses', () => {
    expect(isErrorResponse('41 0C 1A F8')).toBe(false);
    expect(isErrorResponse('41 0D 3C')).toBe(false);
  });
});

describe('parsePidResponse — RPM', () => {
  // Formula: ((A*256)+B)/4
  // Bytes: 1A=26, F8=248 → (26*256+248)/4 = (6656+248)/4 = 6904/4 = 1726
  it('parses a normal RPM response', () => {
    expect(parsePidResponse('RPM', '41 0C 1A F8')).toBe(1726);
  });

  // Idle RPM: 0B=11, 50=80 → (11*256+80)/4 = (2816+80)/4 = 2896/4 = 724
  it('parses idle RPM', () => {
    expect(parsePidResponse('RPM', '41 0C 0B 50')).toBe(724);
  });

  it('throws on NODATA response', () => {
    expect(() => parsePidResponse('RPM', 'NODATA')).toThrow();
  });
});

describe('parsePidResponse — SPEED', () => {
  // Formula: A → km/h
  // 0x3C = 60 km/h
  it('parses 60 km/h', () => {
    expect(parsePidResponse('SPEED', '41 0D 3C')).toBe(60);
  });

  it('parses 0 km/h (stopped)', () => {
    expect(parsePidResponse('SPEED', '41 0D 00')).toBe(0);
  });
});

describe('parsePidResponse — COOLANT_TEMP', () => {
  // Formula: A-40 → °C
  // 0x60 = 96 → 96-40 = 56°C
  it('parses normal coolant temp', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 60')).toBe(56);
  });

  // 0x8C = 140 → 140-40 = 100°C (alert threshold)
  it('parses threshold-level coolant temp (100°C)', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 8C')).toBe(100);
  });

  // 0x00 = 0 → 0-40 = -40°C (min)
  it('parses minimum coolant temp', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 00')).toBe(-40);
  });
});

describe('parsePidResponse — ENGINE_LOAD', () => {
  // Formula: A*100/255
  // 0xFF = 255 → 100%
  it('parses full load (100%)', () => {
    expect(parsePidResponse('ENGINE_LOAD', '41 04 FF')).toBe(100);
  });

  // 0x80 = 128 → 128*100/255 ≈ 50.2%
  it('parses ~50% load', () => {
    expect(parsePidResponse('ENGINE_LOAD', '41 04 80')).toBeCloseTo(50.2, 1);
  });
});

describe('parsePidResponse — MAF', () => {
  // Formula: ((A*256)+B)/100
  // 01=1, 90=144 → (1*256+144)/100 = 400/100 = 4.0 g/s
  it('parses MAF at idle', () => {
    expect(parsePidResponse('MAF', '41 10 01 90')).toBe(4);
  });
});

describe('parsePidResponse — VOLTAGE', () => {
  it('parses normal battery voltage string', () => {
    expect(parsePidResponse('VOLTAGE', '12.3V')).toBe(12.3);
    expect(parsePidResponse('VOLTAGE', '14.2V')).toBe(14.2);
  });

  it('parses voltage string without V suffix', () => {
    expect(parsePidResponse('VOLTAGE', '11.8')).toBe(11.8);
  });

  it('throws on non-numeric response', () => {
    expect(() => parsePidResponse('VOLTAGE', 'NODATA')).toThrow();
  });
});
