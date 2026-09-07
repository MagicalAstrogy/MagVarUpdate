/**
 * Pi SDK 唯一的运行时导入入口。
 *
 * 只导出 MVU 支持的协议适配器和模型目录，不导入内置服务商工厂或聚合入口。
 * 服务商注册与 OAuth 由应用管理，避免浏览器引入 Pi 的 Node 回调流程。
 * 生产环境通过带固定版本的浏览器 ESM 加载这些入口。
 */
export {
    Type,
    calculateCost,
    clampThinkingLevel,
    createAssistantMessageEventStream,
    createModels,
    createProvider,
} from '@earendil-works/pi-ai';

export type {
    Api,
    ApiKeyCredential,
    ApiStreamOptions,
    AssistantMessage,
    AssistantMessageEvent,
    AssistantMessageEventStream,
    AuthCheck,
    AuthContext,
    AuthInteraction,
    AuthOperationOptions,
    AuthResult,
    AuthType,
    Context,
    CreateModelsOptions,
    CreateProviderOptions,
    Credential,
    CredentialInfo,
    CredentialStore,
    FetchFunction,
    Message,
    Model,
    ModelAuth,
    Models,
    MutableModels,
    OAuthAuth,
    OAuthCredential,
    Provider,
    ProviderAuth,
    ProviderHeaders,
    ProviderRequestOptions,
    ProviderStreams,
    SimpleStreamOptions,
    StopReason,
    StreamOptions,
    TextContent,
    ThinkingContent,
    ThinkingBudgets,
    Tool,
    ToolCall,
    ToolChoice,
    Usage,
    UserMessage,
} from '@earendil-works/pi-ai';

export { ANT_LING_MODELS } from '@earendil-works/pi-ai/providers/ant-ling.models';
export { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
export { BASETEN_MODELS } from '@earendil-works/pi-ai/providers/baseten.models';
export { CEREBRAS_MODELS } from '@earendil-works/pi-ai/providers/cerebras.models';
export { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models';
export { FIREWORKS_MODELS } from '@earendil-works/pi-ai/providers/fireworks.models';
export { GITHUB_COPILOT_MODELS } from '@earendil-works/pi-ai/providers/github-copilot.models';
export { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
export { GROQ_MODELS } from '@earendil-works/pi-ai/providers/groq.models';
export { HUGGINGFACE_MODELS } from '@earendil-works/pi-ai/providers/huggingface.models';
export { KIMI_CODING_MODELS } from '@earendil-works/pi-ai/providers/kimi-coding.models';
export { MINIMAX_MODELS } from '@earendil-works/pi-ai/providers/minimax.models';
export { MINIMAX_CN_MODELS } from '@earendil-works/pi-ai/providers/minimax-cn.models';
export { MISTRAL_MODELS } from '@earendil-works/pi-ai/providers/mistral.models';
export { MOONSHOTAI_MODELS } from '@earendil-works/pi-ai/providers/moonshotai.models';
export { MOONSHOTAI_CN_MODELS } from '@earendil-works/pi-ai/providers/moonshotai-cn.models';
export { NVIDIA_MODELS } from '@earendil-works/pi-ai/providers/nvidia.models';
export { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
export { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
export { OPENCODE_MODELS } from '@earendil-works/pi-ai/providers/opencode.models';
export { OPENCODE_GO_MODELS } from '@earendil-works/pi-ai/providers/opencode-go.models';
export { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models';
export { QWEN_TOKEN_PLAN_MODELS } from '@earendil-works/pi-ai/providers/qwen-token-plan.models';
export { QWEN_TOKEN_PLAN_CN_MODELS } from '@earendil-works/pi-ai/providers/qwen-token-plan-cn.models';
export { QWEN_TOKEN_PLAN_INDIVIDUAL_MODELS } from '@earendil-works/pi-ai/providers/qwen-token-plan-individual.models';
export { TOGETHER_MODELS } from '@earendil-works/pi-ai/providers/together.models';
export { VERCEL_AI_GATEWAY_MODELS } from '@earendil-works/pi-ai/providers/vercel-ai-gateway.models';
export { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models';
export { XIAOMI_MODELS } from '@earendil-works/pi-ai/providers/xiaomi.models';
export { XIAOMI_TOKEN_PLAN_AMS_MODELS } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-ams.models';
export { XIAOMI_TOKEN_PLAN_CN_MODELS } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn.models';
export { XIAOMI_TOKEN_PLAN_SGP_MODELS } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp.models';
export { ZAI_MODELS } from '@earendil-works/pi-ai/providers/zai.models';
export { ZAI_CODING_CN_MODELS } from '@earendil-works/pi-ai/providers/zai-coding-cn.models';

export { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
export { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
export { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
export { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
export { mistralConversationsApi } from '@earendil-works/pi-ai/api/mistral-conversations.lazy';
export { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';

export {
    convertMessages as convertGoogleMessages,
    convertTools as convertGoogleTools,
    isThinkingPart as isGoogleThinkingPart,
    // 本地 Google SDK 可能先于 Pi 固定的 SDK 版本增加枚举值，停止原因仍沿用 Pi 的映射。
    mapStopReasonString as mapGoogleStopReason,
    resolveGoogleFunctionCallingMode,
    resolveGoogleThinkingLevel,
    retainThoughtSignature as retainGoogleThoughtSignature,
    retryGoogleRequest,
    supportsGoogleStrictToolSampling,
} from '@earendil-works/pi-ai/api/google-shared';
export type {
    GoogleApiThinkingLevel,
    ResolvedGoogleThinkingLevel,
} from '@earendil-works/pi-ai/api/google-shared';
export { buildBaseOptions } from '@earendil-works/pi-ai/api/simple-options';
