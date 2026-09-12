import {
    extractFromFormattedOutput,
    extractFromGenerateToolCallResult,
    MVU_JSON_PATCH_RESPONSE_SCHEMA,
    MVU_TOOL_DEFINITION,
} from '@/function/function_call';
import { MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION } from '@/function/is_function_calling_supported';
import claude_head from '@/prompts/claude_head.txt?raw';
import claude_tail from '@/prompts/claude_tail.txt?raw';
import extra_model_task from '@/prompts/extra_model_task.txt?raw';
import gemini_head from '@/prompts/gemini_head.txt?raw';
import gemini_tail from '@/prompts/gemini_tail.txt?raw';
import {
    buildOtherPresetGenerateConfig,
    getExtraModelPreset,
} from '@/function/update/extra_model_preset';
import {
    clearExtraModelRequestOverrides,
    setExtraModelRequestOverrides,
} from '@/function/request/extra_model_request_override';
import {
    registerWorldinfoRequest,
    withWorldinfoRequestMarker,
} from '@/function/request/worldinfo_request';
import {
    beginPiRequestAttempt,
    isPiRequestAbortedError,
    PiRequestAbortedError,
    stopExtraModelRequestById,
    stopPiRequestById,
} from '@/function/update/pi/controller_registry';
import { localizePiError } from '@/function/update/pi/error_localization';
import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';
import {
    captureGeneratePrompt,
    captureGenerateRawPrompt,
    type CapturedPrompt,
    type PromptCaptureOptions,
} from '@/function/update/pi/prompt_capture';
import type { PiExtraModelSettings, PiRuntimePreflight } from '@/function/update/pi/runtime';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { normalizeBaseURL } from '@/util';
import { literalYamlify, uuidv4 } from '@util/common';
import { compare } from 'compare-versions';
import { klona } from 'klona';
import YAML from 'yaml';

//测试用，为了使首次请求必失败
let debug_extra_request_counter = 0;

const V4_COMPATIBLE_FORMATTED_OUTPUT = '格式化输出(v4兼容)';
const MIN_CUSTOM_API_BODY_TAVERN_HELPER_VERSION = '4.8.13';
const JSON_OBJECT_CUSTOM_INCLUDE_BODY = Object.freeze({
    response_format: {
        type: 'json_object',
    },
});
const DISABLED_THINKING_CUSTOM_INCLUDE_BODY = Object.freeze({
    thinking: {
        type: 'disabled',
    },
});

type PiRuntimeModule = typeof import('@/function/update/pi/runtime');

let pi_runtime_module: Promise<PiRuntimeModule> | undefined;

/** 按需加载 Pi 运行时，并复用模块加载结果。 */
function loadPiRuntime(): Promise<PiRuntimeModule> {
    pi_runtime_module ??= import(/* webpackMode: "eager" */ '@/function/update/pi/runtime');
    return pi_runtime_module;
}

/** 创建统一的 Pi 应答协议错误，避免将不合规的模型输出直接展示给用户。 */
async function createPiProtocolError(): Promise<Error> {
    const { PiRuntimeError } = await loadPiRuntime();
    return new PiRuntimeError('protocol', tr('runtime.pi.protocolError'));
}

function generateRandomHeader(): string {
    return _.times(4, () => uuidv4().slice(0, 8)).join('\n');
}

function isV4CompatibleFormattedOutput(): boolean {
    return useDataStore().settings.额外模型解析配置.应答格式 === V4_COMPATIBLE_FORMATTED_OUTPUT;
}

function supportsCustomApiBody(): boolean {
    const version = useDataStore().versions.tavernhelper;
    return version !== '' && compare(version, MIN_CUSTOM_API_BODY_TAVERN_HELPER_VERSION, '>=');
}

function supportsRequestScopedTools(): boolean {
    const version = useDataStore().versions.tavernhelper;
    return version !== '' && compare(version, MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION, '>=');
}

