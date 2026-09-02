import { uuidv4 } from '@util/common';

export const PI_PROMPT_CAPTURE_MODEL_PREFIX = 'mvu-pi-prompt-capture:';
export const PI_PROMPT_CAPTURE_API_URL =
    'https://mvu-pi-prompt-capture.invalid/v1/chat/completions';

export type PromptCaptureDiagnostics = {
    generationId: string;
    marker: string;
    markerMatched: boolean;
    captured: boolean;
    stopSucceeded: boolean;
    captureError?: string;
};

export type PromptCaptureResult = PromptCaptureDiagnostics & {
    messages: SillyTavern.SendingMessage[];
};

type MutablePromptCaptureState = PromptCaptureDiagnostics & {
    messages?: SillyTavern.SendingMessage[];
};

type SettingsReadyData = {
    messages: SillyTavern.SendingMessage[];
    model: string;
    [key: string]: unknown;
};

type GenerateRunner<TConfig extends GenerateConfig> = (config: TConfig) => Promise<unknown>;

const pending_prompt_captures = new Map<string, MutablePromptCaptureState>();

export function encodePromptCaptureMarker(generation_id: string): string {
    if (generation_id.length === 0) {
        throw new Error('Prompt capture generation_id cannot be empty');
    }

    try {
        return `${PI_PROMPT_CAPTURE_MODEL_PREFIX}${encodeURIComponent(generation_id)}`;
    } catch (error) {
        throw new Error(`Prompt capture generation_id cannot be encoded: ${generation_id}`, {
            cause: error,
        });
    }
}

export function decodePromptCaptureMarker(model: unknown): string | null {
    if (typeof model !== 'string' || !model.startsWith(PI_PROMPT_CAPTURE_MODEL_PREFIX)) {
        return null;
    }

    const encoded_generation_id = model.slice(PI_PROMPT_CAPTURE_MODEL_PREFIX.length);
    if (encoded_generation_id.length === 0) {
        return null;
    }

    try {
        const generation_id = decodeURIComponent(encoded_generation_id);
        if (
            generation_id.length === 0 ||
            encodeURIComponent(generation_id) !== encoded_generation_id
        ) {
            return null;
        }
        return generation_id;
    } catch {
        return null;
    }
}

export function buildPromptCaptureConfig<TConfig extends GenerateConfig>(
    config: TConfig,
    generation_id: string
): TConfig {
    const marker = encodePromptCaptureMarker(generation_id);

    return {
        ...config,
        generation_id,
        should_stream: false,
        should_silence: true,
        tools: [],
        tool_choice: 'none',
        json_schema: undefined,
        custom_api: {
            source: 'custom',
            apiurl: PI_PROMPT_CAPTURE_API_URL,
            key: '',
            model: marker,
            custom_include_body: {},
            custom_exclude_body: [],
            custom_include_headers: {},
        },
    } as TConfig;
}

export function getPendingPromptCaptureDiagnostics(): PromptCaptureDiagnostics[] {
    return Array.from(pending_prompt_captures.values(), state => ({
        generationId: state.generationId,
        marker: state.marker,
        markerMatched: state.markerMatched,
        captured: state.captured,
        stopSucceeded: state.stopSucceeded,
        ...(state.captureError === undefined ? {} : { captureError: state.captureError }),
    }));
}

function hasCompletedCapture(state: MutablePromptCaptureState): boolean {
    return state.markerMatched && state.captured && state.stopSucceeded;
}

function recordCaptureError(state: MutablePromptCaptureState, message: string): void {
    state.captureError ??= message;
}

export async function capturePrompt<TConfig extends GenerateConfig>(
    run: GenerateRunner<TConfig>,
    config: TConfig
): Promise<PromptCaptureResult> {
    const generation_id = config.generation_id || uuidv4();
    const marker = encodePromptCaptureMarker(generation_id);

    if (pending_prompt_captures.has(generation_id)) {
        throw new Error(`Prompt capture generation_id is already pending: ${generation_id}`);
    }

    const state: MutablePromptCaptureState = {
        generationId: generation_id,
        marker,
        markerMatched: false,
        captured: false,
        stopSucceeded: false,
    };
    const capture_config = buildPromptCaptureConfig(config, generation_id);

    const listener = (generate_data: SettingsReadyData) => {
        const event_generation_id = decodePromptCaptureMarker(generate_data?.model);
        if (
            event_generation_id !== generation_id ||
            pending_prompt_captures.get(event_generation_id) !== state
        ) {
            return;
        }

        state.markerMatched = true;
        if (state.captureError !== undefined || hasCompletedCapture(state)) {
            return;
        }
        if (!Array.isArray(generate_data.messages)) {
            recordCaptureError(
                state,
                `Prompt capture event has no messages array: ${generation_id}`
            );
            return;
        }

        try {
            state.messages = structuredClone(generate_data.messages);
        } catch {
            recordCaptureError(state, `Failed to clone prompt capture messages: ${generation_id}`);
            return;
        }
        state.captured = true;
        try {
            state.stopSucceeded = stopGenerationById(generation_id);
        } catch {
            recordCaptureError(state, `Failed to stop prompt capture generation: ${generation_id}`);
            return;
        }
        if (!state.stopSucceeded) {
            recordCaptureError(state, `Failed to stop prompt capture generation: ${generation_id}`);
        }
    };

    let subscription: { stop: () => void } | undefined;
    pending_prompt_captures.set(generation_id, state);

    try {
        subscription = eventMakeLast(tavern_events.CHAT_COMPLETION_SETTINGS_READY, listener);

        let runner_failed = false;
        let runner_error: unknown;
        try {
            await run(capture_config);
        } catch (error) {
            runner_failed = true;
            runner_error = error;
        }

        if (state.captureError !== undefined) {
            throw new Error(state.captureError);
        }
        if (runner_failed && !hasCompletedCapture(state)) {
            throw runner_error;
        }

        if (!hasCompletedCapture(state) || state.messages === undefined) {
            throw new Error(`Generation ended without a captured prompt: ${generation_id}`);
        }

        return {
            generationId: state.generationId,
            marker: state.marker,
            markerMatched: state.markerMatched,
            captured: state.captured,
            stopSucceeded: state.stopSucceeded,
            messages: state.messages,
        };
    } finally {
        try {
            subscription?.stop();
        } finally {
            try {
                // Slash-Runner 4.9.1's EventOnReturn.stop() cannot reliably remove
                // its wrapped listener, so always remove the original listener too.
                eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, listener);
            } finally {
                if (pending_prompt_captures.get(generation_id) === state) {
                    pending_prompt_captures.delete(generation_id);
                }
            }
        }
    }
}

export function captureGeneratePrompt(config: GenerateConfig): Promise<PromptCaptureResult> {
    return capturePrompt(generate, config);
}

export function captureGenerateRawPrompt(config: GenerateRawConfig): Promise<PromptCaptureResult> {
    return capturePrompt(generateRaw, config);
}
