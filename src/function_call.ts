import { getLastValidVariable, updateVariables } from '@/function';

const MVUFunctionName = 'mvu_update_analysis';

export function unregisterFunction() {
    SillyTavern.unregisterFunctionTool(MVUFunctionName);
}

export function registerFunction() {
    const { registerFunctionTool } = SillyTavern;
    if (!registerFunctionTool) {
        console.debug('Dice: function tools are not supported');
        return;
    }

    const rollDiceSchema = Object.freeze({
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
                    "Only zero or more lines, each being `_.set(path, new_value);//reason`. Lines are separated by a newline. If there are no updates, return an empty string. example: _.set('悠纪.好感度',35);//愉快的一次讨论，悠纪觉得与你一起是开心的",
                pattern: '(?s)^\\s*(?:_.set\\([^\\n]*\\);\\s*//[^\\n]*\\s*(?:\\n|$))*\\s*$',
            },
        },
        required: ['delta'],
    });

    registerFunctionTool({
        name: MVUFunctionName,
        displayName: 'MVU update',
        stealth: true,
        description:
            "Order constraint: 'Answer first, then call this tool' is mandatory. The tool call must be the last item in the response. Call only once, at the very end of the assistant’s response, after producing the complete human‑readable answer. Generate an English reasoning summary and a compact delta script. `analysis` must be written in ENGLISH and cover: (1) calculate time passed; (2) decide whether dramatic updates are allowed (special case or enough time); (3) list every variable name that appears in the <status_description> section BEFORE variable analysis, without revealing any content; (4) for each variable, judge Y/N whether it satisfies its change conditions, without reasons; (5) ignore any summary-related content. `delta` must contain ONLY zero or more lines of `_.set(path, new);//reason`, separated by \\n, and nothing else.",
        parameters: rollDiceSchema,
        action: async (args: any) => {
            if (!args?.delta) return '';
            const message_id = getLastMessageId();
            const chat_message = getChatMessages(message_id).at(-1);
            if (!chat_message) {
                return;
            }

            let message_content = chat_message.message;
            const variables = await getLastValidVariable(message_id);
            if (!_.has(variables, 'stat_data')) {
                console.error(`cannot found stat_data for ${message_id}`);
                return;
            }

            const has_variable_modified = await updateVariables(args.delta, variables);
            if (has_variable_modified) {
                await replaceVariables(variables, { type: 'chat' });
            }
            await replaceVariables(variables, { type: 'message', message_id: message_id });

            message_content += `<UpdateVariable>\n<Analysis>${args.analysis}</Analysis></Analysis>${args.delta}\n</UpdateVariable>`;

            if (
                chat_message.role !== 'user' &&
                !message_content.includes('<StatusPlaceHolderImpl/>')
            ) {
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
            }
            return JSON.stringify(variables.delta_data);
        },
        formatMessage: () => '',
    });
}

export function overrideToolRequest(generate_data: any) {
    if (generate_data.tools !== undefined && _.size(generate_data.tools) > 0) {
        //如 v3之类的模型， required之后效力会更好。
        //generate_data.tool_choice = "required";
    }
}
