/* eslint-disable import-x/no-nodejs-modules -- 宿主契约测试需要读取源码并在隔离 VM 中执行。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as ts from 'typescript';
import type { LoreEntries } from '@/function/request/filter_entries';
import type { WorldinfoScanData } from '@/function/request/worldinfo_scan';

/** 本地宿主契约测试读取实际 ST 实现；CI 可通过 MVU_ST_ROOT 指定安装位置。 */
export const worldinfoHostPath = [
    process.env.MVU_ST_ROOT,
    path.join(os.homedir(), 'silly', 'SillyTavern2'),
]
    .filter(Boolean)
    .map(root => path.join(root!, 'public/scripts/world-info.js'))
    .find(candidate => fs.existsSync(candidate));

/**
 * 从宿主语法树中提取指定的顶层声明，移除 export 后供隔离环境执行。
 *
 * @param source 已解析的宿主或酒馆助手源码。
 * @param name 需要提取的函数、类或变量名称。
 * @returns 保留宿主实现的声明源码。
 * @throws 宿主版本缺少该声明时抛出异常，提示扫描接口可能已经变化。
 */
function declaration(source: ts.SourceFile, name: string): string {
    const statement = source.statements.find(
        node =>
            ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
                node.name?.text === name) ||
            (ts.isVariableStatement(node) &&
                node.declarationList.declarations.some(item => item.name.getText(source) === name))
    );
    if (!statement) throw new Error(`Host declaration missing: ${name}`);
    return statement.getText(source).replace(/^export\s+/, '');
}

/**
 * 建立使用真实宿主扫描函数的隔离测试环境。
 *
 * 从本机 ST 提取加载、激活、预算和递归实现，并接入仓库助手的 processWorldInfo。
 * 世界书 I/O、宏、正则和分词使用可控替身，测试不会修改用户世界书或发送模型请求。
 *
 * @param options 测试用世界书、两阶段事件回调及可选宿主设置覆盖。
 * @returns 可执行单次扫描的入口，以及供断言使用的宿主定时效果元数据。
 * @throws 未找到宿主源码或必要声明时抛出异常。
 */
export function createWorldinfoHost(options: {
    books: LoreEntries;
    loaded: (lores: LoreEntries) => Promise<void>;
    scan: (data: WorldinfoScanData) => Promise<void>;
    settings?: Record<string, unknown>;
}) {
    if (!worldinfoHostPath) throw new Error('Set MVU_ST_ROOT to run host scanner tests');
    const source = ts.createSourceFile(
        worldinfoHostPath,
        fs.readFileSync(worldinfoHostPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const processorPath = path.join(
        process.cwd(),
        'slash-runner/src/function/generate/dataProcessor.ts'
    );
    const processor = ts.createSourceFile(
        processorPath,
        fs.readFileSync(processorPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true
    );
    const names = [
        'world_info_insertion_strategy',
        'world_info_logic',
        'world_info_position',
        'wi_anchor_position',
        'scan_state',
        'defaultGlobalScanData',
        'WorldInfoBuffer',
        'WorldInfoTimedEffects',
        'parseDecorators',
        'getSortedEntries',
        'getWorldInfoPrompt',
        'checkWorldInfo',
        'filterByInclusionGroups',
        'filterGroupsByScoring',
        'filterGroupsByTimedEffects',
    ];
    const code =
        names.map(name => declaration(source, name)).join('\n') +
        '\n' +
        ts.transpileModule(declaration(processor, 'processWorldInfo'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText;
    const context = {
        console: {
            debug() {},
            log() {},
            warn() {},
            /** 将宿主内部错误升级为测试失败，防止扫描异常被静默忽略。 */
            error(...args: unknown[]) {
                throw new Error(args.join(' '));
            },
        },
        structuredClone,
        Map,
        Set,
        Promise,
        // 含 0 的概率结果用于验证识别条目也绝不会真正激活。
        Math: Object.assign(Object.create(Math), { random: () => 0 }),
        DEFAULT_DEPTH: 4,
        DEFAULT_WEIGHT: 100,
        MAX_SCAN_DEPTH: 1000,
        KNOWN_DECORATORS: ['@@activate', '@@dont_activate'],
        world_info_depth: 2,
        world_info_budget: 25,
        world_info_budget_cap: 0,
        world_info_min_activations: 0,
        world_info_min_activations_depth_max: 0,
        world_info_recursive: false,
        world_info_overflow_alert: false,
        world_info_max_recursion_steps: 0,
        world_info_case_sensitive: false,
        world_info_match_whole_words: false,
        world_info_use_group_scoring: false,
        world_info_character_strategy: 0,
        world_info_include_names: false,
        chat_metadata: {},
        shouldWIAddPrompt: false,
        extension_prompt_roles: { SYSTEM: 0 },
        regex_placement: { WORLD_INFO: 0 },
        name1: 'User',
        name2: 'Character',
        getContext: () => ({ extensionPrompts: {} }),
        getExtensionPromptByName: async () => '',
        getMaxContextSize: () => 8192,
        getGlobalLore: async () => structuredClone(options.books.globalLore),
        getCharacterLore: async () => structuredClone(options.books.characterLore),
        getChatLore: async () => structuredClone(options.books.chatLore),
        getPersonaLore: async () => structuredClone(options.books.personaLore),
        sortFn: (a: any, b: any) => b.order - a.order,
        getStringHash: (value: string) =>
            [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0),
        parseRegexFromString: () => null,
        substituteParams: (value: string) => value,
        getRegexedString: (value: string) => value,
        /** 以字符数模拟分词，并主动让出执行权，使并发扫描在 await 处交错。 */
        getTokenCountAsync: async (value: string) => {
            await new Promise(resolve => setTimeout(resolve, 0));
            return value.length;
        },
        clearInjectionPrompts: async () => {},
        processWorldInfoDepth: () => {},
        isPromptFiltered: () => false,
        event_types: {
            WORLDINFO_ENTRIES_LOADED: 'loaded',
            WORLDINFO_SCAN_DONE: 'scan',
            WORLD_INFO_ACTIVATED: 'activated',
        },
        eventSource: {
            /** 只转发本特性关心的加载和扫描完成事件，并等待异步筛选结束。 */
            emit: async (event: string, data: any) => {
                if (event === 'loaded') await options.loaded(data);
                if (event === 'scan') await options.scan(data);
            },
        },
        ...options.settings,
    };
    const runtime = vm.createContext(context);
    vm.runInContext(code, runtime);
    return {
        /**
         * 使用固定聊天背景执行一次真实的世界书处理流程。
         *
         * @param config 调用方独立的生成配置，其中描述覆盖可携带请求标记。
         * @returns 本次扫描拼接出的前置和后置世界书正文。
         */
        async run(config: GenerateConfig | GenerateRawConfig) {
            return runtime.processWorldInfo([{ role: 'user', content: 'same chat' }], config, {
                description: 'original description',
                personality: '',
                persona: '',
                scenario: '',
                charDepthPrompt: '',
                creatorNotes: '',
            }) as Promise<{ worldInfoBefore: string; worldInfoAfter: string }>;
        },
        metadata: context.chat_metadata,
    };
}
