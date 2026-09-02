/**
 * The only runtime import boundary for pi-ai.
 *
 * Keep this module limited to the adapters and catalogs that MVU supports. In particular, do
 * not import built-in provider factories or the aggregate provider entry point: the application
 * owns provider registration and OAuth orchestration so the browser bundle cannot pull in pi's
 * Node callback flows.
 */
export { Type, createModels, createProvider } from '@earendil-works/pi-ai';

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
    Tool,
    ToolCall,
    ToolChoice,
    Usage,
    UserMessage,
} from '@earendil-works/pi-ai';

export { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
export { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
export { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
export { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';

export { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
export { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
export { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
export { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
export { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