/** 为 Pi 批次复制设置快照，避免面板编辑改变重试语义；旧来源保留原有设置读取方式。 */
function getRequestSettings(): PiExtraModelSettings {
    const config = useDataStore().settings.额外模型解析配置;
    // Pi 的提示词、应答格式和凭证属于同一批次；当前批次重试时也使用原快照。
    return config.模型来源 === '更多' ? klona(config) : config;
}

/** 在进入重试策略前完成 Pi 配置预检，使固定配置错误只报告一次。 */
async function preparePiRuntimePreflight(
    config: PiExtraModelSettings
): Promise<PiRuntimePreflight | undefined> {
    if (config.模型来源 !== '更多') {
        return undefined;
    }
    if (!isPiMultiproviderEnabled()) {
        throw new Error(tr('runtime.pi.featureDisabled'));
    }

    const { assertPiRuntimeConfiguration } = await loadPiRuntime();
    return assertPiRuntimeConfiguration({
        settings: config,
        responseFormat: config.应答格式,
        ...(config.应答格式 === '工具调用'
            ? { tools: [MVU_TOOL_DEFINITION], toolChoice: 'required' as const }
            : {}),
        ...(config.应答格式 === '格式化输出' ? { jsonSchema: MVU_JSON_PATCH_RESPONSE_SCHEMA } : {}),
    });
}

/** 从失败结果中识别应立即终止的 Pi 错误，供串行和并发策略共同使用。 */
async function getNonRetryablePiError(error: unknown): Promise<unknown | undefined> {
    const { isNonRetryablePiRuntimeError } = await loadPiRuntime();
    const errors = error instanceof AggregateError ? error.errors : [error];
    return errors.find(isNonRetryablePiRuntimeError);
}

