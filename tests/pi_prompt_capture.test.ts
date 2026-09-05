import {
    buildPromptCaptureConfig,
    captureGeneratePrompt,
    captureGenerateRawPrompt,
    capturePrompt,
    decodePromptCaptureMarker,
    encodePromptCaptureMarker,
    getPendingPromptCaptureDiagnostics,
    PI_PROMPT_CAPTURE_API_URL,
    PI_PROMPT_CAPTURE_MODEL_PREFIX,
} from '@/function/update/pi/prompt_capture';

const SETTINGS_READY_EVENT = 'chat_completion_settings_ready';
const event_make_last_mock = (globalThis as any).eventMakeLast as jest.Mock;
const eventEmit = (globalThis as any).eventEmit as jest.Mock;
const default_event_make_last_implementation = event_make_last_mock.getMockImplementation();

function settingsReadyData(config: GenerateConfig, messages: SillyTavern.SendingMessage[]) {
    return {
        model: config.custom_api?.model ?? '',
        messages,
    };
}

describe('pi prompt capture', () => {
    beforeEach(() => {
        event_make_last_mock.mockClear();
        event_make_last_mock.mockImplementation(default_event_make_last_implementation);
        ((globalThis as any).eventRemoveListener as jest.Mock).mockClear();
        ((globalThis as any).eventEmit as jest.Mock).mockClear();
        ((globalThis as any).eventOn as jest.Mock).mockClear();
        ((globalThis as any).stopGenerationById as jest.Mock).mockClear();
        ((globalThis as any).stopGenerationById as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        delete (globalThis as any).generate;
        delete (globalThis as any).generateRaw;
        expect(getPendingPromptCaptureDiagnostics()).toEqual([]);
    });

    test('round-trips canonical markers and rejects malformed markers', () => {
        const generation_id = 'request:/ with spaces/中文';
        const marker = encodePromptCaptureMarker(generation_id);

        expect(marker).toBe(
            `${PI_PROMPT_CAPTURE_MODEL_PREFIX}${encodeURIComponent(generation_id)}`
        );
        expect(decodePromptCaptureMarker(marker)).toBe(generation_id);
        expect(decodePromptCaptureMarker('ordinary-model')).toBeNull();
        expect(decodePromptCaptureMarker(42)).toBeNull();
        expect(decodePromptCaptureMarker(PI_PROMPT_CAPTURE_MODEL_PREFIX)).toBeNull();
        expect(decodePromptCaptureMarker(`${PI_PROMPT_CAPTURE_MODEL_PREFIX}%`)).toBeNull();
        expect(decodePromptCaptureMarker(`${PI_PROMPT_CAPTURE_MODEL_PREFIX}%61`)).toBeNull();
        expect(() => encodePromptCaptureMarker('')).toThrow('cannot be empty');
    });

    test('builds an isolated fixed custom request without mutating prompt-building fields', () => {
        const ordered_prompts: GenerateRawConfig['ordered_prompts'] = [
            'char_description',
            { role: 'user', content: 'keep me' },
        ];
        const original: GenerateRawConfig = {
            generation_id: 'old-id',
            user_input: 'hello',
            ordered_prompts,
            should_stream: true,
            should_silence: false,
            custom_api: {
                source: 'openai',
                apiurl: 'https://real.example/v1',
                key: 'real-secret',
                model: 'real-model',
                temperature: 0.7,
                custom_include_headers: { Authorization: 'Bearer real-secret' },
            },
            tools: [
                {
                    type: 'function',
                    function: { name: 'real_tool' },
                },
            ],
            tool_choice: 'required',
            json_schema: {
                name: 'real_schema',
                value: { type: 'object' },
            },
        };

        const result = buildPromptCaptureConfig(original, 'capture-id');

        expect(result).toEqual(
            expect.objectContaining({
                generation_id: 'capture-id',
                user_input: 'hello',
                ordered_prompts,
                should_stream: false,
                should_silence: false,
                tools: [],
                tool_choice: 'none',
                json_schema: undefined,
            })
        );
        expect(result.custom_api).toEqual({
            source: 'custom',
            apiurl: PI_PROMPT_CAPTURE_API_URL,
            key: '',
            model: encodePromptCaptureMarker('capture-id'),
            custom_include_body: {},
            custom_exclude_body: [],
            custom_include_headers: {},
        });
        expect(result.ordered_prompts).toBe(ordered_prompts);
        expect(original.custom_api).toEqual(
            expect.objectContaining({
                apiurl: 'https://real.example/v1',
                key: 'real-secret',
                model: 'real-model',
            })
        );
        expect(JSON.stringify(result)).not.toContain('real-secret');
        expect(JSON.stringify(result)).not.toContain('real-model');
        expect(JSON.stringify(result)).not.toContain('https://real.example');
    });

    test('registers last, captures the final deep clone, stops by id, and swallows the fixed failure', async () => {
        const source_messages: SillyTavern.SendingMessage[] = [
            { role: 'system', content: 'before filter' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'hello' },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:image/png;base64,AA==', detail: 'low' },
                    },
                ],
            },
        ];
        eventOn(SETTINGS_READY_EVENT, (data: any) => {
            data.messages[0].content = 'after filter';
        });

        const fixed_failure = { reason: 'aborted fetch' };
        const runner = jest.fn(async (config: GenerateRawConfig) => {
            expect(getPendingPromptCaptureDiagnostics()).toEqual([
                expect.objectContaining({
                    generationId: 'capture-one',
                    markerMatched: false,
                    captured: false,
                    stopSucceeded: false,
                }),
            ]);

            const generate_data = settingsReadyData(config, source_messages);
            await eventEmit(SETTINGS_READY_EVENT, generate_data);
            expect((globalThis as any).stopGenerationById).toHaveBeenCalledWith('capture-one');

            (generate_data.messages[0] as { content: string }).content = 'mutated afterwards';
            throw fixed_failure;
        });

        const result = await capturePrompt(runner, {
            generation_id: 'capture-one',
            user_input: 'prompt',
            ordered_prompts: ['user_input'],
        });

        expect(result).toEqual(
            expect.objectContaining({
                generationId: 'capture-one',
                marker: encodePromptCaptureMarker('capture-one'),
                markerMatched: true,
                captured: true,
                stopSucceeded: true,
            })
        );
        expect(result.messages[0].content).toBe('after filter');
        expect(result.messages[1]).toEqual(source_messages[1]);
        expect(event_make_last_mock).toHaveBeenCalledWith(
            SETTINGS_READY_EVENT,
            expect.any(Function)
        );
        expect(event_make_last_mock.mock.invocationCallOrder[0]).toBeLessThan(
            runner.mock.invocationCallOrder[0]
        );

        const subscription = event_make_last_mock.mock.results[0].value;
        expect(subscription.stop).toHaveBeenCalledTimes(1);
        expect((globalThis as any).eventRemoveListener).toHaveBeenCalledWith(
            SETTINGS_READY_EVENT,
            event_make_last_mock.mock.calls[0][1]
        );
    });

    test('uses a generated id consistently when the caller omits generation_id', async () => {
        const runner = jest.fn(async (config: GenerateConfig) => {
            expect(config.generation_id).toEqual(expect.any(String));
            expect(config.generation_id).not.toBe('');
            expect(decodePromptCaptureMarker(config.custom_api?.model)).toBe(config.generation_id);
            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [{ role: 'user', content: 'generated id' }])
            );
            throw new Error('fixed failure');
        });

        const result = await capturePrompt(runner, { user_input: 'hello' });

        expect(result.generationId).toBe((runner.mock.calls[0][0] as GenerateConfig).generation_id);
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledWith(result.generationId);
    });

    test('generate and generateRaw wrappers both use the request-scoped capture path', async () => {
        (globalThis as any).generate = jest.fn(async (config: GenerateConfig) => {
            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [{ role: 'system', content: 'generate' }])
            );
            throw new Error('fixed failure');
        });
        (globalThis as any).generateRaw = jest.fn(async (config: GenerateRawConfig) => {
            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [{ role: 'system', content: 'generateRaw' }])
            );
            throw new Error('fixed failure');
        });

        const generate_result = await captureGeneratePrompt({ generation_id: 'generate-id' });
        const raw_result = await captureGenerateRawPrompt({ generation_id: 'raw-id' });

        expect(generate_result.messages[0].content).toBe('generate');
        expect(raw_result.messages[0].content).toBe('generateRaw');
        expect((globalThis as any).generate).toHaveBeenCalledWith(
            expect.objectContaining({
                generation_id: 'generate-id',
                should_stream: false,
                should_silence: true,
            })
        );
        expect((globalThis as any).generateRaw).toHaveBeenCalledWith(
            expect.objectContaining({
                generation_id: 'raw-id',
                should_stream: false,
                should_silence: true,
            })
        );
        expect(event_make_last_mock).toHaveBeenCalledTimes(2);
    });

    test('isolates concurrent captures by marker and generation id', async () => {
        let started = 0;
        let release_barrier!: () => void;
        const barrier = new Promise<void>(resolve => {
            release_barrier = resolve;
        });

        const runner = jest.fn(async (config: GenerateRawConfig) => {
            started++;
            if (started === 2) {
                release_barrier();
            }
            await barrier;

            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [
                    { role: 'user', content: `messages-${config.generation_id}` },
                ])
            );
            throw new Error(`fixed-${config.generation_id}`);
        });

        const first = capturePrompt(runner, {
            generation_id: 'concurrent-one',
            ordered_prompts: ['user_input'],
        });
        const second = capturePrompt(runner, {
            generation_id: 'concurrent-two',
            ordered_prompts: ['user_input'],
        });

        const [first_result, second_result] = await Promise.all([first, second]);

        expect(first_result.messages).toEqual([
            { role: 'user', content: 'messages-concurrent-one' },
        ]);
        expect(second_result.messages).toEqual([
            { role: 'user', content: 'messages-concurrent-two' },
        ]);
        expect((globalThis as any).stopGenerationById.mock.calls).toEqual(
            expect.arrayContaining([['concurrent-one'], ['concurrent-two']])
        );
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledTimes(2);
    });

    test('rejects a duplicate pending generation id and cleans the original request', async () => {
        let reject_first!: (error: unknown) => void;
        const first_error = new Error('first request failed');
        const first_runner = jest.fn(
            () =>
                new Promise<never>((_resolve, reject) => {
                    reject_first = reject;
                })
        );

        const first_capture = capturePrompt(first_runner, {
            generation_id: 'duplicate-id',
        });
        expect(getPendingPromptCaptureDiagnostics()).toHaveLength(1);

        await expect(
            capturePrompt(jest.fn().mockResolvedValue('unused'), {
                generation_id: 'duplicate-id',
            })
        ).rejects.toThrow('already pending');

        reject_first(first_error);
        await expect(first_capture).rejects.toBe(first_error);
    });

    test.each([
        ['ordinary model', 'ordinary-model'],
        ['empty marker id', PI_PROMPT_CAPTURE_MODEL_PREFIX],
        ['malformed marker', `${PI_PROMPT_CAPTURE_MODEL_PREFIX}%`],
        ['another pending id', encodePromptCaptureMarker('someone-else')],
    ])('does not swallow a failure after an unmatched %s event', async (_case, model) => {
        const request_error = new Error('real request failure');
        const runner = jest.fn(async () => {
            await eventEmit(SETTINGS_READY_EVENT, {
                model,
                messages: [{ role: 'user', content: 'wrong request' }],
            });
            throw request_error;
        });

        await expect(capturePrompt(runner, { generation_id: 'expected-id' })).rejects.toBe(
            request_error
        );
        expect((globalThis as any).stopGenerationById).not.toHaveBeenCalled();
    });

    test('does not swallow prompt construction failures before the event', async () => {
        const construction_error = new Error('prompt construction failed');

        await expect(
            capturePrompt(jest.fn().mockRejectedValue(construction_error), {
                generation_id: 'construction-error',
            })
        ).rejects.toBe(construction_error);
        expect((globalThis as any).stopGenerationById).not.toHaveBeenCalled();
    });

    test('does not swallow a matching event when stopGenerationById returns false', async () => {
        ((globalThis as any).stopGenerationById as jest.Mock).mockReturnValue(false);
        const downstream_listener = jest.fn();
        const fixed_failure = new Error('fixed invalid-endpoint failure');
        const runner = jest.fn(async (config: GenerateConfig) => {
            eventOn(SETTINGS_READY_EVENT, downstream_listener);
            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [{ role: 'user', content: 'captured' }])
            );
            expect(downstream_listener).toHaveBeenCalledTimes(1);
            expect(getPendingPromptCaptureDiagnostics()).toEqual([
                expect.objectContaining({
                    generationId: 'stop-failed',
                    markerMatched: true,
                    captured: true,
                    stopSucceeded: false,
                    captureError: 'Failed to stop prompt capture generation: stop-failed',
                }),
            ]);
            throw fixed_failure;
        });

        const error = await capturePrompt(runner, { generation_id: 'stop-failed' }).catch(
            cause => cause
        );
        expect(error).toEqual(new Error('Failed to stop prompt capture generation: stop-failed'));
        expect(error).not.toBe(fixed_failure);
        expect(downstream_listener).toHaveBeenCalledTimes(1);
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledWith('stop-failed');
    });

    test('rejects a matching event without a messages array', async () => {
        const downstream_listener = jest.fn();
        const fixed_failure = new Error('fixed invalid-endpoint failure');
        const runner = jest.fn(async (config: GenerateConfig) => {
            eventOn(SETTINGS_READY_EVENT, downstream_listener);
            await eventEmit(SETTINGS_READY_EVENT, {
                model: config.custom_api?.model,
            });
            expect(downstream_listener).toHaveBeenCalledTimes(1);
            expect(getPendingPromptCaptureDiagnostics()).toEqual([
                expect.objectContaining({
                    generationId: 'missing-messages',
                    markerMatched: true,
                    captured: false,
                    stopSucceeded: false,
                    captureError: 'Prompt capture event has no messages array: missing-messages',
                }),
            ]);
            throw fixed_failure;
        });

        const error = await capturePrompt(runner, { generation_id: 'missing-messages' }).catch(
            cause => cause
        );
        expect(error).toEqual(
            new Error('Prompt capture event has no messages array: missing-messages')
        );
        expect(error).not.toBe(fixed_failure);
        expect(downstream_listener).toHaveBeenCalledTimes(1);
        expect((globalThis as any).stopGenerationById).not.toHaveBeenCalled();
    });

    test('explicitly removes the listener when the returned stop handle is broken', async () => {
        const broken_stop = jest.fn();
        event_make_last_mock.mockImplementation((event, handler) => {
            eventOn(event, handler);
            return { stop: broken_stop };
        });

        const runner = jest.fn(async (config: GenerateConfig) => {
            await eventEmit(
                SETTINGS_READY_EVENT,
                settingsReadyData(config, [{ role: 'user', content: 'captured once' }])
            );
            throw new Error('fixed failure');
        });

        await capturePrompt(runner, { generation_id: 'broken-handle' });
        expect(broken_stop).toHaveBeenCalledTimes(1);
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledTimes(1);

        await eventEmit(SETTINGS_READY_EVENT, {
            model: encodePromptCaptureMarker('broken-handle'),
            messages: [{ role: 'user', content: 'must be ignored after cleanup' }],
        });
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledTimes(1);
        expect((globalThis as any).eventRemoveListener).toHaveBeenCalledWith(
            SETTINGS_READY_EVENT,
            event_make_last_mock.mock.calls[0][1]
        );
    });
});
