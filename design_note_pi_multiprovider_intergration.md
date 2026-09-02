# pi 多 Provider 集成设计说明

> 状态：设计提案
> 日期：2026-09-01
> 范围：MVU 的额外模型请求，复用 TavernHelper `generate` / `generateRaw` 生成提示词

## 结论

在以下约束成立时，这项工作的复杂度从“重写 SillyTavern 生成链路”的高复杂度，下降为**中等复杂度的边界拆分与适配**：

- Slash-Runner / SillyTavern 继续负责宏、正则、角色卡、世界书、聊天历史、深度注入和 token 裁剪。
- MVU 给 `generate` / `generateRaw` 指定 `generation_id`，在提示词完成事件中复制结果，再用
  `stopGenerationById` 只中止这一次生成。
- pi 只负责模型目录、鉴权、Provider 协议、流式响应、工具调用和错误/中止归一化。
- Slash 提示词到 pi 是单向转换；pi 的回复不写回 SillyTavern，也不追加到 pi `Context`。
- API key 和 Provider 配置可以保存在前端上下文，不建设 SillyTavern 服务端代理。

估算（单人开发日，包含必要测试）：

| 交付范围                       |            估算 | 说明                                                                           |
| ------------------------------ | --------------: | ------------------------------------------------------------------------------ |
| 文本 MVP                       |      **3–6 天** | 定向捕获、OpenAI/Anthropic/Google、文本历史、流式、中止、结果归一化            |
| 覆盖当前 MVU 主要能力          |     **6–10 天** | 再加入图片、工具、`required` tool choice、结构化输出和请求参数兼容             |
| 尽量逐项复刻所有 Provider 特例 | **9–14 天以上** | 后置 system 的精细策略、tool 历史、签名、自定义 body、跨 Provider token 预算等 |

推荐目标是第二档，但按“文本链路 → 工具调用 → 图片/高级兼容”三阶段落地。原先最大的两个成本项——回复写回和后端密钥托管——已经不在范围内。

## 分析基线

- workspace：`1af7c66e7f5e836a4c7f6cf84ebde2f029e09229`
- Slash-Runner：`c1d0953bf1a5ca4ff28eea513fc1362eef81b80c`，4.9.1
- SillyTavern：`51ad27fb86d39a3daca3adaa970375c9670c12df`，1.18.0
- pi：`853a80d26c90a14c1886f0ebb8ffaae133ca2185`，`@earendil-works/pi-ai` 0.84.4

pi 的当前文档和类型基线：