function assertV4CompatibleFormattedOutputUsable() {
    const store = useDataStore();
    if (
        store.settings.额外模型解析配置.应答格式 === V4_COMPATIBLE_FORMATTED_OUTPUT &&
        store.settings.额外模型解析配置.模型来源 === '与插头相同'
    ) {
        throw new Error(tr('runtime.extraModel.v4RequiresCustomSource'));
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCustomIncludeBody(body: unknown): Record<string, unknown> {
    if (typeof body !== 'string' || body.trim() === '') {
        return {};
    }

    const parsed = YAML.parse(body);
    if (isPlainObject(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed)) {
        return Object.assign({}, ...parsed.filter(isPlainObject));
    }
    throw new Error(tr('runtime.extraModel.customIncludeBodyInvalid'));
}

function buildJsonObjectCustomIncludeBody(original_body: unknown): Record<string, unknown> {
    const store = useDataStore();
    return {
        ...parseCustomIncludeBody(original_body),
        ...JSON_OBJECT_CUSTOM_INCLUDE_BODY,
        ...(store.settings.额外模型解析配置.关闭thinking
            ? DISABLED_THINKING_CUSTOM_INCLUDE_BODY
            : {}),
    };
}

async function saveSillyTavernSettings() {
    const save_settings =
        typeof builtin === 'undefined' ? undefined : builtin.saveSettings.bind(builtin);
    if (typeof save_settings !== 'function') {
        throw new Error(tr('runtime.extraModel.saveSettingsUnavailable'));
    }
    await save_settings();
}

let temporary_json_object_response_format_state: {
    had_original_body: boolean;
    original_body: unknown;
} | null = null;

/** 为旧生成链路临时设置 JSON 对象应答格式，并通过清理机制恢复。 */
async function setTemporaryJsonObjectResponseFormat() {
    if (
        useDataStore().settings.额外模型解析配置.模型来源 !== '自定义' ||
        !isV4CompatibleFormattedOutput() ||
        supportsCustomApiBody()
    ) {
        temporary_json_object_response_format_state = null;
        return;
    }

    assertV4CompatibleFormattedOutputUsable();
    const oai_settings = SillyTavern.chatCompletionSettings;
    if (!isPlainObject(oai_settings)) {
        throw new Error(tr('runtime.extraModel.openAiSettingsUnavailable'));
    }

    const had_original_body = Object.prototype.hasOwnProperty.call(
        oai_settings,
        'custom_include_body'
    );
    const original_body = oai_settings.custom_include_body;
    oai_settings.custom_include_body = YAML.stringify(
        buildJsonObjectCustomIncludeBody(original_body)
    ).trimEnd();
    try {
        await saveSillyTavernSettings();
        temporary_json_object_response_format_state = {
            had_original_body,
            original_body,
        };
    } catch (error) {
        if (had_original_body) {
            oai_settings.custom_include_body = original_body;
        } else {
            delete oai_settings.custom_include_body;
        }
        temporary_json_object_response_format_state = null;
        throw error;
    }
}

async function restoreTemporaryJsonObjectResponseFormat() {
    if (!temporary_json_object_response_format_state) {
        return;
    }

    const oai_settings = SillyTavern.chatCompletionSettings;
    if (!isPlainObject(oai_settings)) {
        throw new Error(tr('runtime.extraModel.openAiSettingsRestoreUnavailable'));
    }

    const { had_original_body, original_body } = temporary_json_object_response_format_state;
    temporary_json_object_response_format_state = null;
    if (had_original_body) {
        oai_settings.custom_include_body = original_body;
    } else {
        delete oai_settings.custom_include_body;
    }
    await saveSillyTavernSettings();
}

/** 将额外解析接入酒馆生成状态，协调发送按钮、停止按钮和生命周期事件。 */
async function setExtraAnalysisStates(is_pi_request = false) {
    const store = useDataStore();

    if (store.runtimes.is_during_extra_analysis === true) {
        //这个函数不应当被嵌套调用，因此直接报错
        throw new Error('setExtraAnalysisStates() should not be called recursively.');
    }

    //这里本来也应当初始化macro的，但是因为不知道具体内容，所以延迟到 RequestReply
    //因为这个操作是幂等的，所以无所谓。

    store.runtimes.is_during_extra_analysis = true;
    try {
        if (!is_pi_request) {
            await setTemporaryJsonObjectResponseFormat();
        }
    } catch (error) {
        store.runtimes.is_during_extra_analysis = false;
        throw error;
    }
}

async function unsetExtraAnalysisStates() {
    const store = useDataStore();

    SillyTavern.unregisterMacro('lastUserMessage');
    clearExtraModelRequestOverrides();
    store.runtimes.is_function_call_enabled = false;
    try {
        await restoreTemporaryJsonObjectResponseFormat();
    } finally {
        store.runtimes.is_during_extra_analysis = false;
    }
}

let is_analysis_in_progress = false;

/**
 * 根据串行或并发策略调用额外模型，统一管理请求状态、重试和停止操作。
 * Pi 设置预检与请求快照在策略开始前完成，取消及不可重试错误会终止后续尝试。
 */
export async function invokeExtraModelWithStrategy(): Promise<string | null> {
    const batch_id = generateRandomHeader();
    if (is_analysis_in_progress) {
        return null;
    }
    try {
        is_analysis_in_progress = true;
        const store = useDataStore();
        const request_settings = getRequestSettings();
        const pi_preflight = await preparePiRuntimePreflight(request_settings);
        let last_pi_error: unknown;
        let did_abort_pi_request = false;

        debug_extra_request_counter = 0;

        /** 执行并记录一次额外模型尝试，使错误处理和活动请求清理使用同一请求编号。 */
        const recordedInvoke = async (generation_id?: string, signal?: AbortSignal) => {
            try {
                return await invokeExtraModel(
                    generation_id,
                    batch_id,
                    pi_preflight,
                    request_settings,
                    signal
                );
            } catch (e) {
                if (signal?.aborted && !pi_preflight) throw e;
                const localized_error = localizePiError(e);
                console.error(localized_error);
                if (pi_preflight) {
                    if (isPiRequestAbortedError(localized_error)) {
                        did_abort_pi_request = true;
                    } else {
                        last_pi_error = localized_error;
                    }
                }
                throw localized_error;
            }
        };
        /** 尝试耗尽后保留 Pi 的具体失败原因；旧来源继续使用空结果表示失败。 */
        const throwLastPiErrorOrReturnNull = (): null => {
            if (pi_preflight && last_pi_error !== undefined) {
                throw last_pi_error;
            }
            return null;
        };
        /** 封装单次串行尝试，区分正常失败、主动取消和不可重试的 Pi 错误。 */
        const safeInvoke = async (): Promise<{
            result: string | null;
            is_manual_canceled: boolean;
        }> => {
            let is_manual_canceled = false;
            let did_set_extra_analysis_states = false;
            try {
                await setExtraAnalysisStates(pi_preflight !== undefined);
                did_set_extra_analysis_states = true;
                const generation_id = pi_preflight ? uuidv4() : undefined;
                return {
                    result: await recordedInvoke(generation_id),
                    is_manual_canceled: false,
                };
            } catch (e) {
                /** 已经记录, 忽略 */
                if (e === 'Clicked stop button' || isPiRequestAbortedError(e)) {
                    is_manual_canceled = true;
                } else if (pi_preflight && (await getNonRetryablePiError(e)) !== undefined) {
                    throw e;
                }
            } finally {
                if (did_set_extra_analysis_states) {
                    await unsetExtraAnalysisStates();
                }
            }
            return { result: null, is_manual_canceled: is_manual_canceled };
        };
        /** 协调同批并发尝试，接收有效结果并停止其余请求；致命错误立即结束整批执行。 */
        const concurrentInvoke = async (times: number) => {
            const uuids = _.times(times, uuidv4);
            const controller = new AbortController();
            let attempts: Promise<string>[] = [];
            let did_set_extra_analysis_states = false;
            try {
                await setExtraAnalysisStates(pi_preflight !== undefined);
                did_set_extra_analysis_states = true;
                attempts = uuids.map(id => recordedInvoke(id, controller.signal));
                //在函数调用的模式下，允许接受 **任意** 有效的函数结果，因此被允许被覆盖。
                return await Promise.any(attempts);
            } catch (e) {
                const non_retryable_error = pi_preflight
                    ? await getNonRetryablePiError(e)
                    : undefined;
                if (non_retryable_error !== undefined) {
                    throw non_retryable_error;
                }
                if (did_abort_pi_request) {
                    return null;
                }
                if (pi_preflight && last_pi_error !== undefined) {
                    throw last_pi_error;
                }
            } finally {
                // 先取消仍在等待世界书的调用，再停止助手和 Pi 中已启动的生成。
                controller.abort();
                uuids.forEach(generation_id => stopExtraModelRequestById(generation_id));
                await Promise.allSettled(attempts);
                if (did_set_extra_analysis_states) {
                    await unsetExtraAnalysisStates();
                }
            }
            return null;
        };

        switch (request_settings.请求方式) {
            case '依次请求，失败后重试':
                for (let i = 0; i < request_settings.请求次数; i++) {
                    if (store.settings.通知.额外模型解析中) {
                        toastr.info(
                            i === 0
                                ? tr('runtime.extraModel.requesting')
                                : tr('runtime.extraModel.retrying', {
                                      attempt: i,
                                      total: request_settings.请求次数 - 1,
                                  }),
                            tr('runtime.extraModel.updateInProgressTitle')
                        );
                    }
                    const { result, is_manual_canceled } = await safeInvoke();
                    if (result !== null) {
                        return result;
                    }
                    if (is_manual_canceled) {
                        //因为手动取消了，不再进行重试。
                        return null;
                    }
                }
                return throwLastPiErrorOrReturnNull();
            case '同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        tr('runtime.extraModel.concurrentRequests', {
                            count: request_settings.请求次数,
                        }),
                        tr('runtime.extraModel.updateInProgressTitle')
                    );
                }
                return await concurrentInvoke(request_settings.请求次数);
            case '先请求一次, 失败后再同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        tr('runtime.extraModel.firstRequest'),
                        tr('runtime.extraModel.updateInProgressTitle')
                    );
                }
                {
                    const { result, is_manual_canceled } = await safeInvoke();
                    if (result !== null) {
                        return result;
                    }
                    if (is_manual_canceled) {
                        //因为手动取消了，不再进行重试。
                        return null;
                    }
                }
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        tr('runtime.extraModel.firstRequestFailed', {
                            count: request_settings.请求次数 - 1,
                        }),
                        tr('runtime.extraModel.updateInProgressTitle')
                    );
                }
                return await concurrentInvoke(request_settings.请求次数 - 1);
            default:
                return throwLastPiErrorOrReturnNull();
        }
    } catch (error) {
        throw localizePiError(error);
    } finally {
        is_analysis_in_progress = false;
    }
}

