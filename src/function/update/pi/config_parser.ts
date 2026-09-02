import type { ProviderHeaders } from '@earendil-works/pi-ai';
import YAML from 'yaml';

function parseYaml(value: string, label: string): unknown {
    if (!value.trim()) {
        return undefined;
    }
    try {
        return YAML.parse(value);
    } catch {
        throw new Error(`More source ${label} is not valid YAML or JSON`);
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
        throw new Error('More source customHeaders must be an object');
    }
    const headers: ProviderHeaders = {};
    for (const [name, header_value] of Object.entries(parsed)) {
        const normalized_name = name.trim();
        if (!normalized_name || (typeof header_value !== 'string' && header_value !== null)) {
            throw new Error('More source customHeaders values must be strings or null');
        }
        if (
            /^(authorization|proxy-authorization|x-api-key|x-goog-api-key)$/i.test(normalized_name)
        ) {
            throw new Error(
                `More source customHeaders cannot override authentication header '${normalized_name}'`
            );
        }
        headers[normalized_name] = header_value;
    }
    return headers;
}

export function parsePiCustomIncludeBody(value: string): Record<string, unknown> | undefined {
    const parsed = parseYaml(value, 'customIncludeBody');
    if (parsed === undefined) {
        return undefined;
    }
    if (!isPlainObject(parsed)) {
        throw new Error('More source customIncludeBody must be an object');
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
        throw new Error('More source customExcludeBody must be an array of field names');
    }
    return [...new Set(fields.map(field => field.trim()))];
}
