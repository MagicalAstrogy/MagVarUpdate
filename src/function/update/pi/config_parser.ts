import type { ProviderHeaders } from '@earendil-works/pi-ai';
import YAML from 'yaml';

function parseYaml(value: string, label: string): unknown {
    if (!value.trim()) {
        return undefined;
    }
    try {
        return YAML.parse(value);
    } catch {
        throw new Error(`Pi ${label} is not valid YAML or JSON`);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePiCustomHeaders(value: string): ProviderHeaders | undefined {
    const parsed = parseYaml(value, 'customHeaders');
    if (parsed === undefined) {
        return undefined;
    }
    if (!isPlainObject(parsed)) {
        throw new Error('Pi customHeaders must be an object');
    }
    const headers: ProviderHeaders = {};
    for (const [name, header_value] of Object.entries(parsed)) {
        if (!name.trim() || (typeof header_value !== 'string' && header_value !== null)) {
            throw new Error('Pi customHeaders values must be strings or null');
        }
        if (/^(authorization|proxy-authorization|x-api-key|x-goog-api-key)$/i.test(name)) {
            throw new Error(`Pi customHeaders cannot override authentication header '${name}'`);
        }
        headers[name] = header_value;
    }
    return headers;
}

export function parsePiCustomIncludeBody(value: string): Record<string, unknown> | undefined {
    const parsed = parseYaml(value, 'customIncludeBody');
    if (parsed === undefined) {
        return undefined;
    }
    if (!isPlainObject(parsed)) {
        throw new Error('Pi customIncludeBody must be an object');
    }
    return parsed;
}

export function parsePiCustomExcludeBody(value: string): string[] | undefined {
    const parsed = parseYaml(value, 'customExcludeBody');
    if (parsed === undefined) {
        return undefined;
    }
    const fields =
        typeof parsed === 'string'
            ? parsed
                  .split(/[\n,]/)
                  .map(item => item.trim())
                  .filter(Boolean)
            : parsed;
    if (
        !Array.isArray(fields) ||
        fields.some(field => typeof field !== 'string' || !field.trim())
    ) {
        throw new Error('Pi customExcludeBody must be an array of field names');
    }
    return [...new Set(fields.map(field => field.trim()))];
}