/** 执行一次额外模型解析，按需建立生成状态，并在结束后恢复界面状态。 */
export async function generateExtraModel(): Promise<string | null> {
    let did_set_extra_analysis_states = false;
    const request_settings = getRequestSettings();
    try {
        await setExtraAnalysisStates(request_settings.模型来源 === '更多');
        did_set_extra_analysis_states = true;
        const pi_preflight = await preparePiRuntimePreflight(request_settings);
        const generation_id = pi_preflight ? uuidv4() : undefined;
        return await invokeExtraModel(generation_id, undefined, pi_preflight, request_settings);
    } catch (error) {
        throw localizePiError(error);
    } finally {
        if (did_set_extra_analysis_states) {
            await unsetExtraAnalysisStates();
        }
    }
}

/**
 * 执行一次内部解析，登记请求级世界书策略并验证变量更新块；由外层初始化生成状态。
 * Pi 尝试从世界书读取前登记，取消标记贯穿提示词捕获和实际请求，结束时统一释放。
 *
 * @param generation_id 本次生成编号；未指定时创建，与世界书识别和助手调用共用。
 * @param batch_id 同批请求共享的随机提示词头部。
 * @param pi_preflight 本次 Pi 请求的预检结果，旧来源不传入。
 * @param request_settings 世界书过滤与模型调用共用的本次配置快照。
 * @param signal 并发批次的取消信号，阻止登记较慢的调用在批次结束后启动生成。
 * @returns 包含有效更新命令的 UpdateVariable 文本块。
 */
