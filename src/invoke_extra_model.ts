import { compare } from 'compare-versions';
import { MVU_FUNCTION_NAME, ToolCallBatches } from './function_call';
import { useDataStore } from './store';
import { literalYamlify, parseString } from './util';
import { ExtraLLMRequestContent } from './variable_def';

export async function invokeExtraModelWithStrategy(): Promise<string | null> {
    const store = useDataStore();

    const recordedInvoke = async () => {
        try {
            return await invokeExtraModel();
        } catch (e) {
            console.error(e);
            throw e;
        }
    };
    const safeInvoke = async () => {
        try {
            return await recordedInvoke();
        } catch (e) {
            /** 已经记录, 忽略 */
        }
        return null;
    };

    for (let i = 0; i < store.settings.额外模型解析配置.请求次数; i++) {
        if (store.settings.通知.额外模型解析中) {
            toastr.info(`${i === 0 ? '' : ` 重试 ${i}/3`}`, '[MVU额外模型解析]变量更新中');
        }
        const result = await safeInvoke();
        if (result !== null) {
            return result;
        }
    }
    return null;
}

export async function invokeExtraModel(): Promise<string> {
    const store = useDataStore();

    store.runtimes.is_during_extra_analysis = true;

    let collected_tool_calls: ToolCallBatches | undefined = undefined;
    let vanilla_parseToolCalls: any = null;
    if (store.settings.额外模型解析配置.使用函数调用) {
        vanilla_parseToolCalls = SillyTavern.ToolManager.parseToolCalls;
        const vanilla_bound = SillyTavern.ToolManager.parseToolCalls.bind(SillyTavern.ToolManager);
        SillyTavern.ToolManager.parseToolCalls = (tool_calls: any, parsed: any) => {
            vanilla_bound(tool_calls, parsed);
            collected_tool_calls = tool_calls;
        };
    }

    try {
        const direct_reply = await requestReply();
        // collected_tool_calls 依赖于 requestReply 的结果, 必须在之后
        const tool_call_reply = extractFromToolCall(collected_tool_calls);

        const result = tool_call_reply ?? direct_reply;

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
        if (vanilla_parseToolCalls !== null) {
            SillyTavern.ToolManager.parseToolCalls = vanilla_parseToolCalls;
            vanilla_parseToolCalls = null;
        }
        SillyTavern.unregisterMacro('lastUserMessage');
        store.runtimes.is_during_extra_analysis = false;
        // generate 过程中会使得这个变量变为 false, 影响重试
        store.runtimes.is_extra_model_supported = true;
    }
}

async function requestReply(): Promise<string> {
    const store = useDataStore();

    const config: GenerateRawConfig = {
        user_input: '遵循<must>指令',
        max_chat_history: 2,
        should_stream: store.settings.额外模型解析配置.使用函数调用,
    };
    if (store.settings.额外模型解析配置.模型来源 === '自定义') {
        const unset_if_equal = (value: number, expected: number) =>
            compare(getTavernHelperVersion(), '4.3.9', '>=') && value === expected
                ? 'unset'
                : value;
        config.custom_api = {
            apiurl: store.settings.额外模型解析配置.api地址,
            key: store.settings.额外模型解析配置.密钥,
            model: store.settings.额外模型解析配置.模型名称,
            max_tokens: store.settings.额外模型解析配置.最大回复token数,
            temperature: unset_if_equal(store.settings.额外模型解析配置.温度, 1),
            frequency_penalty: unset_if_equal(store.settings.额外模型解析配置.频率惩罚, 0),
            presence_penalty: unset_if_equal(store.settings.额外模型解析配置.存在惩罚, 0),
            top_p: unset_if_equal(store.settings.额外模型解析配置.top_p, 1),
        };
    }

    let task = ExtraLLMRequestContent;
    if (store.settings.额外模型解析配置.使用函数调用) {
        task += `\n use \`mvu_VariableUpdate\` tool to update variables.`;
        store.runtimes.is_function_call_enabled = true;
    }

    //因为部分预设会用到 {{lastUserMessage}}，因此进行修正。
    SillyTavern.registerMacro('lastUserMessage', () => {
        return task;
    });

    if (store.settings.额外模型解析配置.发送预设) {
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
        store.runtimes.is_function_call_enabled = false;
        return result;
    }

    const result = generateRaw({
        ...config,
        ordered_prompts: [
            { role: 'system', content: '<additional_information>' },
            'world_info_before',
            'world_info_after',
            { role: 'system', content: '</additional_information>' },
            { role: 'system', content: '<past_observe>' },
            'chat_history',
            { role: 'system', content: '</past_observe>' },
            { role: 'system', content: task },
            'user_input',
        ],
    });
    store.runtimes.is_function_call_enabled = false;
    return result;
}

function extractFromToolCall(tool_calls: ToolCallBatches | undefined): string | null {
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
            try {
                parseString(json.delta.replaceAll(/```.*/gm, ''));
                result += `<JSONPatch>${json.delta}</JSONPatch>\n`;
            } catch (error) {
                result += `${json.delta}\n`;
            }
            result += `</UpdateVariable>`;
            return result;
        }
    } catch (e) {
        console.log(`[MVU额外模型解析]函数调用结果解析失败, ${e}`);
    }
    return null;
}
