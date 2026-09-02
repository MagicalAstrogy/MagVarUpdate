import fs from 'node:fs';
import path from 'node:path';

function source(relative_path: string): string {
    return fs.readFileSync(path.join(process.cwd(), 'slash-runner', relative_path), 'utf8');
}

describe('Slash-Runner prompt capture baseline contract', () => {
    test('registers the request controller before prompt construction and stops it by id', () => {
        const generate_source = source('src/function/generate/index.ts');
        const controller_registration = generate_source.indexOf(
            'generationControllers.set(generationId'
        );
        const response_call = generate_source.indexOf('const result = await generateResponse(');
        const stop_start = generate_source.indexOf('export function stopGenerationById');
        const stop_end = generate_source.indexOf('/**', stop_start + 4);
        const stop_body = generate_source.slice(stop_start, stop_end);

        expect(controller_registration).toBeGreaterThan(-1);
        expect(response_call).toBeGreaterThan(controller_registration);
        expect(stop_body).toContain('generationControllers.get(id)');
        expect(stop_body).toContain('entry.abortController.abort(');
        expect(stop_body).toContain('return true');
    });

    test('passes the same AbortSignal to non-streaming fetch after settings-ready listeners', () => {
        const response_source = source('src/function/generate/responseGenerator.ts');
        const function_start = response_source.indexOf(
            'async function sendCustomApiRequestNonStreaming('
        );
        const function_end = response_source.indexOf('\nasync function ', function_start + 1);
        const body = response_source.slice(
            function_start,
            function_end === -1 ? undefined : function_end
        );
        const settings_ready = body.indexOf('CHAT_COMPLETION_SETTINGS_READY');
        const fetch_call = body.indexOf("fetch('/api/backends/chat-completions/generate'");

        expect(function_start).toBeGreaterThan(-1);
        expect(settings_ready).toBeGreaterThan(-1);
        expect(fetch_call).toBeGreaterThan(settings_ready);
        expect(body.slice(fetch_call, body.indexOf('});', fetch_call) + 3)).toMatch(/\bsignal\s*,/);
    });
});
