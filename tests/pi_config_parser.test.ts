/**
 * 测试场景：验证自定义请求头和正文增删字段的 YAML/JSON 解析、空配置以及受保护认证字段限制。
 */
import {
    parsePiCustomExcludeBody,
    parsePiCustomHeaders,
    parsePiCustomIncludeBody,
} from '@/function/update/pi/config_parser';

// 配置解析：允许规定形状的覆盖值，拒绝错误类型及认证头覆盖，空输入保持未配置。
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
        expect(() => parsePiCustomHeaders('" Authorization ": secret')).toThrow(
            'cannot override authentication header'
        );
        expect(() => parsePiCustomHeaders('" Proxy-Authorization ": secret')).toThrow(
            'cannot override authentication header'
        );
        expect(parsePiCustomHeaders('" X-Trace ": request-2')).toEqual({
            'X-Trace': 'request-2',
        });
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