async function invokeExtraModel(
    generation_id?: string,
    batch_id?: string,
    pi_preflight?: PiRuntimePreflight,
    request_settings = useDataStore().settings.额外模型解析配置,
    signal?: AbortSignal
): Promise<string> {
    generation_id ??= uuidv4();
    const pi_attempt =
        generation_id !== undefined && pi_preflight !== undefined
            ? beginPiRequestAttempt(generation_id)
            : undefined;
    let release_worldinfo_request: (() => void) | undefined;
    try {
        release_worldinfo_request = await registerWorldinfoRequest(
            generation_id,
            request_settings,
            pi_attempt?.signal ?? signal
        );
        signal?.throwIfAborted();
        pi_attempt?.signal.throwIfAborted();
        const result = await requestReply(
            generation_id,
            batch_id,
            pi_preflight,
            request_settings,
            pi_attempt?.signal
        );

        const tag = _([...result.matchAll(/<(update(?:variable)?|variableupdate)>/gi)]).last()?.[1];
        if (!tag) {
            if (pi_preflight) {
                throw await createPiProtocolError();
            }
            throw new Error(
                literalYamlify({
                    [tr('runtime.extraModel.updateTagMissing')]: result,
                })
            );
        }

        const start_index = result.lastIndexOf(`<${tag}>`);
        const end_index = result.indexOf(`</${tag}>`, start_index);
        const update_block = result.slice(
            start_index + 2 + tag.length,
            end_index === -1 ? undefined : end_index
        );

        const fn_call_match =
            /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(
                update_block
            );
        const json_patch_match = /json_?patch/i.test(update_block);
        if (fn_call_match || json_patch_match) {
            return `<UpdateVariable>${update_block}</UpdateVariable>`;
        }

        if (pi_preflight) {
            throw await createPiProtocolError();
        }
        throw new Error(
            literalYamlify({
                [tr('runtime.extraModel.updateCommandsInvalid')]: result,
            })
        );
    } catch (error) {
        if (pi_attempt?.signal.aborted && generation_id !== undefined) {
            throw new PiRequestAbortedError(generation_id, pi_attempt.signal.reason ?? error);
        }
        throw error;
    } finally {
        release_worldinfo_request?.();
        pi_attempt?.release();
    }
}

