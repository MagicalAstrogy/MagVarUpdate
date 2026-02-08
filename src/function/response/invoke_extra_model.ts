import { MVU_FUNCTION_NAME, ToolCallBatches } from '@/function/request/function_call';
import claude_head from '@/prompts/claude_head.txt?raw';
import claude_tail from '@/prompts/claude_tail.txt?raw';
import extra_model_task from '@/prompts/extra_model_task.txt?raw';
import gemini_head from '@/prompts/gemini_head.txt?raw';
import gemini_tail from '@/prompts/gemini_tail.txt?raw';
import { useDataStore } from '@/store';
import { isJsonPatch, normalizeBaseURL } from '@/util';
import { literalYamlify, parseString, uuidv4 } from '@util/common';
import { compare } from 'compare-versions';

let collected_tool_calls: string | undefined = undefined;
let vanilla_parseToolCalls: any = null;
//测试用，为了使首次请求必失败
let debug_extra_request_counter = 0;

function generateRandomHeader(): string {
    return _.times(4, () => uuidv4().slice(0, 8)).join('\n');
}

function setExtraAnalysisStates() {
    const store = useDataStore();

    if (store.runtimes.is_during_extra_analysis === true) {
        //这个函数不应当被嵌套调用，因此直接报错
        throw new Error('setExtraAnalysisStates() should not be called recursively.');
    }

    //这里本来也应当初始化macro的，但是因为不知道具体内容，所以延迟到 RequestReply
    //因为这个操作是幂等的，所以无所谓。

    store.runtimes.is_during_extra_analysis = true;
    collected_tool_calls = undefined;

    if (store.settings.额外模型解析配置.使用函数调用) {
        vanilla_parseToolCalls = SillyTavern.ToolManager.parseToolCalls;
        const vanilla_bound = SillyTavern.ToolManager.parseToolCalls.bind(SillyTavern.ToolManager);
        SillyTavern.ToolManager.parseToolCalls = (tool_calls: any, parsed: any) => {
            vanilla_bound(tool_calls, parsed);
            //在concurrent 的场合，这个上下文只需要获取到 **任意** 一个有效的内容即可，不需要严格要求是请求所对应的那个。
            const extracted = extractFromToolCall(tool_calls as ToolCallBatches);
            if (extracted) {
                collected_tool_calls = extracted;
            }
        };
    }
}

function unsetExtraAnalysisStates() {
    const store = useDataStore();

    if (vanilla_parseToolCalls !== null) {
        SillyTavern.ToolManager.parseToolCalls = vanilla_parseToolCalls;
        vanilla_parseToolCalls = null;
    }
    SillyTavern.unregisterMacro('lastUserMessage');
    store.runtimes.is_during_extra_analysis = false;
    store.runtimes.is_function_call_enabled = false;
}

let is_analysis_inprogress = false;

export async function invokeExtraModelWithStrategy(): Promise<string | null> {
    const batch_id = generateRandomHeader();
    if (is_analysis_inprogress) {
        //考虑到在分析过程中误按的场景。
        toastr.error('已有在途的额外分析请求', '[MVU额外模型解析]变量更新失败');
        return null;
    }
    try {
        is_analysis_inprogress = true;
        const store = useDataStore();

        debug_extra_request_counter = 0;

        const recordedInvoke = async (generation_id?: string) => {
            try {
                return await invokeExtraModel(generation_id, batch_id);
            } catch (e) {
                console.error(e);
                throw e;
            }
        };
        const safeInvoke = async (): Promise<{
            result: string | null;
            is_manual_canceled: boolean;
        }> => {
            let is_manual_canceled = false;
            try {
                setExtraAnalysisStates();
                return { result: await recordedInvoke(), is_manual_canceled: false };
            } catch (e) {
                /** 已经记录, 忽略 */
                if (e === 'Clicked stop button') is_manual_canceled = true;
            } finally {
                unsetExtraAnalysisStates();
            }
            return { result: null, is_manual_canceled: is_manual_canceled };
        };
        const concurrentInvoke = async (times: number) => {
            const uuids = _.times(times, uuidv4);
            try {
                setExtraAnalysisStates();
                //在函数调用的模式下，允许接受 **任意** 有效的函数结果，因此被允许被覆盖。
                return await Promise.any(uuids.map(recordedInvoke));
            } catch (e) {
                /** 已经记录, 忽略 */
            } finally {
                uuids.forEach(stopGenerationById);
                unsetExtraAnalysisStates();
            }
            return null;
        };

        switch (store.settings.额外模型解析配置.请求方式) {
            case '依次请求，失败后重试':
                for (let i = 0; i < store.settings.额外模型解析配置.请求次数; i++) {
                    if (store.settings.通知.额外模型解析中) {
                        toastr.info(
                            `${i === 0 ? '' : ` 重试 ${i}/3`}`,
                            '[MVU额外模型解析]变量更新中'
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
                return null;
            case '同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(
                        `将同时请求 ${store.settings.额外模型解析配置.请求次数} 次AI回复以提高成功率...`,
                        '[MVU额外模型解析]变量更新中'
                    );
                }
                return concurrentInvoke(store.settings.额外模型解析配置.请求次数);
            case '先请求一次, 失败后再同时请求多次':
                if (store.settings.通知.额外模型解析中) {
                    toastr.info(`将先请求一次尝试是否能成功...`, '[MVU额外模型解析]变量更新中');
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
                        `首次请求失败, 将同时请求 ${store.settings.额外模型解析配置.请求次数 - 1} 次AI回复以提高成功率...`,
                        '[MVU额外模型解析]变量更新中'
                    );
                }
                return concurrentInvoke(store.settings.额外模型解析配置.请求次数 - 1);
        }
    } finally {
        is_analysis_inprogress = false;
    }
}

