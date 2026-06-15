import { sha1 } from '@/core/utils/sha1';

describe('sha1', () => {
  it('matches known SHA1 vectors', () => {
    expect(sha1('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1('The quick brown fox jumps over the lazy dog')).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
  });

  it('produces the correct Vincario checksum for the test VIN', () => {
    // Verified against Node.js crypto.createHash('sha1')
    const input = '8AGEA76C0RR117525|decode|05ea92384252|919fbf9794';
    expect(sha1(input).substring(0, 10)).toBe('1b0563293e');
  });
});