function decode(string: string) {
    const binary = atob(string);
    const percent = binary
        .split('')
        .map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('');
    return decodeURIComponent(percent);
}

const decoded_claude_head = decode(claude_head);
const decoded_gemini_head = decode(gemini_head);
const decoded_claude_tail = decode(claude_tail);
const decoded_gemini_tail = decode(gemini_tail);
const decoded_extra_model_task = decode(extra_model_task);

function isGenerateToolCallResult(
    result: string | GenerateToolCallResult
): result is GenerateToolCallResult {
    return typeof result === 'object' && result !== null && Array.isArray(result.tool_calls);
}

function normalizeGenerateResult(result: string | GenerateToolCallResult): string {
    if (!isGenerateToolCallResult(result)) {
        return result;
    }
    return extractFromGenerateToolCallResult(result) ?? result.content;
}

/** 将捕获完成的提示词交给 Pi，并在加载运行时后再次检查取消状态。 */
async function runCapturedPiPrompt(
    capture: CapturedPrompt,
    preflight: PiRuntimePreflight,
    signal?: AbortSignal
): Promise<string | GenerateToolCallResult> {
    const { runPiRequest } = await loadPiRuntime();
    signal?.throwIfAborted();
    return runPiRequest({
        preflight,
        messages: capture.messages,
        generationId: capture.generationId,
    });
}

/** 连接捕获完成与停止回调，让 Slash 提示词生成和 Pi 请求共用同一生命周期。 */
function piPromptCaptureOptions(
    preflight: PiRuntimePreflight,
    signal?: AbortSignal
): PromptCaptureOptions<string | GenerateToolCallResult> {
    return {
        onCaptured: capture => runCapturedPiPrompt(capture, preflight, signal),
        onStopped: stopPiRequestById,
    };
}

/** 沿用当前预设构造提示词；Pi 路径只捕获最终提示词，再由选定服务商执行。 */
async function executeGenerate(
    config: GenerateConfig,
    pi_preflight?: PiRuntimePreflight,
    pi_signal?: AbortSignal
): Promise<string | GenerateToolCallResult> {
    if (!pi_preflight) {
        return generate(config);
    }
    const capture = await captureGeneratePrompt(
        { ...config, should_silence: false },
        piPromptCaptureOptions(pi_preflight, pi_signal)
    );
    if (capture.result === undefined) {
        throw await createPiProtocolError();
    }
    return capture.result;
}

/** 按显式提示词顺序执行生成；Pi 路径接管捕获结果，不向酒馆主模型重复发送。 */
async function executeGenerateRaw(
    config: GenerateRawConfig,
    pi_preflight?: PiRuntimePreflight,
    pi_signal?: AbortSignal
): Promise<string | GenerateToolCallResult> {
    if (!pi_preflight) {
        return generateRaw(config);
    }
    const capture = await captureGenerateRawPrompt(
        { ...config, should_silence: false },
        piPromptCaptureOptions(pi_preflight, pi_signal)
    );
    if (capture.result === undefined) {
        throw await createPiProtocolError();
    }
    return capture.result;
}