/**
 * @brief 调用额外模型解析，可能会抛出异常。
 */
export async function generateExtraModel(): Promise<string | null> {
    try {
        setExtraAnalysisStates();
        return await invokeExtraModel();
    } finally {
        unsetExtraAnalysisStates();
    }
}

// 在点击停止按钮时，会触发异常 `Clicked stop button`: string ,需要专门处理。
//仅内部使用，因为一部分状态的初始化是在外面执行的。
async function invokeExtraModel(generation_id?: string, batch_id?: string): Promise<string> {
    try {
        const direct_reply = await requestReply(generation_id, batch_id);
        // collected_tool_calls 依赖于 requestReply 的结果, 必须在之后
        const result = collected_tool_calls ?? direct_reply;

        // QUESTION: 是在这里直接返回整个结果, 还是返回处理后的结果

        const tag = _([...result.matchAll(/<(update(?:variable)?|variableupdate)>/gi)]).last()?.[1];
        if (!tag) {
            throw new Error(
                literalYamlify({
                    ['[MVU额外模型解析]没有能从回复中找到<UpdateVariable>标签']: result,
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

        throw new Error(
            literalYamlify({
                ['[MVU额外模型解析]从回复找到了<UpdateVariable>标签，但其内的更新命令无效']: result,
            })
        );
    } finally {
        /* empty */
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

async function requestReply(generation_id?: string, batch_id?: string): Promise<string> {
    const store = useDataStore();

    const config: GenerateRawConfig = {
        user_input: '遵循<must>指令',
        max_chat_history: 2,
        should_stream:
            store.settings.额外模型解析配置.兼容假流式 ||
            store.settings.额外模型解析配置.使用函数调用,
        generation_id,
    };
    if (store.settings.额外模型解析配置.模型来源 === '自定义') {
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
    }

    let task = decoded_extra_model_task;
    if (store.settings.额外模型解析配置.使用函数调用) {
        task += `\n use \`mvu_VariableUpdate\` tool to update variables.`;
        store.runtimes.is_function_call_enabled = true;
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

    if (store.settings.额外模型解析配置.破限方案 === '使用当前预设') {
        const result = generate({
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
        });
        return result;
    }

    const model_name =
        store.settings.额外模型解析配置.模型来源 === '与插头相同'
            ? SillyTavern.getChatCompletionModel()
            : store.settings.额外模型解析配置.模型名称;
    const is_gemini = model_name.toLowerCase().includes('gemini');

    const result = generateRaw({
        ...config,
        ordered_prompts: [
            { role: 'system', content: batch_id ?? generateRandomHeader() },
            { role: 'system', content: is_gemini ? decoded_gemini_head : decoded_claude_head },
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
            { role: 'system', content: is_gemini ? decoded_gemini_tail : decoded_claude_tail },
        ],
    });
    return result;
}

export function extractFromToolCall(tool_calls: ToolCallBatches | undefined): string | null {
    if (!tool_calls) {
        return null;
    }

    const tool_call = _.get(tool_calls as ToolCallBatches, '[0]');
    if (!tool_call) {
        return null;
    }

    const mvu_call = _(tool_call).findLast(fn => fn.function.name === MVU_FUNCTION_NAME);
    if (!mvu_call) {
        return null;
    }

    const content = _.get(mvu_call, 'function.arguments');
    if (!content) {
        return null;
    }

    try {
        const json = parseString(content);
        if (json.delta && json.delta.length > 5) {
            let result = '';
            result += `<UpdateVariable>\n`;
            result += `<Analyze>\n${json.analysis}\n</Analyze>\n`;
            //如果返回的内容中已包含 <JsonPatch> 块，则要求这里必须能被解释成有效的对象
            //否则需要在这里拒绝
            // 主要有两种情况， llm加了 <json_patch> 和没有加的情况，所以下面是try，解码错误的时候fallback一下。
            const json_patch_match = /json_?patch/i.test(json.delta);
            try {
                const parsed = parseString(
                    json.delta.replaceAll(/```.*/gm, '').replaceAll(/<\/?json_?patch>/gim, '')
                );
                if (!isJsonPatch(parsed)) {
                    throw new Error(`不是有效的 json patch`);
                }
                json.delta = JSON.stringify(parsed, null, 2);
                result += `<JSONPatch>\n${json.delta}\n</JSONPatch>\n`;
            } catch (error) {
                if (json_patch_match) {
                    console.error(
                        `[MVU额外模型解析]无法解析的变量更新块。 ${json.delta}, 错误 ${error}`
                    );
                    return null;
                }
                const fn_call_match =
                    /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(
                        json.delta
                    );
                //在错误路径上只可能是以往的变量更新语句，因此无效的场合需要拒绝。
                if (fn_call_match) {
                    result += `${json.delta}\n`;
                } else {
                    return null;
                }
            }
            result += `</UpdateVariable>`;
            return result;
        }
    } catch (e) {
        console.log(`[MVU额外模型解析]函数调用结果解析失败, ${e}`);
    }
    return null;
}
