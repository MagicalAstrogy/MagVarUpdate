import { normalizeBaseURL } from '@/normalize_base_url';

describe('normalizeBaseURL', () => {
    test('appends /v1 for legacy OpenAI-compatible base URLs', () => {
        expect(normalizeBaseURL('http://localhost:1234')).toBe('http://localhost:1234/v1');
        expect(normalizeBaseURL('https://api.example.com')).toBe('https://api.example.com/v1');
    });

    test('keeps URLs that already end with a version suffix', () => {
        expect(normalizeBaseURL('http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
        expect(normalizeBaseURL('https://ark.cn-beijing.volces.com/api/plan/v3')).toBe(
            'https://ark.cn-beijing.volces.com/api/plan/v3'
        );
        expect(normalizeBaseURL('https://ark.cn-beijing.volces.com/api/coding/v3')).toBe(
            'https://ark.cn-beijing.volces.com/api/coding/v3'
        );
        expect(normalizeBaseURL('https://ark.cn-beijing.volces.com/api/v3')).toBe(
            'https://ark.cn-beijing.volces.com/api/v3'
        );
    });

    test('strips /chat/completions before normalizing', () => {
        expect(
            normalizeBaseURL('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions')
        ).toBe('https://ark.cn-beijing.volces.com/api/plan/v3');
    });

    test('strips /models before normalizing', () => {
        expect(normalizeBaseURL('http://localhost:1234/v1/models')).toBe(
            'http://localhost:1234/v1'
        );
    });
});
