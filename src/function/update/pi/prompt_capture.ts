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

export type CapturedPrompt = {
    generationId: string;
    messages: SillyTavern.SendingMessage[];
};

export type PromptCaptureResult<T = undefined> = PromptCaptureDiagnostics &
    CapturedPrompt & {
        result?: T;
    };

export type PromptCaptureOptions<T> = {
    onCaptured: (prompt: CapturedPrompt) => Promise<T>;
    onStopped: (generation_id: string) => void;
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

/** 将非空生成编号编码为专用模型标记，用于从设置就绪事件中识别本次捕获。 */
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

/** 只接受可规范往返编码的捕获标记，普通模型名或畸形标记返回 null。 */
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

/**
 * 将生成配置转换为专用捕获请求，移除业务工具、Schema、凭证和自定义覆盖。
 * 请求指向固定无效地址，并应在最终提示词捕获后被停止，避免误发到主模型。
 */
export function buildPromptCaptureConfig<TConfig extends GenerateConfig>(
    config: TConfig,
    generation_id: string
): TConfig {
    const marker = encodePromptCaptureMarker(generation_id);

    return {
        ...config,
        generation_id,
        should_stream: false,
        should_silence: config.should_silence ?? true,
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

/** 返回进行中捕获的诊断快照，不暴露完整提示词内容。 */
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

/** 只有标记匹配、提示词复制成功且生成已停止，才认定捕获完整成功。 */
function hasCompletedCapture(state: MutablePromptCaptureState): boolean {
    return state.markerMatched && state.captured && state.stopSucceeded;
}

/** 只记录首次捕获失败原因，避免清理阶段覆盖最有用的错误。 */
function recordCaptureError(state: MutablePromptCaptureState, message: string): void {
    state.captureError ??= message;
}

/**
 * 在酒馆设置就绪事件的最后阶段复制最终提示词，并以生成编号隔离并发捕获。
 * 可等待 Pi 回调结束以维持原生停止按钮；随后停止占位请求，最终释放全部监听和登记。
 */
export async function capturePrompt<TConfig extends GenerateConfig, T = undefined>(
    run: GenerateRunner<TConfig>,
    config: TConfig,
    options?: PromptCaptureOptions<T>
): Promise<PromptCaptureResult<T>> {
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
    let captured_result: T | undefined;
    let callback_failed = false;
    let callback_error: unknown;
    let callback_started = false;
    let listening_for_stop = options !== undefined;
    /** 仅将当前生成编号的用户停止事件传给 Pi 回调，不影响其他并发请求。 */
    const stop_listener = (stopped_id?: string) => {
        if (listening_for_stop && stopped_id === generation_id) {
            options?.onStopped(generation_id);
        }
    };
    /** 关闭并移除停止监听，防止内部终止占位请求被误判为用户取消。 */
    const remove_stop_listener = () => {
        listening_for_stop = false;
        if (options) {
            eventRemoveListener(tavern_events.GENERATION_STOPPED, stop_listener);
        }
    };

    /** 匹配当前捕获标记后复制最终提示词，等待接管回调，再阻止占位请求进入酒馆后端。 */
    const listener = async (generate_data: SettingsReadyData) => {
        const event_generation_id = decodePromptCaptureMarker(generate_data?.model);
        if (
            event_generation_id !== generation_id ||
            pending_prompt_captures.get(event_generation_id) !== state
        ) {
            return;
        }

        state.markerMatched = true;
        if (state.captureError !== undefined || state.captured) {
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
        if (options) {
            callback_started = true;
            try {
                // Settings-ready listeners are awaited by Slash. Keep generation (and its
                // native Stop button) active until the provider request has settled.
                captured_result = await options.onCaptured({
                    generationId: generation_id,
                    messages: state.messages,
                });
            } catch (error) {
                callback_failed = true;
                callback_error = error;
            }
        }
        // This stop only prevents the fixed capture request from reaching ST's backend.
        // It must not be mistaken for a user cancellation of the successful Pi request.
        remove_stop_listener();
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
        if (options) {
            eventOn(tavern_events.GENERATION_STOPPED, stop_listener);
        }
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
        if (callback_failed) {
            throw callback_error;
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
            ...(callback_started ? { result: captured_result } : {}),
        };
    } finally {
        remove_stop_listener();
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

/** 使用当前预设的 generate 流程构造并捕获最终提示词。 */
export function captureGeneratePrompt<T = undefined>(
    config: GenerateConfig,
    options?: PromptCaptureOptions<T>
): Promise<PromptCaptureResult<T>> {
    return capturePrompt(generate, config, options);
}

/** 使用显式顺序的 generateRaw 流程构造并捕获最终提示词。 */
export function captureGenerateRawPrompt<T = undefined>(
    config: GenerateRawConfig,
    options?: PromptCaptureOptions<T>
): Promise<PromptCaptureResult<T>> {
    return capturePrompt(generateRaw, config, options);
}