- [pi-ai README](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/README.md)
- [pi Context / Message / Tool 类型](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/src/types.ts#L421-L525)
- [Browser Usage](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/README.md#browser-usage)
- [Cross-Provider Handoffs](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/README.md#cross-provider-handoffs)

## 1. 提示词获取：复用 `generate` / `generateRaw` 并按 ID 中止

Slash-Runner 没有正式的 prompt-only API，但现有公开能力已经足以复用提示词构建路径：

TavernHelper 同时公开了 `generate`、`generateRaw` 和 `stopGenerationById`，见
[slash-runner/src/function/index.ts](slash-runner/src/function/index.ts#L59-L66) 与同文件的
[公开对象注册](slash-runner/src/function/index.ts#L336-L343)。

`GenerateConfig` / `GenerateRawConfig` 都接受 `generation_id`。`iframeGenerate`
在开始提示词处理前就把该 ID 和 `AbortController` 注册进
`generationControllers`；`stopGenerationById(id)`
只 abort 对应 controller，不会停止其他 TavernHelper generation。

但是，所需能力已经存在于内部，`generateRaw` 的前半段本身就是完整的提示词准备流水线：

1. `processUserInputWithImages`：宏、正则、图片预处理。
2. `prepareAndOverrideData`：角色卡、世界书、聊天历史、作者注释、persona 和覆盖项。
3. `handleCustomPath`：按 `ordered_prompts` 组装
   `ChatCompletion`，执行深度注入和 token 裁剪，最后得到 `prompt`。
4. `GENERATE_AFTER_DATA` 后才进入 `generateResponse` 发请求。

对应编排见
[slash-runner/src/function/generate/index.ts](slash-runner/src/function/generate/index.ts#L316-L370)，最终数组由
[handleCustomPath](slash-runner/src/function/generate/generateRaw.ts#L472-L542) 返回。

因此不必再从 `iframeGenerate` 抽出一套 `prepareGenerateRaw`。可以让现有流程正常执行第 1–3 步，在
`GENERATE_AFTER_DATA` 中复制 `generate_data.prompt`，随后按本次 ID 中止，在第 4 步前退出。

### 和 Prompt Viewer 的区别

Prompt Viewer 会调用 SillyTavern `Generate('normal')`，等到 `CHAT_COMPLETION_SETTINGS_READY`
后执行全局 `stopGeneration()`。它还要求当前主 API 是 OpenAI chat completion 且处于已连接状态，见
[PromptViewer.vue](slash-runner/src/panel/toolbox/PromptViewer.vue#L290-L330)。

这里复用的是 Prompt Viewer 的“请求前捕获”思路，不直接复用它的实现：

- Prompt Viewer 发起的是 SillyTavern 原生 `Generate('normal')`，不在 Slash 的
  `generationControllers` 中，不能用 `stopGenerationById` 管理。
- Prompt Viewer 使用全局 `stopGeneration()`；新方案发起 Slash `generate/generateRaw`，使用定向
  `stopGenerationById(id)`。
- 新方案监听更早且已经包含最终消息数组的 `GENERATE_AFTER_DATA`，不需要等
  `CHAT_COMPLETION_SETTINGS_READY`，也不依赖当前 API 已连接。

### 需要对 Slash-Runner 补的两个最小契约

目前 `GENERATE_AFTER_DATA` 没有携带 ID。为了在并发生成中可靠关联 prompt，应增加可选的第三个参数：

```ts
await eventSource.emit(event_types.GENERATE_AFTER_DATA, generate_data, false, generationId);
```

对应监听器类型改成：

```ts
[tavern_events.GENERATE_AFTER_DATA]: (
    generate_data: { prompt: SendingMessage[] },
    dry_run: boolean,
    generation_id?: string
) => void;
```

第三个参数是可选的：SillyTavern 原生 generation 仍只发前两个参数，旧监听器也会自然忽略新增参数。

不修改 Slash 时，在严格 single-flight 环境中也能立即试验：监听到任意 `GENERATE_AFTER_DATA`
后复制 prompt，再停止自己已知的 ID。但现有 `is_analysis_in_progress`
只串行化 MVU 额外请求，不能阻止主聊天或其他扩展同时发出同名事件，因此生产版本仍应给事件补 ID，不能靠时间顺序猜关联关系。

事件监听器调用 `stopGenerationById` 后，当前代码仍会继续进入
`generateResponse`。虽然预先 aborted 的 signal 通常会令 fetch 立即失败，但为了严格保证不进入 Provider 阶段，应在事件后增加 guard：

```ts
await eventSource.emit(event_types.GENERATE_AFTER_DATA, generate_data, false, generationId);

if (abortController.signal.aborted) {
    throw abortController.signal.reason ?? new DOMException('Generation aborted', 'AbortError');
}

return await generateResponse(/* ... */);
```

这两个改动不新增公开业务 API，也不复制提示词逻辑。现有 `iframeGenerate` 的 `finally`
仍负责图片监听器、controller 和按钮状态清理；还应加测试确保一次性 inject 在 `GENERATION_STOPPED`
后被清除。

### MVU 捕获包装器

MVU 侧实现一个同时支持 `generate` / `generateRaw` 的包装器：

```ts
async function capturePrompt<T extends GenerateConfig | GenerateRawConfig>(
    run: (config: T) => Promise<unknown>,
    config: T
): Promise<SendingMessage[]> {
    const generationId = crypto.randomUUID();
    let captured: SendingMessage[] | undefined;

    // 放到已有监听器最后，复制它们处理完成后的最终 prompt。
    const subscription = eventMakeLast(
        tavern_events.GENERATE_AFTER_DATA,
        (generateData, _dryRun, eventGenerationId) => {
            if (eventGenerationId !== generationId) return;
            captured = structuredClone(generateData.prompt);
            stopGenerationById(generationId);
        }
    );

    try {
        await run({
            ...config,
            generation_id: generationId,
            should_silence: true,
        });
    } catch (error) {
        // 只有已经成功捕获 prompt 时，才把这次定向 abort 当作正常控制流。
        if (!captured) throw error;
    } finally {
        subscription.stop();
    }

    if (!captured) throw new Error('Generation ended without a captured prompt');
    return captured;
}
```

生产实现还应检查 `stopGenerationById`
的返回值，并把“已捕获后的预期 abort”和用户取消、提示词构建失败区分开。 `GENERATE_AFTER_DATA`
的 emit 会 await 各监听器；使用 `eventMakeLast`
可先让已有监听器完成 prompt 修改，再执行定向 stop。`structuredClone`
则避免捕获完成后继续共享同一个 prompt 对象。

## 2. 目标数据流

```text
generate / generateRaw prompt 配置 + generation_id
        │
        ▼
Slash-Runner 现有 iframeGenerate 前半段
（宏/正则/角色卡/世界书/历史/注入/token 裁剪）
        │
        ▼
await GENERATE_AFTER_DATA(prompt, generation_id)
        │
        ├── MVU 复制 prompt
        └── stopGenerationById(generation_id)
                │
                ▼
        abort guard：不进入 generateResponse
        │
        ▼
MVU 边界适配器：toPiContext + toPiRequestOptions
        │
        ▼
pi Context / Tool / StreamOptions
        │
        ▼
pi Models.streamSimple(model, context, options)
        │
        ▼
MVU 现有 string / GenerateToolCallResult 兼容结果
```

pi 的最终 `AssistantMessage` 只转换成 MVU 当前解析器能消费的返回值，不执行下面两件事：

```ts
// 不做
context.messages.push(finalMessage);
// 不做
SillyTavern.chat.push(...);
```

因此无需实现跨轮 pi context 持久化、回复写回、reasoning signature 回放或 tool-result 续轮。

`generate` 和 `generateRaw` 共用 `iframeGenerate`，所以三种现有破限方案都可以走同一个捕获机制：

- “使用当前预设”：捕获 `generate`。
- “使用其他预设”：捕获现有的 preset → `generateRaw` 转换结果。
- 默认自定义 ordered prompts：捕获 `generateRaw`。

## 3. `SendingMessage[]` 到 pi `Context`：需要自己写吗？

**需要写一个本项目自己的薄适配器。**

pi 能做的是：把已经符合 pi `Context` / `Message`
类型的数据转成各 Provider 的原生 payload；也能把一个 pi Provider 产生的完整 `AssistantMessage`
转交给另一个 Provider。它没有提供“OpenAI/SillyTavern 消息数组 → pi Context”的公开入口。

pi 内部的 `transformMessages` 也不是反向导入器：它接收的参数已经是 pi
`Message[]`，用途是图片降级、thinking 处理和 tool call id 规范化。

### 文本映射表

| Slash / ST 输入    | pi 输出                | 工作量与注意点                                                                |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------- |
| 前置 `system`      | `Context.systemPrompt` | 多条按原顺序用 `\n\n` 合并                                                    |
| `user` 字符串      | `UserMessage`          | 加 `timestamp` 即可                                                           |
| `assistant` 字符串 | `AssistantMessage`     | 必须包装成 text block，并补齐 `api/provider/model/usage/stopReason/timestamp` |
| 后置/中途 `system` | 附着到最近的 `user`    | pi 没有 system message；必须制定语义策略，不能只改字段名                      |
| `name`             | 文本前缀或忽略         | pi message 没有通用 `name` 字段；推荐保留为显式前缀                           |
| 空 content         | 丢弃或空 text block    | 由 strict/lenient 模式决定                                                    |

历史 `assistant` 不能直接写成下面这样：

```ts
// 不符合 pi AssistantMessage，也会让部分 Provider converter 误处理
{ role: 'assistant', content: 'old reply' }
```

应转换为类似：

```ts
{
  role: 'assistant',
  content: [{ type: 'text', text: 'old reply' }],
  api: 'sillytavern-import',
  provider: 'sillytavern',
  model: 'prepared-prompt',
  usage: ZERO_USAGE,
  stopReason: 'stop',
  timestamp: Date.now(),
}
```

这些元数据只是为了满足 pi 的统一历史消息契约。由于这里只含普通文本，pi 会把它当作跨 Provider 历史并正确转换，不需要伪造为当前目标模型的真实回复。

### 当前项目不能忽略“后置 system”

pi 的 `Context` 只有一个顶层 `systemPrompt`，没有可以放入 `messages` 的 system
role。另一方面，当前 MVU 默认额外模型提示词在 `chat_history` 之后仍会插入 `system`，甚至在
`user_input` 之后还有一个 system tail，见
[invoke_extra_model.ts](src/function/update/invoke_extra_model.ts#L574-L591)。世界书/作者注释的深度注入也可能产生中途 system。

因此推荐适配器提供两种模式：

```ts
type LateSystemPolicy = 'attach-to-nearest-user' | 'strict';
```

- `attach-to-nearest-user`（默认）：
    - 第一个 user/assistant 之前的连续 system 合并进 `systemPrompt`。
    - 对话开始后的 system 保持文本相对顺序，使用明确边界标记附着到最近的 user；位于最终 user 后的 system
      tail 追加到该 user。
    - 记录 diagnostics，例如移动了几条 system、附着到哪个消息。
- `strict`：发现非前置 system 就抛错，用于测试和发现提示词结构变化。

建议边界标记采用不与现有提示词冲突的固定标签，例如：

```text
<system_injection source="sillytavern">
...
</system_injection>
```

将所有 system 无条件挪到 `systemPrompt`
虽然最简单，但会把当前的 task/tail 从历史之后移动到最前面，语义变化过大，不建议作为默认行为。

如果未来要求 OpenAI 路径逐条保留原生 system role，可以用 `onPayload`
做 OpenAI 专用覆盖；Anthropic 和 Gemini 的原生协议仍只有顶层 system/instruction，因此这不能成为统一的多 Provider 方案。

### 图片、视频和历史工具消息

这些不是文本 MVP 的阻塞项，但完整兼容时需要处理：

| ST 内容                | pi 内容                          | 策略                                                           |
| ---------------------- | -------------------------------- | -------------------------------------------------------------- |
| `{type:'text', text}`  | `{type:'text', text}`            | 直接转换                                                       |
| data URL `image_url`   | `{type:'image', data, mimeType}` | 拆出 MIME 和纯 base64；Slash 当前图片路径正好主要产生 data URL |
| 远程 `image_url`       | 同上                             | 先 fetch 并转 base64，或 strict 模式拒绝                       |
| `video_url`            | 无对应类型                       | MVP 明确拒绝，不静默丢失                                       |
| assistant `tool_calls` | pi `ToolCall` block              | 解析 `function.arguments` JSON，并保留 call id/name            |
| ST `role:'tool'`       | pi `ToolResultMessage`           | 需要从相邻 tool call 找到 `toolName`                           |

若实际 MVU prompt
fixtures 中没有历史 tool/video，可以把最后两项放到后续阶段，而不是为了类型上的可能性扩大首版范围。

## 4. 请求参数、Tools 和结构化输出的具体映射工作

因为捕获完成后不会进入 `generateResponse`，调用 Slash 时只需传递会影响提示词构建的字段：preset、
`user_input`、图片、overrides、injects、ordered
prompts 和历史长度。下列响应/Provider 字段不再交给 Slash，而是由 MVU 直接映射到 pi：

- `should_stream`、`custom_api`
- `tools`、`tool_choice`、`json_schema`
- key、model、采样参数和自定义 headers/body

这会绕开 Slash `responseGenerator` 中的临时 `oai_settings` 修改、options
injector、ST 后端请求和结果解析。现有为了 ST 请求兼容而设置/恢复 `custom_include_body`
的代码，在 pi 路径稳定后也可以删除。

消息适配完成后，pi 负责 Provider payload 转换；MVU 只保留以下边界映射：

| 当前 `GenerateRawConfig` / `custom_api`          | pi                                            | 说明                                                    |
| ------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| `apiurl`、`source`                               | Provider / Model 的 `baseUrl`、`api`          | 自定义 OpenAI-compatible endpoint 建动态 Provider/Model |
| `key`                                            | `apiKey` 或前端 `CredentialStore`             | 当前约束允许前端保存，不需要 ST 服务端中转              |
| `model`                                          | `models.getModel(provider, model)`            | 找不到时给出明确配置错误                                |
| `max_tokens`                                     | `maxTokens`                                   | 控制 pi 回复上限；Slash prompt 预算见下一节             |
| `temperature`                                    | `temperature`                                 | 通用字段                                                |
| `top_p/top_k/frequency_penalty/presence_penalty` | `samplingParams` 或 Provider-specific options | `samplingParams` 只对 OpenAI-compatible adapters 生效   |
| `custom_include_headers`                         | `headers`                                     | 可以直接映射                                            |
| `custom_include_body/custom_exclude_body`        | `onPayload`                                   | payload 已是 Provider 原生结构，必须按 API 分支使用     |
| `tools`                                          | `Context.tools`                               | OpenAI JSON Schema 包装成 pi/TypeBox `TSchema`          |
| `tool_choice`                                    | simple 或 Provider-specific `toolChoice`      | 见下节                                                  |
| `json_schema`                                    | constrained tool 或 Provider-specific payload | 没有完全统一的顶层 response-format 选项                 |

pi 的内置模型目录只收录支持 tool calling 的模型。对于 MVU 现有“任意 URL + 任意 model
id”的自定义配置，不能假定 `models.getModel` 总能命中内置目录；应按该配置创建动态 OpenAI-compatible
Provider/Model，并补齐
`contextWindow`、`maxTokens`、输入模态等模型元数据。自定义端点还必须允许浏览器 CORS，pi 能发浏览器请求，但不能绕过浏览器的同源策略。

### Tool 定义

Slash 的工具定义已经接近 pi，只需去掉 OpenAI 外层并把 JSON Schema 包装/断言成 TypeBox schema：

```ts
const piTool: Tool = {
    name: slashTool.function.name,
    description: slashTool.function.description ?? '',
    parameters: Type.Unsafe(
        slashTool.function.parameters ?? {
            type: 'object',
            properties: {},
        }
    ),
};
```

需要在边界处校验 schema 是 object，避免把无效 schema 推迟到不同 Provider 才报出不同错误。

### `tool_choice`

pi 的 provider-neutral `streamSimple` 只统一了 `auto | none`。当前 MVU 的工具调用模式使用
`required`，因此必须按 `model.api` 分支到完整 `stream` options：

- OpenAI completions/responses：`required` 或指定函数。
- Anthropic：`any` 或 `{ type: 'tool', name }`。
- Google：`any`；指定函数是否可用取决于所选 API/模型能力。

这部分不是重新实现协议，只是一个小型的 capability/option 路由器；不应通过不受类型约束的统一 `as any`
把同一个值塞给所有 Provider。

### `json_schema`

pi 的统一 constrained sampling 是挂在 `Tool.constrainedSampling`
上的，不等同于所有 Provider 都有统一的顶层 `response_format.json_schema`。

对当前 MVU，推荐首选现有“工具调用”输出模式：

1. 把 `MVU_TOOL_DEFINITION` 映射成 pi `Tool`。
2. 设置 `constrainedSampling: { type: 'json_schema', strict: 'prefer' }`。
3. 按 Provider 把 tool choice 映射为 required/any。
4. pi 返回的 `ToolCall.arguments` 已经是对象，归一化回 MVU 现有结果时再 `JSON.stringify`。

“直接输出 JSON 文本”的 `json_schema` 模式可以在第二阶段用 Provider-specific options / `onPayload`
支持。首版若同时要求所有 Provider 的强制 JSON 文本完全一致，复杂度会明显上升。

### 保持现有 MVU 下游不变

建议新增 `fromPiAssistantMessage`，把 pi 返回值转换回当前代码已经支持的两类结果：

```ts
type ExistingResult = string | GenerateToolCallResult;
```

- 所有 text blocks 拼成 string。
- 若存在 toolCall blocks，返回 `{ content, tool_calls }`。
- `ToolCall.arguments` 用 `JSON.stringify` 转回当前 Slash/OpenAI 形状。
- thinking 内容默认不混入业务结果；错误、aborted、length 分别转成明确异常或状态。

这样 `extractFromGenerateToolCallResult`、格式化输出解析和变量更新主流程无需一起重写。

## 5. Token 预算仍是独立风险，但不阻塞捕获方案

当前 `handleCustomPath` 用 `oai_settings.openai_max_context` 和 `oai_settings.openai_max_tokens`
构建 prompt，见
[generateRaw.ts](slash-runner/src/function/generate/generateRaw.ts#L479-L481)。这两个值属于 SillyTavern 当前选中的模型，不一定等于实际要调用的 pi 模型。

如果不改：

- ST 当前是 8k、pi 目标是 128k：历史会被过早裁掉。
- ST 当前是 128k、pi 目标是 32k：Slash 可能构建出目标 Provider 拒绝的请求。

定向捕获方案会原样复用当前 ST token 预算。这一方面保证捕获结果和原 `generate/generateRaw`
一致，另一方面不能自动按 pi 目标模型重新裁剪历史。首版建议：

- 继续使用已有 `max_chat_history` 作为主要裁剪手段。
- 发送前用 pi model 的 `contextWindow` 做 preflight；超限时给出明确错误或进一步缩短历史。
- `maxTokens` 使用 `Math.min(userMaxTokens, model.maxTokens)`，并预留 5%–10% 输入估算误差。

如果后续确认“ST 当前模型预算”和“pi 额外模型预算”的差异经常造成过裁剪或超限，再给现有
`GenerateConfig/GenerateRawConfig` 增加 request-scoped `prompt_budget`。这仍只是可选增强，不需要引入
`prepareGenerateRaw`。pi 的 max-token clamp 可以作为第二道保护，但无法恢复已经被 Slash 裁掉的历史。

## 6. 推荐落地步骤

### 阶段 A：补齐定向捕获契约（0.5–1 天）

- 给 Slash 发出的 `GENERATE_AFTER_DATA` 增加可选 `generation_id`，更新事件类型。
- 在该 awaited 事件后、`generateResponse` 前增加 aborted guard。
- 测试被捕获请求不进入 `generateResponse`/fetch，其他 generation id 不受影响。
- 验证图片监听器、controller、按钮状态和一次性 inject 的异常清理。

### 阶段 B：捕获包装器与文本 pi 路径（2–4 天）

- 新增同时支持 `generate` / `generateRaw` 的 `capturePrompt`，按事件 ID 过滤并复制 prompt。
- 将现有配置拆成“Slash prompt 配置”和“pi request 配置”，不再让 Slash 进入 Provider 阶段。
- 只按需注册 OpenAI、Anthropic、Google Provider；不要导入 `providers/all`。
- 新增 `toPiContext`、late-system policy 和 diagnostics。
- 新增模型/密钥解析、stream、AbortController 和文本结果归一化。
- 在 [invoke_extra_model.ts](src/function/update/invoke_extra_model.ts)
  切换三条请求路径，包括“使用当前预设”。

### 阶段 C：当前 MVU 输出能力（3–4 天）

- Tool schema 和 required/any/named tool choice 路由。
- pi `AssistantMessage` → 现有 `GenerateToolCallResult`。
- JSON schema 文本模式的 Provider-specific 支持或明确降级。
- 图片 data URL 转换。
- payload 快照与至少三类 API adapter 测试。

## 7. 测试与验收标准

至少覆盖：

1. `generate` 和 `generateRaw` 的提示词事件都携带正确 `generation_id`。
2. 捕获器忽略 SillyTavern 原生的无 ID 事件和其他 ID；并发请求不会串 prompt。
3. 捕获监听器排在已有 `GENERATE_AFTER_DATA` 监听器之后，复制的是它们修改完成的 prompt。
4. 捕获后只停止目标 ID，不触发 `generateResponse`、ST backend fetch 或全局停止按钮。
5. 只有成功捕获后的定向 abort 会被吞掉；构建失败和用户取消仍正常抛出。
6. 宏、正则、世界书、角色卡覆盖、历史裁剪、深度注入与旧请求在发送前的 prompt 一致。
7. 前置多条 system 的顺序不变。
8. 当前 `invoke_extra_model` 中 chat history 后和 final
   user 后的 system 不会静默丢失；strict 模式能报错。
9. user/assistant 文本在 OpenAI、Anthropic、Google payload 中角色正确。
10. pi 回复不写入 `SillyTavern.chat`，也不追加到 `Context.messages`。
11. AbortController 能终止 pi 请求并与普通 Provider 错误区分。
12. tool mode 能继续产出当前 MVU 解析器可消费的 `GenerateToolCallResult`。
13. 图片模式对 data URL 正确拆 MIME/base64，对 video/remote URL 明确拒绝或告警。
14. webpack 生产构建只包含选定 Provider；Node 24.15.0 满足 pi 包声明的 Node 要求。

## 8. 最终建议

采用下面的边界，而不是在 MVU 内复刻 SillyTavern prompt builder：

```text
Slash-Runner       = prompt compiler + per-ID abort
MVU capture layer  = GENERATE_AFTER_DATA → cloned ST message IR
MVU message adapter= ST message IR → pi Context
pi-ai              = provider runtime
```

最值得先做的是给 `GENERATE_AFTER_DATA` 补 `generation_id`，并在事件后增加 aborted
guard。这样只需两个很小的 Slash 改动，就能把 MVU 与 pi 之间的边界固定成一个可测试的消息数组，同时完整复用
`generate` 和 `generateRaw` 的提示词语义。

后续确实因此简化：不再新增 prompt-only API、不拆分
`iframeGenerate`、不新增 preset-path 版本，也不进入 Slash 的 Provider 参数注入、后端请求和响应解析。仍然不能省掉的是 ST 消息 IR
→ pi `Context` 的语义适配，特别是历史 assistant、后置 system、图片和工具历史。

首版推荐决策：

- late system：`attach-to-nearest-user`，同时输出 diagnostics。
- 结构化输出：工具调用作为跨 Provider 主路径。
- prompt 预算：首版沿用 ST + `max_chat_history`，pi 侧 preflight；有实际问题再加 request-scoped
  budget。
- 当前 preset 模式：和 raw 模式使用同一个 per-ID 捕获器，不再单独保留旧 Provider 路径。
- Provider：按需导入，不使用 `providers/all`。
