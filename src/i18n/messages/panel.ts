import { defineMessages } from '@/i18n/messages/types';

export const panelMessages = defineMessages({
    'panel.title': {
        'zh-CN': 'MVU 变量框架',
        en: 'MVU Variable Framework',
    },
    'panel.version.section': {
        'zh-CN': '当前版本',
        en: 'Current version',
    },
    'panel.version.unknown': {
        'zh-CN': '未知',
        en: 'Unknown',
    },
    'panel.notification.section': {
        'zh-CN': '通知设置',
        en: 'Notifications',
    },
    'panel.notification.frameworkLoaded': {
        'zh-CN': 'MVU 框架加载成功时通知',
        en: 'Notify when the MVU framework loads successfully',
    },
    'panel.notification.variablesInitialized': {
        'zh-CN': '变量初始化成功时通知',
        en: 'Notify when variables are initialized successfully',
    },
    'panel.notification.variableError': {
        'zh-CN': '变量初始化/更新出错时通知',
        en: 'Notify when variable initialization or updates fail',
    },
    'panel.notification.extraModelParsing': {
        'zh-CN': '额外模型解析中通知',
        en: 'Notify while extra-model parsing is running',
    },
    'panel.cleanup.section': {
        'zh-CN': '自动清理变量',
        en: 'Automatic variable cleanup',
    },
    'panel.cleanup.enable': {
        'zh-CN': '启用自动清理变量',
        en: 'Enable automatic variable cleanup',
    },
    'panel.cleanup.strategy': {
        'zh-CN': '清理策略',
        en: 'Cleanup strategy',
    },
    'panel.cleanup.snapshotInterval': {
        'zh-CN': '快照保留间隔',
        en: 'Snapshot retention interval',
    },
    'panel.cleanup.recentFloors': {
        'zh-CN': '要保留变量的最近楼层数',
        en: 'Recent floors whose variables are retained',
    },
    'panel.cleanup.restoreFloors': {
        'zh-CN': '触发恢复变量的最近楼层数',
        en: 'Recent floors that trigger variable restoration',
    },
    'panel.compatibility.section': {
        'zh-CN': '兼容性',
        en: 'Compatibility',
    },
    'panel.compatibility.updateChatVariables': {
        'zh-CN': '变量更新到聊天变量',
        en: 'Write variable updates to chat variables',
    },
    'panel.compatibility.updateChatVariablesHelp': {
        'zh-CN':
            '启用后，所有变量更新结果也会输出到聊天变量中。如果部分老角色卡无法正常游玩，可以开启这个开关。',
        en: 'When enabled, every variable update is also written to chat variables. Enable this if some older character cards do not work correctly.',
    },
    'panel.compatibility.showLegacy': {
        'zh-CN': '显示老旧功能',
        en: 'Show legacy features',
    },
    'panel.compatibility.sendasNotUser': {
        'zh-CN': 'sendas 不视为 user 消息',
        en: 'Do not treat sendas as a user message',
    },
    'panel.compatibility.license': {
        'zh-CN': 'LICENSE',
        en: 'LICENSE',
    },
    'panel.compatibility.licenseIntro': {
        'zh-CN': 'MVU 采用 MIT 许可证。以下是运行时使用或随扩展打包的第三方开源组件：',
        en: 'MVU is licensed under MIT. The following third-party components are used at runtime or bundled with the extension:',
    },
    'panel.compatibility.licenseComponent': {
        'zh-CN': '组件',
        en: 'Component',
    },
    'panel.compatibility.licenseIdentifier': {
        'zh-CN': '许可证',
        en: 'License',
    },
    'panel.compatibility.licenseDetails': {
        'zh-CN':
            '许可证标识来自当前依赖元数据；点击组件名称可查看项目，完整条款以各项目 LICENSE 为准。',
        en: 'License identifiers come from current dependency metadata. Select a component name to view its project; the project LICENSE contains the complete terms.',
    },
    'panel.button.section': {
        'zh-CN': '修复按钮',
        en: 'Repair actions',
    },
    'panel.button.reprocessVariables': {
        'zh-CN': '重新处理变量',
        en: 'Reprocess variables',
    },
    'panel.button.reloadInitialVariables': {
        'zh-CN': '重新读取初始变量',
        en: 'Reload initial variables',
    },
    'panel.button.snapshotFloor': {
        'zh-CN': '快照楼层',
        en: 'Snapshot floor',
    },
    'panel.button.replayFloor': {
        'zh-CN': '重演楼层',
        en: 'Replay floor',
    },
    'panel.button.retryExtraModelParsing': {
        'zh-CN': '重试额外模型解析',
        en: 'Retry extra-model parsing',
    },
    'panel.button.stopPiExtraModelParsing': {
        'zh-CN': '停止“更多”额外模型解析',
        en: 'Stop extra-model parsing from More',
    },
    'panel.button.clearOldFloorVariables': {
        'zh-CN': '清除旧楼层变量',
        en: 'Clear variables from old floors',
    },
    'panel.help.ariaLabel': {
        'zh-CN': '帮助',
        en: 'Help',
    },
    'panel.badge.override': {
        'zh-CN': '角色卡覆盖',
        en: 'Character-card override',
    },
    'panel.badge.overrideWithValue': {
        'zh-CN': '角色卡覆盖：{value}',
        en: 'Character-card override: {value}',
    },
    'panel.badge.additive': {
        'zh-CN': '角色卡规则叠加',
        en: 'Character-card rule added',
    },
    'panel.update.section': {
        'zh-CN': '变量更新方式',
        en: 'Variable update method',
    },
    'panel.update.method.aiOutput': {
        'zh-CN': '随 AI 输出',
        en: 'Alongside AI output',
    },
    'panel.update.method.extraModel': {
        'zh-CN': '额外模型解析',
        en: 'Extra-model parsing',
    },
    'panel.update.method.unsupportedWarning': {
        'zh-CN':
            '世界书 [{worldbooks}] 未适配额外模型解析，视为 [mvu_plot] 条目（只会发给剧情 AI、不会发给变量更新 AI）。',
        en: 'World book [{worldbooks}] is not adapted for extra-model parsing and will be treated as an [mvu_plot] entry (sent only to the story AI, not the variable-update AI).',
    },
    'panel.modelSelect.ariaLabel': {
        'zh-CN': '模型列表',
        en: 'Model list',
    },
    'panel.modelSelect.chooseFromList': {
        'zh-CN': '（从列表选择）',
        en: '(Choose from list)',
    },
    'panel.modelSelect.loading': {
        'zh-CN': '获取中…',
        en: 'Fetching…',
    },
    'panel.modelSelect.fetch': {
        'zh-CN': '获取模型列表',
        en: 'Fetch model list',
    },
    'panel.modelSelect.empty': {
        'zh-CN': '模型列表为空或获取失败',
        en: 'The model list is empty or could not be fetched',
    },
    'panel.modelSelect.fetchTitle': {
        'zh-CN': '[MVU]获取模型列表',
        en: '[MVU] Fetch model list',
    },
    'panel.modelSelect.fetchFailureTitle': {
        'zh-CN': '[MVU]获取模型列表失败',
        en: '[MVU] Failed to fetch model list',
    },
    'panel.prompt.section': {
        'zh-CN': '请求内容',
        en: 'Request content',
    },
    'panel.prompt.jailbreakStrategy': {
        'zh-CN': '破限方案',
        en: 'Jailbreak strategy',
    },
    'panel.prompt.jailbreak.builtin': {
        'zh-CN': '使用内置破限',
        en: 'Use built-in jailbreak',
    },
    'panel.prompt.jailbreak.currentPreset': {
        'zh-CN': '使用当前预设',
        en: 'Use current preset',
    },
    'panel.prompt.jailbreak.otherPreset': {
        'zh-CN': '使用其他预设',
        en: 'Use another preset',
    },
    'panel.prompt.targetPreset': {
        'zh-CN': '目标预设',
        en: 'Target preset',
    },
    'panel.prompt.noSavedPreset': {
        'zh-CN': '未检测到可用的已保存预设',
        en: 'No available saved presets detected',
    },
    'panel.prompt.randomHeader': {
        'zh-CN': '随机头部',
        en: 'Randomized header',
    },
    'panel.prompt.randomHeaderHelp': {
        'zh-CN':
            'Gemini 系模型会记录破限头部，因此需要在头部增加随机数。如果你使用的不是 Gemini 系模型，请关闭这个功能，以免缓存失效。',
        en: 'Gemini-family models may record the jailbreak header, so a random number is added to it. Disable this for non-Gemini models to avoid invalidating the prompt cache.',
    },
    'panel.prompt.responseFormat': {
        'zh-CN': '应答格式',
        en: 'Response format',
    },
    'panel.prompt.response.chatMessage': {
        'zh-CN': '聊天消息',
        en: 'Chat message',
    },
    'panel.prompt.response.toolCall': {
        'zh-CN': '工具调用',
        en: 'Tool call',
    },
    'panel.prompt.response.structured': {
        'zh-CN': '格式化输出',
        en: 'Structured output',
    },
    'panel.prompt.response.structuredV4': {
        'zh-CN': '格式化输出（v4 兼容）',
        en: 'Structured output (v4 compatible)',
    },
    'panel.prompt.disableThinking': {
        'zh-CN': '关闭 thinking',
        en: 'Disable thinking',
    },
    'panel.prompt.disableThinkingHelp': {
        'zh-CN': '关闭后可避免部分空回复问题。',
        en: 'Disabling thinking can prevent some empty responses.',
    },
    'panel.prompt.disable': {
        'zh-CN': '关闭',
        en: 'Disable',
    },
    'panel.prompt.fakeStreaming': {
        'zh-CN': '兼容假流式',
        en: 'Pseudo-streaming compatibility',
    },
    'panel.prompt.fakeStreamingHelp': {
        'zh-CN': '勾选后，额外模型解析会要求 AI 流式传输，从而兼容一些需要假流式来保活的渠道模型。',
        en: 'When enabled, extra-model parsing requests streaming so it works with providers that require pseudo-streaming to keep the connection alive.',
    },
    'panel.prompt.whitelist': {
        'zh-CN': '世界书条目白名单正则',
        en: 'World-book entry whitelist regex',
    },
    'panel.prompt.whitelistHelp': {
        'zh-CN':
            '留空则关闭；非空时，额外模型解析阶段只保留 comment 匹配该正则的世界书条目。支持 {example}。',
        en: 'Leave blank to disable. When set, extra-model parsing retains only world-book entries whose comment matches this regex. Supports {example}.',
    },
    'panel.prompt.whitelistPlaceholder': {
        'zh-CN': '角色{or}地点 或 /角色{or}地点/i',
        en: 'character{or}location or /character{or}location/i',
    },
    'panel.prompt.blacklist': {
        'zh-CN': '世界书条目黑名单正则',
        en: 'World-book entry blacklist regex',
    },
    'panel.prompt.blacklistHelp': {
        'zh-CN':
            '留空则关闭；非空时，额外模型解析阶段会排除 comment 匹配该正则的世界书条目。支持 {example}。',
        en: 'Leave blank to disable. When set, extra-model parsing excludes world-book entries whose comment matches this regex. Supports {example}.',
    },
    'panel.prompt.blacklistPlaceholder': {
        'zh-CN': '临时{or}禁用 或 /临时{or}禁用/i',
        en: 'temporary{or}disabled or /temporary{or}disabled/i',
    },
    'panel.prompt.regexInvalid': {
        'zh-CN': '正则无效：{error}',
        en: 'Invalid regex: {error}',
    },
    'panel.prompt.filtered.title': {
        'zh-CN': '上次分析被筛选的条目',
        en: 'Entries filtered from the last analysis',
    },
    'panel.prompt.filtered.empty': {
        'zh-CN': '上次分析没有被黑/白名单筛选掉的条目。',
        en: 'No entries were filtered by the whitelist or blacklist in the last analysis.',
    },
    'panel.prompt.filtered.entrySource': {
        'zh-CN': '条目来源',
        en: 'Entry source',
    },
    'panel.prompt.filtered.worldBook': {
        'zh-CN': '世界书',
        en: 'World book',
    },
    'panel.prompt.filtered.reason': {
        'zh-CN': '原因',
        en: 'Reason',
    },
    'panel.prompt.filtered.configSource': {
        'zh-CN': '配置来源',
        en: 'Configuration source',
    },
    'panel.prompt.filtered.comment': {
        'zh-CN': '条目备注',
        en: 'Comment',
    },
    'panel.prompt.filtered.globalLore': {
        'zh-CN': '全局世界书',
        en: 'Global world book',
    },
    'panel.prompt.filtered.characterLore': {
        'zh-CN': '角色世界书',
        en: 'Character world book',
    },
    'panel.prompt.filtered.chatLore': {
        'zh-CN': '聊天世界书',
        en: 'Chat world book',
    },
    'panel.prompt.filtered.personaLore': {
        'zh-CN': '用户世界书',
        en: 'Persona world book',
    },
    'panel.prompt.filtered.whitelistReason': {
        'zh-CN': '白名单',
        en: 'Whitelist',
    },
    'panel.prompt.filtered.blacklistReason': {
        'zh-CN': '黑名单',
        en: 'Blacklist',
    },
    'panel.prompt.filtered.globalConfig': {
        'zh-CN': '用户全局配置',
        en: 'User global settings',
    },
    'panel.prompt.filtered.characterConfig': {
        'zh-CN': '角色卡配置',
        en: 'Character-card settings',
    },
    'panel.prompt.toolCallUnavailableTitle': {
        'zh-CN': "[MVU]无法使用'工具调用'",
        en: "[MVU] Cannot use 'Tool call'",
    },
    'panel.prompt.toolCallUnsupported': {
        'zh-CN': '当前 API 源不支持工具调用，请换用支持 tools 的渠道模型或改用其他应答格式',
        en: 'The current API source does not support tool calls. Choose a provider/model that supports tools, or use another response format.',
    },
    'panel.prompt.structuredV4UnavailableTitle': {
        'zh-CN': "[MVU]无法使用'格式化输出(v4兼容)'",
        en: "[MVU] Cannot use 'Structured output (v4 compatible)'",
    },
    'panel.prompt.structuredV4RequiresCustom': {
        'zh-CN': '格式化输出(v4兼容)需要额外模型来源为自定义，不能与插头相同',
        en: 'Structured output (v4 compatible) requires a custom extra-model source and cannot use the current connection.',
    },
    'panel.request.section': {
        'zh-CN': '请求策略',
        en: 'Request strategy',
    },
    'panel.request.method': {
        'zh-CN': '请求方式',
        en: 'Request method',
    },
    'panel.request.sequential': {
        'zh-CN': '依次请求，失败后重试',
        en: 'Request sequentially and retry on failure',
    },
    'panel.request.parallel': {
        'zh-CN': '同时请求多次',
        en: 'Send multiple requests in parallel',
    },
    'panel.request.onceThenParallel': {
        'zh-CN': '先请求一次，失败后再同时请求多次',
        en: 'Request once, then retry in parallel on failure',
    },
    'panel.request.count': {
        'zh-CN': '请求次数',
        en: 'Number of requests',
    },
    'panel.request.auto': {
        'zh-CN': '自动请求',
        en: 'Automatic requests',
    },
    'panel.request.autoHelp': {
        'zh-CN':
            '关闭后，AI 回复完成时不会自动触发额外模型解析；你需要主动点击“重试额外模型解析”按钮，才会执行解析并添加状态栏占位符 &lt;StatusPlaceHolderImpl/&gt;。',
        en: 'When disabled, extra-model parsing is not triggered automatically after the AI finishes replying. Click “Retry extra-model parsing” to run it and add the status-bar placeholder &lt;StatusPlaceHolderImpl/&gt;.',
    },
    'panel.request.batchWarning': {
        'zh-CN':
            '请升级酒馆助手到 4.4.3 或更高版本，否则批量请求功能可能让预设的“流式传输”设置失效',
        en: "Upgrade Tavern Helper to version 4.4.3 or later. Otherwise, batch requests may override the preset's streaming setting.",
    },
    'panel.request.batchWarningTitle': {
        'zh-CN': '[MVU]批量请求可能有问题',
        en: '[MVU] Batch requests may not work correctly',
    },
    'panel.source.section': {
        'zh-CN': '模型来源',
        en: 'Model source',
    },
    'panel.source.sameAsConnection': {
        'zh-CN': '与插头相同',
        en: 'Same as current connection',
    },
    'panel.source.custom': {
        'zh-CN': '自定义',
        en: 'Custom',
    },
    'panel.source.more': {
        'zh-CN': '更多',
        en: 'More',
    },
    'panel.source.profile.section': {
        'zh-CN': 'API 方案',
        en: 'API profiles',
    },
    'panel.source.profile.current': {
        'zh-CN': '当前方案',
        en: 'Current profile',
    },
    'panel.source.profile.ariaLabel': {
        'zh-CN': 'API 方案',
        en: 'API profile',
    },
    'panel.source.profile.manual': {
        'zh-CN': '（手动编辑，未绑定方案）',
        en: '(Manual settings, not bound to a profile)',
    },
    'panel.source.profile.newName': {
        'zh-CN': '新方案名称',
        en: 'New profile name',
    },
    'panel.source.profile.save': {
        'zh-CN': '保存当前方案',
        en: 'Save current profile',
    },
    'panel.source.profile.saveAs': {
        'zh-CN': '另存为新方案',
        en: 'Save as new profile',
    },
    'panel.source.profile.delete': {
        'zh-CN': '删除当前方案',
        en: 'Delete current profile',
    },
    'panel.source.profile.backendCustom': {
        'zh-CN': '自定义 API',
        en: 'Custom API',
    },
    'panel.source.profile.backendPi': {
        'zh-CN': '更多',
        en: 'More',
    },
    'panel.source.apiAddress': {
        'zh-CN': 'API 地址',
        en: 'API address',
    },
    'panel.source.apiKey': {
        'zh-CN': 'API 密钥',
        en: 'API key',
    },
    'panel.source.apiKeyPlaceholder': {
        'zh-CN': '留空表示无需密钥',
        en: 'Leave blank when no key is required',
    },
    'panel.source.modelName': {
        'zh-CN': '模型名称',
        en: 'Model name',
    },
    'panel.source.pi.provider': {
        'zh-CN': '来源',
        en: 'Provider',
    },
    'panel.source.pi.apiLabel': {
        'zh-CN': 'API 接口',
        en: 'API protocol',
    },
    'panel.source.pi.authType': {
        'zh-CN': '认证方式',
        en: 'Authentication',
    },
    'panel.source.pi.endpoint': {
        'zh-CN': 'API 基础地址',
        en: 'API base URL',
    },
    'panel.source.pi.endpointDefault': {
        'zh-CN': '留空使用默认地址：{endpoint}',
        en: 'Leave blank to use the default: {endpoint}',
    },
    'panel.source.pi.endpointPlaceholder': {
        'zh-CN': '请输入 API 基础地址',
        en: 'Enter an API base URL',
    },
    'panel.source.pi.endpointHelp': {
        'zh-CN':
            '建议填写 API 基础地址；若粘贴了以 /responses、/chat/completions 或 /v1/messages 结尾的接口地址，将按当前 API 自动调整。',
        en: 'Enter the API base URL. If you paste an operation URL ending in /responses, /chat/completions, or /v1/messages, it is adjusted automatically for the selected API.',
    },
    'panel.source.pi.proxy.use': {
        'zh-CN': '使用 Proxy',
        en: 'Use Proxy',
    },
    'panel.source.pi.proxy.help': {
        'zh-CN':
            '通过 SillyTavern 的 CORS Proxy 转发对该自定义 API 地址的模型列表和生成请求。只应对可信且不会重定向到其他站点的地址启用；OAuth 请求不经过此代理。',
        en: "Route model-list and generation requests for this custom API URL through SillyTavern's CORS Proxy. Enable this only for trusted URLs that do not redirect to another site; OAuth requests do not use this proxy.",
    },
    'panel.source.pi.proxy.notEnabled': {
        'zh-CN': '没有开启Proxy',
        en: 'Proxy is not enabled',
    },
    'panel.source.pi.proxy.notEnabledHelp': {
        'zh-CN':
            '请在 SillyTavern 的 config.yaml 中开启 enableCorsProxy，或使用 --corsProxy 启动参数，然后重启 SillyTavern。',
        en: 'Enable enableCorsProxy in SillyTavern config.yaml, or start SillyTavern with --corsProxy, then restart SillyTavern.',
    },
    'panel.source.pi.model': {
        'zh-CN': '模型',
        en: 'Model',
    },
    'panel.source.pi.catalogModel': {
        'zh-CN': '模型目录',
        en: 'Model catalog',
    },
    'panel.source.pi.customModel': {
        'zh-CN': '（手动填写模型）',
        en: '(Enter a model manually)',
    },
    'panel.source.pi.api.openaiResponses': {
        'zh-CN': 'OpenAI Responses',
        en: 'OpenAI Responses',
    },
    'panel.source.pi.api.openaiCompletions': {
        'zh-CN': 'OpenAI Chat Completions',
        en: 'OpenAI Chat Completions',
    },
    'panel.source.pi.api.openaiCodexResponses': {
        'zh-CN': 'OpenAI Codex Responses',
        en: 'OpenAI Codex Responses',
    },
    'panel.source.pi.api.anthropicMessages': {
        'zh-CN': 'Anthropic Messages',
        en: 'Anthropic Messages',
    },
    'panel.source.pi.api.googleGenerativeAi': {
        'zh-CN': 'Google Generative AI',
        en: 'Google Generative AI',
    },
    'panel.source.pi.api.mistralConversations': {
        'zh-CN': 'Mistral Conversations',
        en: 'Mistral Conversations',
    },
    'panel.source.pi.auth.apiKey': {
        'zh-CN': 'API Key',
        en: 'API key',
    },
    'panel.source.pi.auth.oauth': {
        'zh-CN': 'OAuth',
        en: 'OAuth',
    },
    'panel.source.pi.capabilities': {
        'zh-CN': '此来源能力：{capabilities}',
        en: 'Provider capabilities: {capabilities}',
    },
    'panel.source.pi.capability.tools': {
        'zh-CN': '工具调用',
        en: 'tools',
    },
    'panel.source.pi.capability.images': {
        'zh-CN': '图片输入',
        en: 'image input',
    },
    'panel.source.pi.capability.structured': {
        'zh-CN': '结构化输出',
        en: 'structured output',
    },
    'panel.source.pi.contextWindow': {
        'zh-CN': '上下文窗口',
        en: 'Context window',
    },
    'panel.source.pi.contextWindowCatalog': {
        'zh-CN': '当前使用模型目录值 {value}；填写后将保存为用户覆盖值，清空可恢复目录值。',
        en: 'Using the catalog value {value}. Enter a value to save an override; clear it to use the catalog again.',
    },
    'panel.source.pi.contextWindowOverride': {
        'zh-CN': '当前使用用户配置值；清空可恢复模型目录值。',
        en: 'Using your configured override. Clear it to use the model catalog value.',
    },
    'panel.source.pi.contextWindowRequired': {
        'zh-CN': '请输入正整数上下文窗口；模型目录未提供该值时必须手动填写。',
        en: 'Enter a positive integer context window. It is required when the model catalog has no value.',
    },
    'panel.source.pi.error.unknownProvider': {
        'zh-CN': '“更多”中的未知来源“{provider}”；请重新选择来源。',
        en: 'Unknown provider "{provider}" under More. Select a provider again.',
    },
    'panel.source.pi.unknownProviderOption': {
        'zh-CN': '未知来源：{provider}',
        en: 'Unknown provider: {provider}',
    },
    'panel.source.pi.error.unsupportedApi': {
        'zh-CN': '来源“{provider}”不支持接口“{api}”。',
        en: 'Provider "{provider}" does not support API "{api}".',
    },
    'panel.source.pi.error.unsupportedAuth': {
        'zh-CN': '来源“{provider}”不支持认证方式“{auth}”。',
        en: 'Provider "{provider}" does not support authentication type "{auth}".',
    },
    'panel.source.pi.error.unsupportedEndpoint': {
        'zh-CN': '当前来源或 OAuth 认证不允许自定义 endpoint。',
        en: 'The selected provider or OAuth authentication does not allow a custom endpoint.',
    },
    'panel.source.pi.featureDisabled': {
        'zh-CN':
            '此构建已关闭“更多”模型来源。已保存的“更多”配置仍会保留；请选择“与插头相同”或“自定义”。',
        en: 'The More model source is disabled in this build. Saved More-source settings are preserved; select Same as current connection or Custom.',
    },
    'panel.source.pi.maxTokensPositive': {
        'zh-CN': '最大回复 token 必须是正整数。',
        en: 'Maximum response tokens must be a positive integer.',
    },
    'panel.source.pi.maxTokensExceedContext': {
        'zh-CN': '最大回复 token 不能大于上下文窗口。',
        en: 'Maximum response tokens cannot exceed the context window.',
    },
    'panel.source.pi.customHeaders': {
        'zh-CN': '自定义请求头',
        en: 'Custom request headers',
    },
    'panel.source.pi.customHeadersHelp': {
        'zh-CN': '使用 YAML 或 JSON 对象；留空即禁用。认证请求头禁止覆盖。',
        en: 'Use a YAML or JSON object; leave empty to disable. Authentication headers cannot be overridden.',
    },
    'panel.source.pi.customOverridesSwitchHelp': {
        'zh-CN':
            '切换“更多”中的来源、接口、认证方式或实际 endpoint 时，这三项请求覆盖会自动清空，避免发送到另一个目标。API 方案切换会恢复该方案自己的显式配置。',
        en: 'Changing the provider, API, authentication, or effective endpoint under More clears all three request overrides so they cannot be sent to another target. Switching API profiles restores that profile’s explicit values.',
    },
    'panel.source.pi.customIncludeBody': {
        'zh-CN': '请求体附加字段',
        en: 'Additional request body fields',
    },
    'panel.source.pi.customIncludeBodyHelp': {
        'zh-CN':
            '使用 YAML 或 JSON 对象；留空即禁用。同名可自定义字段会被这里的值覆盖，认证及核心传输字段仍受保护。Google 字段应放在 config 对象内。',
        en: 'Use a YAML or JSON object; leave empty to disable. Values here override matching customizable fields, while authentication and core transport fields remain protected. Put Google fields inside the config object.',
    },
    'panel.source.pi.customExcludeBody': {
        'zh-CN': '请求体排除字段',
        en: 'Excluded request body fields',
    },
    'panel.source.pi.customExcludeBodyHelp': {
        'zh-CN':
            '使用 YAML 字符串数组，或用换行/逗号分隔字段；留空即禁用。Google 配置字段使用 config.&lt;字段名&gt; 路径。',
        en: 'Use a YAML string array, or separate fields with newlines/commas; leave empty to disable. Use config.&lt;field&gt; paths for Google configuration fields.',
    },
    'panel.source.pi.clearCustomField': {
        'zh-CN': '清空',
        en: 'Clear',
    },
    'panel.source.pi.oauth.section': {
        'zh-CN': 'OAuth 登录',
        en: 'OAuth login',
    },
    'panel.source.pi.oauth.status': {
        'zh-CN': '状态',
        en: 'Status',
    },
    'panel.source.pi.oauth.checking': {
        'zh-CN': '检查中…',
        en: 'Checking…',
    },
    'panel.source.pi.oauth.loggedIn': {
        'zh-CN': '已登录',
        en: 'Signed in',
    },
    'panel.source.pi.oauth.loggedOut': {
        'zh-CN': '未登录',
        en: 'Not signed in',
    },
    'panel.source.pi.oauth.expiresAt': {
        'zh-CN': '凭据有效期：{time}',
        en: 'Credential expiry: {time}',
    },
    'panel.source.pi.oauth.login': {
        'zh-CN': '登录',
        en: 'Sign in',
    },
    'panel.source.pi.oauth.relogin': {
        'zh-CN': '重新登录',
        en: 'Sign in again',
    },
    'panel.source.pi.oauth.reloginConfirm': {
        'zh-CN': '确定要重新登录 {provider} 吗？完成新授权后，保存的 OAuth 凭据将被替换。',
        en: 'Sign in to {provider} again? The saved OAuth credential will be replaced after the new authorization succeeds.',
    },
    'panel.source.pi.oauth.cancel': {
        'zh-CN': '取消登录',
        en: 'Cancel sign-in',
    },
    'panel.source.pi.oauth.logout': {
        'zh-CN': '登出',
        en: 'Sign out',
    },
    'panel.source.pi.oauth.authorizationUrl': {
        'zh-CN': '授权链接',
        en: 'Authorization URL',
    },
    'panel.source.pi.oauth.openAuthorization': {
        'zh-CN': '打开授权页',
        en: 'Open authorization page',
    },
    'panel.source.pi.oauth.copyAuthorization': {
        'zh-CN': '复制授权链接',
        en: 'Copy authorization URL',
    },
    'panel.source.pi.oauth.copySucceeded': {
        'zh-CN': '已复制授权链接',
        en: 'Authorization URL copied',
    },
    'panel.source.pi.oauth.copyFailed': {
        'zh-CN': '无法复制授权链接，请手动选择并复制。',
        en: 'Could not copy the authorization URL. Select and copy it manually.',
    },
    'panel.source.pi.oauth.callbackUrl': {
        'zh-CN': '回调链接',
        en: 'Callback URL',
    },
    'panel.source.pi.oauth.callbackHelp': {
        'zh-CN':
            '授权后本机回调页面无法打开属于预期。请从浏览器地址栏复制完整的 127.0.0.1 或 localhost 回调链接，并粘贴到这里。',
        en: 'It is expected that the local callback page may not open. Copy the complete 127.0.0.1 or localhost callback URL from the browser address bar and paste it here.',
    },
    'panel.source.pi.oauth.complete': {
        'zh-CN': '完成登录',
        en: 'Complete sign-in',
    },
    'panel.source.pi.oauth.preparing': {
        'zh-CN': '正在准备安全授权链接…',
        en: 'Preparing a secure authorization URL…',
    },
    'panel.source.pi.oauth.waitingCallback': {
        'zh-CN': '请在授权页完成登录，然后粘贴完整回调链接。',
        en: 'Finish signing in on the authorization page, then paste the complete callback URL.',
    },
    'panel.source.pi.oauth.exchanging': {
        'zh-CN': '正在验证回调并交换凭据…',
        en: 'Validating the callback and exchanging credentials…',
    },
    'panel.source.pi.oauth.loginSucceeded': {
        'zh-CN': 'OAuth 登录成功。',
        en: 'OAuth sign-in succeeded.',
    },
    'panel.source.pi.oauth.logoutSucceeded': {
        'zh-CN': '已登出。',
        en: 'Signed out.',
    },
    'panel.source.pi.oauth.logoutConfirm': {
        'zh-CN': '确定登出 {provider} 吗？保存的 OAuth 凭据将被删除。',
        en: 'Sign out of {provider}? The saved OAuth credential will be deleted.',
    },
    'panel.source.pi.oauth.failureTitle': {
        'zh-CN': '[MVU]OAuth 操作失败',
        en: '[MVU] OAuth operation failed',
    },
    'panel.source.advanced': {
        'zh-CN': '高级参数',
        en: 'Advanced parameters',
    },
    'panel.source.unsupportedAdvanced': {
        'zh-CN': '⚠️酒馆助手版本过低，不支持以下配置',
        en: '⚠️ Your Tavern Helper version is too old to support the settings below',
    },
    'panel.source.maxTokens': {
        'zh-CN': '最大回复 token',
        en: 'Maximum response tokens',
    },
    'panel.source.chatHistory': {
        'zh-CN': '聊天历史条数',
        en: 'Chat history entries',
    },
    'panel.source.temperature': {
        'zh-CN': '温度',
        en: 'Temperature',
    },
    'panel.source.frequencyPenalty': {
        'zh-CN': '频率惩罚',
        en: 'Frequency penalty',
    },
    'panel.source.presencePenalty': {
        'zh-CN': '存在惩罚',
        en: 'Presence penalty',
    },
    'panel.source.topP': {
        'zh-CN': 'Top P',
        en: 'Top P',
    },
    'panel.source.topK': {
        'zh-CN': 'Top K',
        en: 'Top K',
    },
    'panel.source.switchDirty': {
        'zh-CN': '当前方案有未保存的修改，切换将丢弃这些修改。是否继续？',
        en: 'The current profile has unsaved changes. Switching will discard them. Continue?',
    },
    'panel.source.continue': {
        'zh-CN': '继续',
        en: 'Continue',
    },
    'panel.source.discardChanges': {
        'zh-CN': '丢弃修改',
        en: 'Discard changes',
    },
    'panel.source.delete': {
        'zh-CN': '删除',
        en: 'Delete',
    },
    'panel.source.deleteDirty': {
        'zh-CN': '当前方案“{name}”有未保存的修改，删除将丢弃这些修改。是否继续？',
        en: 'Profile “{name}” has unsaved changes. Deleting it will discard them. Continue?',
    },
    'panel.source.deleteConfirm': {
        'zh-CN': '确定删除 API 方案“{name}”吗？此操作不可撤销。',
        en: 'Delete API profile “{name}”? This action cannot be undone.',
    },
    'panel.source.profileSaved': {
        'zh-CN': '已保存 API 方案“{name}”',
        en: 'Saved API profile “{name}”',
    },
    'panel.source.profileSavedAs': {
        'zh-CN': '已另存为 API 方案“{name}”',
        en: 'Saved as API profile “{name}”',
    },
    'panel.source.profileDeleted': {
        'zh-CN': '已删除 API 方案“{name}”',
        en: 'Deleted API profile “{name}”',
    },
    'panel.source.enterProfileName': {
        'zh-CN': '请先输入新方案名称',
        en: 'Enter a new profile name first',
    },
    'panel.source.keepTwoProfiles': {
        'zh-CN': '至少保留两个 API 方案时才可删除',
        en: 'At least two API profiles are required before one can be deleted',
    },
    'panel.source.switchFailureTitle': {
        'zh-CN': '[MVU]切换 API 方案失败',
        en: '[MVU] Failed to switch API profile',
    },
    'panel.source.saveFailureTitle': {
        'zh-CN': '[MVU]保存 API 方案失败',
        en: '[MVU] Failed to save API profile',
    },
    'panel.source.deleteFailureTitle': {
        'zh-CN': '[MVU]删除 API 方案失败',
        en: '[MVU] Failed to delete API profile',
    },
    'panel.character.titleActive': {
        'zh-CN': '当前角色卡配置（覆盖中）',
        en: 'Current character-card settings (overriding)',
    },
    'panel.character.titleInactive': {
        'zh-CN': '当前角色卡配置（未启用）',
        en: 'Current character-card settings (not enabled)',
    },
    'panel.character.worldBook': {
        'zh-CN': '角色世界书',
        en: 'Character world book',
    },
    'panel.character.reading': {
        'zh-CN': '正在读取…',
        en: 'Reading…',
    },
    'panel.character.unbound': {
        'zh-CN': '未绑定',
        en: 'Not bound',
    },
    'panel.character.inherit': {
        'zh-CN': '跟随用户配置',
        en: 'Inherit user settings',
    },
    'panel.character.extraModelGroup': {
        'zh-CN': '额外模型解析',
        en: 'Extra-model parsing',
    },
    'panel.character.autoRequest': {
        'zh-CN': '自动请求',
        en: 'Automatic requests',
    },
    'panel.character.whitelist': {
        'zh-CN': '角色卡世界书条目白名单正则',
        en: 'Character-card world-book entry whitelist regex',
    },
    'panel.character.blacklist': {
        'zh-CN': '角色卡世界书条目黑名单正则',
        en: 'Character-card world-book entry blacklist regex',
    },
    'panel.character.regexInvalid': {
        'zh-CN': '角色卡配置正则无效：{error}',
        en: 'Invalid character-card regex: {error}',
    },
});
