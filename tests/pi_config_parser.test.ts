import {
    parsePiCustomExcludeBody,
    parsePiCustomHeaders,
    parsePiCustomIncludeBody,
} from '@/function/update/pi/config_parser';

describe('Pi custom request config parser', () => {
    test('parses headers without exposing authentication overrides', () => {
        expect(parsePiCustomHeaders('X-Trace: request-1\nX-Default: null')).toEqual({
            'X-Trace': 'request-1',
            'X-Default': null,
        });
        expect(() => parsePiCustomHeaders('Authorization: secret')).toThrow(
            'cannot override authentication header'
        );
        expect(() => parsePiCustomHeaders('X-Goog-Api-Key: secret')).toThrow(
            'cannot override authentication header'
        );
    });

    test('parses include and exclude payload fields', () => {
        expect(parsePiCustomIncludeBody('{service_tier: priority}')).toEqual({
            service_tier: 'priority',
        });
        expect(parsePiCustomExcludeBody('[metadata, user]')).toEqual(['metadata', 'user']);
        expect(parsePiCustomExcludeBody('metadata, user, metadata')).toEqual(['metadata', 'user']);
    });

    test('returns undefined for empty config and rejects wrong shapes safely', () => {
        expect(parsePiCustomHeaders('')).toBeUndefined();
        expect(parsePiCustomIncludeBody('')).toBeUndefined();
        expect(parsePiCustomExcludeBody('')).toBeUndefined();
        expect(() => parsePiCustomIncludeBody('[secret]')).toThrow('must be an object');
        expect(() => parsePiCustomHeaders('[')).toThrow('not valid YAML or JSON');
    });
});