/** 按请求的应答格式提取更新内容；严格模式下拒绝不符合格式的返回值。 */
function normalizeGenerateResultByResponseFormat(
    result: string | GenerateToolCallResult,
    response_format: string,
    fail_closed = false
): string {
    if (response_format === '格式化输出' || response_format === V4_COMPATIBLE_FORMATTED_OUTPUT) {
        const formatted = extractFromFormattedOutput(result);
        if (formatted) {
            return formatted;
        }
        if (fail_closed) {
            throw new Error(tr('runtime.pi.protocolError'));
        }
    }
    return normalizeGenerateResult(result);
}

/**
 * 按本轮设置快照组装预设、世界书、工具及应答格式，并分派到对应生成链路。
 * Pi 请求必须带有预检结果，不能回退到旧来源发送。
 */
async function requestReply(
    generation_id?: string,
    batch_id?: string,
    pi_preflight?: PiRuntimePreflight,
    request_settings = useDataStore().settings.额外模型解析配置,
    pi_signal?: AbortSignal
): Promise<string> {
    const store = useDataStore();
    const is_pi_request = pi_preflight !== undefined;
    if (request_settings.模型来源 === '更多' && !is_pi_request) {
        throw new Error(tr('runtime.pi.invalidConfig'));
    }
    const response_format = request_settings.应答格式;
    const is_v4_compatible_formatted_output = response_format === V4_COMPATIBLE_FORMATTED_OUTPUT;
    const supports_request_scoped_tools = !is_pi_request && supportsRequestScopedTools();

    if (!is_pi_request) {
        assertV4CompatibleFormattedOutputUsable();
    }

    const config: GenerateRawConfig = withWorldinfoRequestMarker({
        user_input: '遵循<must>指令',
        max_chat_history: request_settings.max_chat_history,
        should_stream: request_settings.兼容假流式,
        generation_id,
    });
    if (supports_request_scoped_tools) {
        config.tools = response_format === '工具调用' ? [MVU_TOOL_DEFINITION] : [];
    }
    if (!is_pi_request && request_settings.模型来源 === '自定义') {
        const unset_if_equal = (value: number, expected: number) =>
            compare(store.versions.tavernhelper, '4.3.9', '>=') && value === expected
                ? 'unset'
                : value;
        config.custom_api = {
            apiurl: normalizeBaseURL(store.settings.额外模型解析配置.api地址),
            key: store.settings.额外模型解析配置.密钥,
            model: store.settings.额外模型解析配置.模型名称,
            max_tokens: store.settings.额外模型解析配置.最大回复token数,
            temperature: unset_if_equal(store.settings.额外模型解析配置.温度, 1),
            frequency_penalty: unset_if_equal(store.settings.额外模型解析配置.频率惩罚, 0),
            presence_penalty: unset_if_equal(store.settings.额外模型解析配置.存在惩罚, 0),
            top_p: unset_if_equal(store.settings.额外模型解析配置.top_p, 1),
            top_k: unset_if_equal(store.settings.额外模型解析配置.top_k, 0),
        };
        if (is_v4_compatible_formatted_output) {
            config.custom_api.source = 'custom';
            if (supportsCustomApiBody()) {
                const oai_settings = SillyTavern.chatCompletionSettings;
                if (!isPlainObject(oai_settings)) {
                    throw new Error(tr('runtime.extraModel.openAiSettingsUnavailable'));
                }
                config.custom_api.custom_include_body = buildJsonObjectCustomIncludeBody(
                    oai_settings.custom_include_body
                );
            }
        }
    }

    let task = decoded_extra_model_task;
    if (response_format === '工具调用') {
        task += `\n use \`${MVU_TOOL_DEFINITION.function.name}\` tool to update variables.`;
        if (!is_pi_request) {
            store.runtimes.is_function_call_enabled = true;
            if (!supports_request_scoped_tools) {
                config.tools = [MVU_TOOL_DEFINITION];
            }
            config.tool_choice = 'required';
        }
    } else if (response_format === '格式化输出') {
        task +=
            '\n You are in formatted-output mode. Do not output <UpdateVariable> tags, markdown, or prose. Return only a JSON object matching the provided json_schema: {"analysis":"...","json_patch":[...]}. Put MVU JsonPatch dialect operations in `json_patch`.';
        if (!is_pi_request) {
            config.json_schema = MVU_JSON_PATCH_RESPONSE_SCHEMA;
        }
    } else if (is_v4_compatible_formatted_output) {
        task +=
            '\n You are in formatted-output mode. Do not output <UpdateVariable> tags, markdown, or prose. Return only a JSON object: {"analysis":"...","json_patch":[...]}. Put MVU JsonPatch dialect operations in `json_patch`. Return exactly one JSON object that conforms to this schema:' +
            JSON.stringify(MVU_JSON_PATCH_RESPONSE_SCHEMA.value);
    }

    //因为部分预设会用到 {{lastUserMessage}}，因此进行修正。
    //在重复注册的场合, ST 的行为会是覆盖老的，因此无所谓
    SillyTavern.registerMacro('lastUserMessage', () => {
        return task;
    });
    if (store.runtimes.debug.首次额外请求必失败 && debug_extra_request_counter === 0) {
        debug_extra_request_counter++;
        throw 'simulated exception';
    }

    if (request_settings.破限方案 === '使用当前预设') {
        clearExtraModelRequestOverrides();
        const result = await executeGenerate(
            {
                ...config,
                injects: [
                    {
                        position: 'in_chat',
                        depth: 0,
                        should_scan: false,
                        role: 'system',
                        content: task,
                    },
                    {
                        position: 'in_chat',
                        depth: 2,
                        should_scan: false,
                        role: 'system',
                        content: '<past_observe>',
                    },
                    {
                        position: 'in_chat',
                        depth: 1,
                        should_scan: false,
                        role: 'system',
                        content: '</past_observe>',
                    },
                ],
            },
            pi_preflight,
            pi_signal
        );
        return normalizeGenerateResultByResponseFormat(result, response_format, is_pi_request);
    }

    if (request_settings.破限方案 === '使用其他预设') {
        const preset = getExtraModelPreset(request_settings.其他预设名称);
        const { ordered_prompts, injects, request_overrides } = buildOtherPresetGenerateConfig(
            preset,
            task
        );

        if (!is_pi_request && request_settings.模型来源 === '与插头相同') {
            setExtraModelRequestOverrides(request_overrides);
        } else {
            clearExtraModelRequestOverrides();
        }

        return normalizeGenerateResultByResponseFormat(
            await executeGenerateRaw(
                {
                    ...config,
                    injects,
                    ordered_prompts,
                },
                pi_preflight,
                pi_signal
            ),
            response_format,
            is_pi_request
        );
    }

    clearExtraModelRequestOverrides();
    const model_name = is_pi_request
        ? request_settings.pi.model
        : request_settings.模型来源 === '与插头相同'
          ? SillyTavern.getChatCompletionModel()
          : store.settings.额外模型解析配置.模型名称;
    const is_gemini = model_name.toLowerCase().includes('gemini');
    const rnd_header_prompts =
        request_settings.随机头部 && is_gemini
            ? [{ role: 'system' as const, content: batch_id ?? generateRandomHeader() }]
            : [];

    const result = await executeGenerateRaw(
        {
            ...config,
            ordered_prompts: [
                ...rnd_header_prompts,
                {
                    role: 'system',
                    content: is_gemini ? decoded_gemini_head : decoded_claude_head,
                },
                { role: 'system', content: '<additional_information>' },
                'persona_description',
                'char_description',
                'world_info_before',
                'world_info_after',
                { role: 'system', content: '</additional_information>' },
                { role: 'system', content: '<past_observe>' },
                'chat_history',
                { role: 'system', content: '</past_observe>' },
                { role: 'system', content: task },
                'user_input',
                {
                    role: 'system',
                    content: is_gemini ? decoded_gemini_tail : decoded_claude_tail,
                },
            ],
        },
        pi_preflight,
        pi_signal
    );
    return normalizeGenerateResultByResponseFormat(result, response_format, is_pi_request);
}
