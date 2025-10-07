import { getLastValidVariable, updateVariables } from '@/function';
import { useSettingsStore } from '@/settings';

/**
 * 最终的变量更新机制实际上是专门generate 一个新的请求，那个请求会通过 tool_call 直接更新变量。
 * 并不会直接在一条输出消息里面进行 tool_call，因为这种情况很可能 llm 直接无视你的tool call请求（auto/any）
 * 或者 tool call 请求直接把正文肘掉（required）
 * 如果想不肘正文，需要从外部输入格式强调才行，因此直接把 mvu 更新移动到函数调用中不现实。
 * 目前的折衷方式是在 generate 中触发函数调用，在这个情况下可以利用 required 肘掉正文的特性，来精简输出。
 */

const mvu_function_name = 'mvu_VariableUpdate';
const mvu_update_call_function_name = 'mvu_updateRound';
let is_function_call_enabled: boolean = false;

export function setFunctionCallEnabled(enabled: boolean) {
    is_function_call_enabled = enabled;
}

export function unregisterFunction() {
    SillyTavern.unregisterFunctionTool(mvu_function_name);
    SillyTavern.unregisterFunctionTool(mvu_update_call_function_name);
}

/*
async function _onStoryEndCall(_args: any): Promise<string> {
    const variables = await getLastValidVariable(getLastMessageId());
    const val = variables.stat_data;
    let content = ExtraLLMRequestContent;
    if (val !== undefined) {
        content = content.replaceAll(
            "<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) _%>",
            YAML.stringify(val, { blockQuote: 'literal' })
        );
    }
    content += `\nuse \`${MVUFunctionName}\` tool to update variables.`;
    return content;
}
*/

async function onVariableUpdatedCall(args: any): Promise<string> {
    if (!args?.delta) return '';
    let message_id = getLastMessageId();
    let chat_message = getChatMessages(message_id).at(-1);
    if (chat_message && chat_message.role === 'system') {
        //移动到前一条，说明这一条是用来显示 mvu 更新的
        message_id -= 1;
        chat_message = getChatMessages(message_id).at(-1);
    }
    if (!chat_message) {
        return '';
    }

    let message_content = chat_message.message;
    const variables = await getLastValidVariable(message_id);
    if (!_.has(variables, 'stat_data')) {
        console.error(`cannot found stat_data for ${message_id}`);
        return '';
    }

    const has_variable_modified = await updateVariables(args.delta, variables);
    if (has_variable_modified) {
        await replaceVariables(variables, { type: 'chat' });
    }
    await replaceVariables(variables, { type: 'message', message_id: message_id });

    message_content += `<UpdateVariable>\n<Analysis>${args.analysis}</Analysis></Analysis>${args.delta}\n</UpdateVariable>`;

    if (chat_message.role !== 'user' && !message_content.includes('<StatusPlaceHolderImpl/>')) {
        //同时追加 PlaceHolder。
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content + '\n\n<StatusPlaceHolderImpl/>',
                },
            ],
            {
                refresh: 'affected',
            }
        );
    } else {
        //只追加新增的 UpdateVaraible 块
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content,
                },
            ],
            {
                refresh: 'affected',
            }
        );
    }
    return JSON.stringify(variables.delta_data);
}

export function registerFunction() {
    const { registerFunctionTool } = SillyTavern;
    if (!registerFunctionTool) {
        console.debug('MVU: function tools are not supported');
        return;
    }

    const mvu_update_schema = Object.freeze({
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        additionalProperties: false,
        properties: {
            analysis: {
                type: 'string',
                minLength: 1,
                description:
                    'Write in ENGLISH. A compact reasoning summary that includes: (1) calculate time passed; (2) decide whether dramatic updates are allowed (special case or sufficiently long time); (3) list every variable name that appears in the <status_description> section BEFORE actual variable analysis, without revealing their contents; (4) for each variable, judge whether it satisfies its change conditions and output only Y/N without reasons; (5) ignore summary-related content when evaluating.',
            },
            delta: {
                type: 'string',
                minLength: 0,
                description:
                    "multilines Update statements, includes `_.set`,`_.insert`,`_.assign`,`_.delete`,`_.remove`,`_.add`. example: _.set('悠纪.好感度',35);//愉快的一次讨论，悠纪觉得与你一起是开心的",
            },
        },
        required: ['delta'],
    });

    registerFunctionTool({
        name: mvu_function_name,
        displayName: 'MVU update',
        stealth: true,
        description: 'use this tool to UpdateVariable.',
        parameters: mvu_update_schema,
        shouldRegister: () => {
            if (!is_function_call_enabled) {
                return false;
            }
            const settings = useSettingsStore().settings;
            return settings.额外模型解析配置.解析方式 === '发送变量提示词及预设 (函数调用)';
        },
        action: onVariableUpdatedCall,
        formatMessage: () => '',
    });

    /* 目前验证单独新开一个消息来做变量分析和目前的双模型实现(带预设)没有显著区别，且 llm 不一定会调用，因此暂时搁置。
    const mvuRoundUpdateSchema = Object.freeze({
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        additionalProperties: false,

        properties: {},
    });

    registerFunctionTool({
        name: MVUUpdateCallFunctionName,
        displayName: 'MVU update',
        stealth: false,
        description:
            '**ALWAYS** call this function to end each response. By use this tool, output the `<UpdateVariable>` block is no longer necessary;',
        parameters: mvuRoundUpdateSchema,
        shouldRegister: () => {
            const settings = useSettingsStore().settings;
            if (settings.更新方式 === '额外轮次函数调用') {
                const message_id = getLastMessageId();
                const chat_message = getChatMessages(message_id).at(-1);
                if (!chat_message) {
                    return false;
                }

                let message_content = chat_message.message;
                //如果已经是一次函数调用的应答，则不进行处理
                if (message_content.indexOf(`以旁白视角分析最新剧情，按照变量更新规则更新`) != -1)
                    return false;
                return true;
            }
            return false;
        },
        action: onStoryEndCall,
        formatMessage: () => '',
    });
    */
}

export function overrideToolRequest(generate_data: any) {
    const settings = useSettingsStore().settings;
    if (
        settings.更新方式 !== '额外模型解析' ||
        settings.额外模型解析配置.解析方式 !== '发送变量提示词及预设 (函数调用)'
    ) {
        return;
    }
    if (!is_function_call_enabled) {
        return;
    }
    if (generate_data.tools !== undefined && _.size(generate_data.tools) > 0) {
        //如 v3之类的模型， required之后效力会更好。
        /*
        const message_id = getLastMessageId();
        const chat_message = getChatMessages(message_id).at(-1);
        if (!chat_message) {
            generate_data.tool_choice = 'auto';
            return;
        }
        const function_info = _.get(chat_message, 'extra.tool_invocations');
        if (_.isArray(function_info)) {
            //为required 会更可能出发纯prompt的输出
            generate_data.tool_choice = 'required';
            return;
        }
        */
        generate_data.tool_choice = 'required';
    }
}
