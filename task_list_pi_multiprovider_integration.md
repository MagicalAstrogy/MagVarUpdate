# pi 多 Provider 集成任务清单

> 来源：[design_note_pi_multiprovider_intergration.md](design_note_pi_multiprovider_intergration.md)
> 用户文档：[doc/pi_multiprovider_integration.md](doc/pi_multiprovider_integration.md)
> 状态：主体实现、34 来源目录和按 Provider/API 审计的 SillyTavern
> Proxy 路由已接入；2026-09-05 分支 review 修复及全仓自动化/构建复跑已完成，真实 OAuth/Provider 浏览器发布验收仍归 H-03
>
> 目标范围：覆盖当前 MVU 主要能力
>
> 预计工作量：单人 7–12 个开发日（含浏览器 OAuth 与必要测试）
>
> 捕获方案更新：固定 custom 通道 + 唯一 model marker + 请求级末位 `CHAT_COMPLETION_SETTINGS_READY`
> 监听，不修改 SillyTavern 或 Slash-Runner

## 范围与优先级

- **P0 / 文本 MVP**：定向捕获、文本消息适配、pi
  API/凭据配置、浏览器 OAuth、34 个已注册来源、六种 wire API、流式、中止和结果归一化。
- **P1 / 当前能力对齐**：工具调用、`required` tool choice、结构化输出、图片和请求参数兼容。
- **P2 / 后续增强**：历史工具消息、远程图片、request-scoped prompt budget 和更多 Provider 特例。

首版明确不做：回复写回 SillyTavern、回复追加到 pi `Context`、跨轮 pi
Context 持久化、服务端密钥托管、reasoning signature 回放、视频输入、服务端 OAuth
callback/relay、修改 SillyTavern/Slash-Runner，以及导入 `providers/all`。

模型来源路由保持为：

- `与插头相同`：继续使用当前 TavernHelper/SillyTavern Provider 链路。
- `自定义`：继续使用当前 TavernHelper 自定义 API 链路。
- `更多`：进入新增的 pi 链路，并通过二级“来源”菜单选择已注册的 pi Provider。

“更多”当前列出 34 个带确定请求地址的来源：32 个使用锁定版 Pi 的 `Provider.baseUrl`，OpenCode
Zen/Go 则使用其 model catalog 给出的分 API 地址；仍不导入 `providers/all`。

pi 的来源、凭据、模型和请求参数都属于 `额外模型解析配置`，不建立独立的全局 pi 设置区。

## 开工前决策

- [x] **DEC-01（P0，已确认）确定 pi 链路入口与配置归属**
    - `模型来源` 新增 `更多`；只有该选项进入 pi 链路。
    - 选择 `更多` 后显示二级“来源”菜单，选项来自 MVU 实际注册的 pi Provider 列表。
    - pi 相关来源、凭据、模型和参数全部保存在 `额外模型解析配置` 中。
    - `与插头相同`、`自定义` 保持现有请求链路，不要求从 SillyTavern 提取服务端密钥给 pi。

- [x] **DEC-02（P0，已确认）由“更多”配置提供模型窗口元数据**
    - 选择模型来源“更多”时，显示 `contextWindow` 和现有“最大回复token数”两个输入框。
    - 只新增 `contextWindow` 配置字段；现有“最大回复token数”直接作为 pi 请求的
      `maxTokens`，不重复存储。
    - pi model catalog 命中时可用目录中的 `contextWindow`
      预填；用户填写的值优先。目录未命中时，必须填写有效值后才能请求。
    - 两个值仅接受正整数，并要求“最大回复token数”不大于
      `contextWindow`；校验失败时在请求前给出明确错误。

- [x] **DEC-03（P1，已确认）结构化输出不做降级**
    - 工具调用和“格式化输出”保持为两种独立模式，不将“格式化输出”转换为 constrained tool。
    - 只要所选 wire
      API 已实现对应请求形状，就认为工具调用/格式化输出可用并乐观发送；目录模型、动态模型和自定义 endpoint 的静态能力信息不作为请求前门禁。
    - 普通“格式化输出”已覆盖 OpenAI Responses、OpenAI Chat Completions、OpenAI Codex
      Responses、Anthropic Messages、Google 和 Mistral Conversations；v4/JSON
      Object 已覆盖除 Anthropic Messages 外的上述 API。Anthropic
      v4 请求形状尚未实现，仍在请求前明确拒绝。
    - 目标 endpoint/model 实际不支持并返回错误时，在调用边界保留错误类别，并通过 `toastr.error`
      给出经过脱敏、可操作的提示。
    - 不回退为无约束文本，不转换成工具调用，也不在失败后改用其他结构化输出策略重试。

- [x] **DEC-04（P0，已确认）确定 prompt 捕获边界**
    - 固定使用 Slash `custom` 请求路径，捕获 `CHAT_COMPLETION_SETTINGS_READY.messages`。
    - 用 `model` 中的唯一 marker 携带 `generation_id`，不修改事件参数。
    - 不在初始化阶段常驻注册捕获器；每次捕获请求都在其请求上下文内、调用 `generate`/`generateRaw`
      前通过 `eventMakeLast` 临时注册，保证位于已有 settings-ready 监听器之后。
    - 回调复制 messages 后调用现有 `stopGenerationById`；允许后续 fetch 以 aborted signal 固定失败。
    - 不修改 SillyTavern 或 Slash-Runner，也不依赖 async context 自动取消。

- [x] **DEC-05（P0，已确认）在 `Source.vue` 配置 pi API 与认证方式**
    - 模型来源“更多”下支持六种 pi wire API：`openai-responses`、`openai-completions`、
      `openai-codex-responses`、`anthropic-messages`、`google-generative-ai` 和
      `mistral-conversations`；固定 API 的内置 Provider 只展示其兼容值。
    - 认证方式支持现有 API Key 和 OAuth。OAuth 不是任意 API 的通用凭据，只对来源注册表中声明
      `auth.oauth` 的 Provider 开放，并锁定该 Provider 的兼容 API。
    - Anthropic OAuth 使用 `anthropic-messages`；OpenAI 订阅 OAuth 使用 OpenAI Codex Provider 的
      `openai-codex-responses`，不得伪装成普通 `openai-responses` API Key 请求。
    - 浏览器不启动本地 callback server。交互上按产品约定将 callback 视为 `127.0.0.1`
      loopback；授权完成后由用户从浏览器地址栏复制完整 callback URL，粘贴回 `Source.vue` 完成 code
      exchange。authorization request 与 code exchange 始终使用注册表声明的同一个精确 redirect URI。

- [x] **DEC-06（P0，已确认）列出 Pi 已知地址的来源并提供模型发现**
    - 二级“来源”菜单注册 34 个具体来源：32 个具有 Pi `Provider.baseUrl`
      预设，另加目录已提供 concrete per-API URL 的 OpenCode Zen 和 OpenCode Go。
    - Fireworks、OpenCode Zen/Go 根据所选 wire API 自动使用各自 base
      URL；其余固定来源使用注册表中的 provider base，只有既有 OpenAI/Anthropic API
      Key 来源保留自定义 endpoint。
    - 所有来源共享“获取模型列表”入口，并按 Provider 的实际目录协议选择 OpenAI-compatible、Anthropic、Google、Mistral 或 Codex
      subscription 发现；Fireworks、GitHub Copilot、OpenCode Zen/Go 与 Vercel AI
      Gateway 的 OpenAI 结构目录复用 ST status，不根据生成 wire API 错猜响应格式。
    - 共享目录中的已知模型按当前 API 过滤，未知新模型保留供手工配置；失败通过 `toastr`
      明确显示，仍允许手工填写模型 ID。
    - 来源不会按一次性的浏览器 CORS 探测结果过滤；经审计的组合使用 DEC-07 的固定 Proxy 策略，未登记的 CORS/权限变化按原错误边界呈现。
    - OAuth 仍只开放 Anthropic 与 OpenAI Codex；不因 Pi 上游存在其他 OAuth
      helper 而扩大浏览器认证范围。
    - 排除需要运行时账号、区域或资源标识才能生成 URL 的动态模板：Amazon Bedrock、Azure OpenAI
      Responses、Cloudflare AI Gateway、Cloudflare Workers AI、Google Vertex 和 Radius。
    - 继续逐项导入 model catalog 与六个 wire adapter，不导入 `providers/all` 或 provider
      factory 聚合入口。

- [x] **DEC-07（P0，已确认）按审计结果选择 SillyTavern CORS Proxy**
    - Proxy 策略按“Provider + wire
      API”精确登记，不把一个 Provider 的受限 API 推广到它的其他 API。当前 15 个组合为：Ant Ling /
      `openai-completions`；Fireworks / `anthropic-messages`；GitHub Copilot / `anthropic-messages`
      与 `openai-responses`；Kimi For Coding / `anthropic-messages`；MiniMax（中国） /
      `anthropic-messages`；NVIDIA / `openai-completions`；OpenAI Codex /
      `openai-codex-responses`；OpenCode Zen / `anthropic-messages`、
      `google-generative-ai`、`openai-completions`、`openai-responses`；OpenCode Go /
      `anthropic-messages`、`openai-completions`、`openai-responses`。
    - 二级来源和 API 下拉框对有效 Proxy 路由附加字面量 `(Proxy)`；多 API 来源按当前 API 更新标记。
    - 自定义 endpoint 不继承静态矩阵，规范化后不同于默认地址时显示“使用 Proxy”勾选框并以
      `pi.useProxy` 为准；显式默认 operation/base URL 仍遵循内置策略。该字段进入 Pi
      connection/profile 快照并随方案恢复。
    - Proxy 路由要求 SillyTavern 使用 `enableCorsProxy: true` 或 `--corsProxy`
      启用。配置区探测失败时以既有警告样式显示精确文案“没有开启Proxy”；生成和模型列表在真正请求前再次检查，未启用时通过
      `toastr`
      fail-fast，禁止静默直连。请求前检查强制刷新缓存、支持随调用取消并有 5 秒上限；实际转发阶段才发现路由关闭时也保持
      `proxy_unavailable` 的非重试分类。
    - Proxy 只用于模型生成和目录请求，不代理 OAuth
      authorize/token/refresh。只为可信、不跨站重定向的 HTTPS（或允许的 loopback
      HTTP）JSON 模型 endpoint 使用；SillyTavern HTTP Basic Auth 与上游 `Authorization`
      可能冲突，作为已知限制记录。
    - 浏览器 AbortSignal 会中止浏览器到 SillyTavern 的请求，但在 ST 收到上游响应头前，通用 Proxy 不保证把断连传播到上游；不得把本地停止等同于 Provider 已停止生成或计费。

## 里程碑 A：固定 custom 捕获通道（P0，0.5–1 天，纯 MVU）

- [x] **A-01 定义捕获通道常量与配置构造器**
    - 固定 `source: 'custom'`、`should_stream: false`、`should_silence: true`。
    - model 使用保留前缀和请求 ID，例如 `mvu-pi-prompt-capture:${generationId}`。
    - endpoint 固定为 `.invalid` 域名，key 为空；显式清空 custom
      headers/body，避免继承或泄漏真实配置。
    - pi 的实际来源、endpoint、key、model 和采样参数绝不传给 Slash 捕获请求。

- [x] **A-02 定义 marker 编解码与校验规则**
    - 每次捕获使用唯一 `generation_id`；marker 必须精确还原该 ID，不能只使用所有请求共用的常量。
    - 仅处理 marker 前缀正确且 ID 存在于 pending capture map 的事件。
    - 非法、未知、已结束和普通 custom model 事件全部忽略。

- [x] **A-03 实现请求级 `CHAT_COMPLETION_SETTINGS_READY` 捕获监听器**
    - 将监听器构造和注册封装为 request-scoped helper，不在 MVU 初始化入口注册常驻捕获监听器。
    - 每次请求在 pending 状态就绪后、调用 `generate`/`generateRaw` 的前一刻执行
      `eventMakeLast`，获取已有 MVU/扩展监听器处理后的最终 `generateData.messages`。
    - marker 命中后先 `structuredClone`，再调用 `stopGenerationById(generationId)`。
    - 记录 `markerMatched`、`captured`、`stopSucceeded` 三个独立状态，供错误归一化使用。
    - 不在回调中等待永不结束的 Promise，也不依赖 throw/reject 中断事件派发。

- [x] **A-04 验证捕获链路 fail-closed 行为**
    - 以仓库当前 Slash-Runner 版本已经支持 `generation_id`、`custom_api.source/model`、
      `CHAT_COMPLETION_SETTINGS_READY`、`eventMakeLast`、`stopGenerationById` 和 fetch
      signal 透传为实现基线。
    - 不增加运行时版本探测、API 能力探测、“更多”版本门禁或升级提示分支。
    - 即使监听器未命中或 stop 失败，请求也只能携带空凭据访问 `.invalid`
      endpoint，然后作为真实错误抛出。
    - 通过自动化测试固定上述 Slash 调用契约及安全兜底，避免后续依赖升级造成静默回归。
    - `yarn test:pi:st-capture` 在隔离的 ST 1.18.0 / TavernHelper 4.9.3 / Firefox
      154.0.1 中实际观察到一次 backend fetch：显式 signal 已 aborted，请求体仅含 fixed
      custom、`.invalid`、空 key 与唯一 marker，且不含 Pi Provider
      endpoint/key/model；原生 fetch 以 abort 拒绝，清理通过。

## 里程碑 B：prompt 捕获层（P0）

- [x] **B-01 实现 `capturePrompt`**（依赖 A）
    - 同时包装 `generate` 和 `generateRaw`；优先沿用调用方传入的唯一
      `generation_id`，未传入时再生成 UUID。
    - 同一个 ID 贯穿“Slash prompt 构建”和“pi Provider 请求”，供并发落败请求与手动停止定向取消。
    - 将调用方配置与 A-01 的固定 capture
      config 合并，覆盖所有 Provider/响应字段但保留 prompt 构建字段。
    - 调用顺序固定为：登记 pending 状态 → 在当前请求上下文执行 `eventMakeLast` → 立即调用
      `generate`/`generateRaw`。
    - 保存该次注册返回的 stop handle，并在 `finally` 中注销监听、清理 pending
      map；不同请求不共享监听器实例。
    - 返回捕获到的 `generateData.messages`，不使用固定失败请求的响应内容。

- [x] **B-02 区分正常捕获与真实失败**
    - 仅在 `markerMatched && captured && stopSucceeded` 时吞掉后续固定 Error。
    - 不依赖 `AbortError`、`TypeError`、字符串 reason 或具体错误文本，因为浏览器/stream
      wrapper 可能改变错误形状。
    - 用户取消、prompt 构建失败、stop 返回 `false`、未收到目标事件和 `.invalid`
      fallback 失败均作为真实错误抛出。
    - 不把现有 `is_analysis_in_progress` 当成事件关联机制。

- [x] **B-03 建立捕获层测试**
    - `generate`、`generateRaw` 都使用 fixed custom config，并产生可还原请求 ID 的唯一 marker。
    - 忽略普通 custom model、无效 marker 和其他 pending ID；多个并发捕获不会串 prompt 或互相 stop。
    - 断言捕获监听器不是初始化期常驻注册，而是在每次请求调用 `generate`/`generateRaw` 前通过
      `eventMakeLast` 注册。
    - 已有 `CHAT_COMPLETION_SETTINGS_READY`
      监听器先修改 messages，随后请求级捕获器才执行并取得修改后的深拷贝。
    - 并发请求各自持有监听器和 stop
      handle；非目标监听器只忽略事件，不会改变其他请求的注册顺序或状态。
    - stop 成功后，若 fetch 仍被调用，其 signal 已为 aborted，且 body 中没有真实 endpoint/key/model。
    - 捕获成功后的任意固定错误均被吞掉；构建失败、用户取消、缺失事件和 stop 失败不会被误吞。
    - 所有成功/失败路径都释放事件订阅、pending entry、controller 和一次性 inject。
    - 除 Jest 的成功、失败、并发与清理矩阵外，隔离浏览器 smoke 已断言 settings-ready
      marker、真实 fetch signal/body、监听器释放、`INJECTION`
      清理、宏清理、fetch 恢复和 analysis 状态复位。

- [x] **B-04 建立 prompt 回归 fixtures**
    - 覆盖宏、正则、角色卡、世界书、聊天历史、深度注入、历史裁剪和三种破限方案。
    - 比较迁移前 `CHAT_COMPLETION_SETTINGS_READY.messages` 与捕获结果，包括现有 `filterPrompts`
      修改。
    - 允许的差异必须被显式记录；marker、无效 endpoint 等捕获控制字段不得进入 messages。
    - `update:pi:st-prompt-fixtures` 在隔离 ST 1.18.0 / TavernHelper 4.9.3 / Firefox
      154.0.1 中真实执行当前预设、其他预设和内置破限两套来源；三路分别捕获 12/11/15 条 messages，Legacy 与 Pi 逐路 JSON 完全一致，`allowedDifferences`
      和 `normalization` 均为空。
    - fixtures 覆盖宏、prompt-only 正则、角色卡、世界书 update/allow/depth、世界书 plot/blacklist 过滤、聊天历史裁剪、深度注入和
      `filterPrompts` placeholder 清理；断言 capture
      marker、控制 endpoint/key/model 和临时路径均未进入 messages。

## 里程碑 C：ST 消息到 pi Context 的文本适配（P0）

- [x] **C-01 实现 `toPiContext` 基础映射**
    - 前置连续 system 按原顺序合并到 `Context.systemPrompt`。
    - user 文本转换为 `UserMessage` 并补 `timestamp`。
    - assistant 历史转换为 text
      block，并补齐 pi 所需的 provider/model/usage/stopReason/timestamp 占位元数据。
    - `name` 采用稳定的显式文本前缀；空内容行为由 strict/lenient 选项控制。

- [x] **C-02 实现 late-system policy 与 diagnostics**
    - 默认 `attach-to-nearest-user`：用固定 `<system_injection source="sillytavern">`
      边界保留相对顺序。
    - 提供 `strict` 模式，发现对话开始后的 system 即报错。
    - diagnostics 至少记录移动数量、来源索引和目标 user 索引，不记录密钥或完整敏感提示词。

- [x] **C-03 对非文本内容执行显式策略**
    - 文本 MVP 遇到 image/video/tool 历史时明确报“不支持”或返回诊断，不得静默丢弃。
    - 为 P1 的图片与工具历史转换保留可扩展的 content-block 分支。

- [x] **C-04 补齐消息适配单元测试**
    - 多条前置 system 顺序不变。
    - chat history 后、final user 后的 system 不丢失；strict 模式会失败。
    - user/assistant/name/空内容映射正确，输入对象不被修改。

## 里程碑 D：pi Provider 运行时（P0）

- [x] **D-01 引入并固定 pi 依赖**
    - 固定 `@earendil-works/pi-ai` 的目标版本，确认 Node
      24.15.0 和现有 TypeScript/webpack 配置兼容。
    - 显式注册 34 个来源各自的 model catalog 和六个所需 wire adapter，不导入 `providers/all`
      或 provider factory 聚合入口。
    - 浏览器 bundle 不得包含或执行 `node:http` callback server；OAuth 手工回调桥接使用 browser-safe
      Web Crypto/fetch 实现。

- [x] **D-02 建立 pi 来源注册表**
    - 为每个已接入来源统一声明稳定 key、双语显示名、pi provider/api、默认 base URL、能力和 adapter
      loader。
    - 为来源声明允许的 API、认证方式、OAuth 精确 redirect URI、允许粘贴的 loopback
      host、是否允许自定义 endpoint，以及对应字段显隐规则。
    - 自定义 endpoint 只允许任意有效 HTTPS，或 host 精确为 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP
      loopback；拒绝远端/内网 HTTP、其他协议、凭据、query、fragment 和非法 URL。
    - 二级菜单与运行时共用同一注册表，避免 UI 展示未打包或未实现的来源。
    - 当前注册 34 个具体来源：32 个沿用 Pi `Provider.baseUrl`，OpenCode Zen/Go 使用目录中的分 API
      URL；后续来源仍通过注册表增量加入，不导入 `providers/all`。
    - Fireworks 与 OpenCode 的 generation effective base URL 随 wire API 解析，UI、key
      scope 和请求运行时共用同一 per-wire resolver；模型发现单独使用注册过的 OpenAI-shaped discovery
      URL。
    - 每个来源显式声明 `corsProxyRequiredApis`，并由 UI、生成运行时和模型列表共用同一个
      `shouldUsePiCorsProxy` 解析规则；静态矩阵精确包含 DEC-07 的 15 个组合。

- [x] **D-03 实现模型与 Provider 解析器**（依据 DEC-02）
    - 内置模型优先走 model catalog，并用目录中的 `contextWindow` 预填配置。
    - “获取模型列表”按当前 Provider/API/auth 发现上游可见模型：OpenAI-compatible 目录复用 ST status
      route，Anthropic/Google/Mistral 使用其模型端点，Codex 使用 OAuth subscription
      catalog；Provider 的目录协议与生成协议不同时使用显式发现策略，并过滤已知的跨 API ID。
    - 未命中的自定义 OpenAI/Anthropic-compatible
      endpoint 创建动态 Provider/Model，并按 D-02 的传输安全策略校验 URL、model
      id 和模型元数据；非法地址在 fetch 前 fail-closed。
    - endpoint 规范化逻辑由运行时与 `Source.vue`
      共用；显式填写且规范化后等于 Provider 默认地址时仍视为默认 catalog 链路。其他自定义 endpoint 不继承目录模型元数据，但对 wire
      API 已实现的工具调用和格式化输出请求形状仍采用乐观发送策略。
    - 配置中的 `contextWindow`
      覆盖目录值；目录未命中时，用现有“最大回复token数”提供动态 Model 所需的
      `maxTokens`。缺少有效值时，在发请求前报错。
    - 只从当前 `额外模型解析配置` 的“更多来源”及其设置构建 pi 请求，不读取独立全局配置。
    - 校验所选来源、wire
      API、认证方式和 model 的组合；不允许 OAuth 与任意自定义 endpoint/API 自由组合。
    - 请求前检查 URL 的协议、host、凭据和 query/fragment 等传输安全条件；需要 Proxy 的 target 先检查 SillyTavern
      Proxy，可用时按受限 base
      URL 转发，不可用时归一为非重试配置错误。其他网络/CORS 失败归一为可识别的网络/配置错误。

- [x] **D-04 实现配置内的 pi `CredentialStore`**
    - 在 `额外模型解析配置` 内按 Provider ID 保存类型化 credential；实现 pi 所需的
      `read/list/modify/delete`，并串行化同一 Provider 的 `modify`，避免并发 refresh 覆盖新 token。
    - 现有“密钥”继续作为当前 API Key 槽位的可见输入；“自定义”槽保存在 `customApiKey`，Pi API
      Key 按“Provider + 规范化后的有效 endpoint”分槽保存在 `pi.apiKeys`，OAuth 的
      `access/refresh/expires` 等 `OAuthCredential` 仍按 Provider ID 保存在 `pi.credentials`。
    - 空 endpoint 解析为 Provider 默认地址后再生成 key
      scope，因此与显式 canonical 默认 endpoint 共用一槽；自定义 endpoint 使用独立槽，非法 Provider/API/auth/endpoint
      target 不读取或写入任何 Pi key 槽。
    - 切换“自定义”/“更多”、Pi Provider、endpoint 或 API
      Key/OAuth 时，先缓存原有效 target 槽再读取目标槽；OAuth 和未配置/非法 target 的活动 key 恒为空，禁止 key 跨 Provider 或 endpoint 泄漏。
    - 切换认证方式不得静默删除另一类 credential；真正替换或登出前给出确认，并保证取消操作不改写现有凭据。
    - 日志、diagnostics、错误信息和表单回显不得暴露 API Key、authorization code、access
      token 或 refresh token。

- [x] **D-05 实现浏览器手工 callback OAuth 桥接**
    - 不直接调用会启动 Node callback server 的内置 OAuth `login`；为已注册 OAuth
      Provider 实现 browser-safe PKCE/state/auth URL/code exchange，再将结果写成 pi
      `OAuthCredential`。
    - 每次登录生成独立 PKCE verifier/challenge、state 和 attempt
      ID；pending 数据只保存在内存中，不写入设置。
    - UI 默认按 `127.0.0.1` loopback 引导；authorization request 和 code
      exchange 必须原样使用 D-02 注册表中的精确 redirect URI。若上游 OAuth client 注册的是
      `localhost`，不得擅自替换redirect URI，仅把它作为等价的本机回调交互处理。
    - 接受用户粘贴的完整 callback URL，解析 `code/state/error`，按注册表校验协议、允许的 loopback
      host、port、path 和 state；成功后一次性消费 pending
      attempt，拒绝重放、过期、串请求和错误来源 URL。
    - 登录成功后由 D-04 持久化 credential；请求交给 pi 的 `refresh/toAuth` 路径自动刷新，登出通过
      `CredentialStore.delete(providerId)` 完成。
    - AbortSignal 贯穿授权等待与 token
      exchange；切换来源、关闭面板或取消登录时清理 pending 状态，不修改旧 credential。
    - OAuth authorize/token/refresh 保持浏览器直连，不使用模型请求的 SillyTavern Proxy；若 code
      exchange 被 CORS 阻止，明确报错，不静默改走服务端 relay。

- [x] **D-06 实现请求参数映射**
    - 将现有“最大回复token数”映射为 pi 请求的 `maxTokens`，并映射
      `apiKey`、`temperature`、headers 和通用 sampling 参数。
    - `top_p/top_k/frequency_penalty/presence_penalty` 只发送给明确支持的 adapter。
    - `custom_include_body/custom_exclude_body` 通过按 API 分支的 `onPayload`
      应用，并保护关键协议字段不被错误覆盖。

- [x] **D-07 实现 token preflight**
    - 沿用 Slash 的 `max_chat_history` 作为首版主要裁剪手段。
    - 按 D-03 解析出的有效 `contextWindow`
      在发送前检查输入；超限时报清晰错误或触发现有历史缩短策略。
    - 回复上限使用
      `min(最大回复token数, model.maxTokens)`；动态 Model 的两者相同。输入估算保留 5%–10% 余量。

- [x] **D-08 实现流式执行、中止和错误归一化**
    - 使用 pi stream API 聚合最终 `AssistantMessage`，同时保留流式进度接入点。
    - 将调用方 AbortSignal 贯穿到 pi 请求。
    - 明确区分用户中止、Provider 错误、协议错误、超长截断和正常完成。

- [x] **D-09 实现 pi 请求 controller 注册表**
    - 以贯穿两阶段的 `generation_id` 注册/释放 pi `AbortController`，拒绝重复 ID。
    - 提供统一的 `stopExtraModelRequestById`：同时尝试停止 Slash prompt 构建和 pi Provider 请求。
    - 将并发 `Promise.any`
      的落败请求清理与手动停止按钮切换到统一取消入口，避免 pi 请求在后台继续消耗配额。
    - 在成功、错误和 abort 的 `finally` 中清理 controller；捕获层切换到 pi 层时不得出现遗留条目。

- [x] **D-10 实现 `fromPiAssistantMessage` 文本结果**
    - 只拼接 text blocks；thinking 默认不进入业务结果。
    - 不修改 pi `Context.messages`，不写入 `SillyTavern.chat`。
    - 对空回复、仅 thinking、`length` stop reason 给出明确结果或错误。

- [x] **D-11 补齐运行时与认证测试**
    - 六种 wire API 的 payload 快照覆盖角色、system、采样参数和 headers。
    - 断言 34 来源注册表、二级菜单、model catalog 和实际 adapter
      loader 一致，并覆盖 Fireworks/OpenCode 的 per-API base URL。
    - 覆盖模型列表的各协议分支、认证、分页、去重、取消、Proxy 选择与失败归一化；网络请求使用 mock，不把未登记的 CORS 结果误当成永久 Provider 能力。
    - 覆盖目录命中、动态模型、缺密钥、未知模型、CORS/网络错误、流式完成和中止。
    - 覆盖 CredentialStore 的 provider 隔离、序列化 refresh、登录替换确认、取消不覆盖和登出删除。
    - OAuth 覆盖 PKCE/state、授权 URL、合法 callback、错误 callback、host/path/state 不匹配、重放、过期、token
      exchange/refresh 失败和中止清理；网络请求全部 mock，不使用真实账号。
    - 覆盖重复 ID、按 ID 取消、并发 winner 保留/loser 取消、手动停止和所有终态的 controller 清理。
    - 测试日志与 diagnostics 不泄漏 API key、authorization code 或 OAuth token。

- [x] **D-12 实现受限的 SillyTavern Proxy transport**（依据 DEC-07）
    - 用由 SillyTavern 本地解析的 data URL 作为无外连 sentinel，区分 `enabled`、`disabled` 和
      `unavailable`，并按 fetch/origin 缓存且合并并发探测；生成和模型列表请求强制刷新探测，等待支持取消且有 5 秒超时，瞬时
      `unavailable` 可重新探测。
    - Proxy fetch 只允许当前 Provider base origin/path 及其子路径，保留 method、headers、JSON
      body、query 和 AbortSignal；拒绝越界 URL、非 JSON/不可重放 body 和不支持的方法。
    - 生成请求与直接模型目录请求共用该 transport；原本经 ST model
      status 发现 OpenAI 结构目录的分支不做二次 Proxy 包装，但仍执行 Proxy 可用性 preflight。
    - OpenAI Codex 在 Proxy 路径强制使用 SSE。OpenCode Zen 的 `google-generative-ai`
      使用项目内请求级 Proxy-aware Google adapter；Google 直连路径继续委托上游 Pi adapter。
    - Proxy 不可用错误标记为非重试，并由现有 Pi 请求边界通过本地化 `toastr`
      显示；不向 Provider 先发一次直连请求，也不降级到其他 wire API。

## 里程碑 E：通过“更多”接入 MVU 请求流程（P0）

- [x] **E-01 增加模型来源路由**
    - `模型来源 === '更多'` 时进入 prompt capture + pi runtime。
    - `与插头相同`、`自定义` 继续走当前 TavernHelper 请求实现，保持行为与配置兼容。
    - “更多”直接使用仓库当前 Slash-Runner 提供的捕获能力，不执行额外版本或 API 能力检查。

- [x] **E-02 为“更多”实现三种 prompt 构建路径**（依赖 B、C、D）
    - “使用当前预设”：`generate` → capture → pi。
    - “使用其他预设”：preset 转换 → `generateRaw` → capture → pi。
    - 默认 ordered prompts：`generateRaw` → capture → pi。
    - 三条 pi 路径共用同一个捕获器、消息适配器和 Provider runtime。

- [x] **E-03 保持现有下游解析接口不变**
    - pi 层仍返回 `string | GenerateToolCallResult`。
    - 保持 `extractFromGenerateToolCallResult`、格式化输出解析、重试和变量更新主流程的调用契约。

- [x] **E-04 隔离旧 ST Provider 请求兼容代码**
    - `oai_settings.custom_include_body` 设置/恢复、options injector 和现有 custom
      API 参数只在旧模型来源分支执行。
    - pi 分支仅向 Slash 传递 A-01 的固定 capture config，不修改全局 ST
      Provider 设置，也不传递真实 pi 配置。
    - 旧分支仍保留现有兼容逻辑。
    - 共用仍参与 prompt 构建的 preset overrides，避免为 pi 复制 prompt builder。

- [x] **E-05 更新 `额外模型解析配置` schema 与迁移**
    - 将 `模型来源` 扩展为 `与插头相同 | 自定义 | 更多`。
    - 在同一配置对象中新增“更多来源”、pi
      `api`、认证方式、各 Provider 所需的 credential、model、endpoint、`useProxy` 和 `contextWindow`
      字段；复用现有“密钥”和“最大回复token数”，并以 `customApiKey`/`pi.apiKeys` 提供隔离的 Custom/Pi
      Provider + normalized endpoint API Key 槽位。
    - OAuth credential 按 Provider ID 保存；PKCE verifier、state、callback URL 和 authorization
      code 仅属于当前登录 attempt，不持久化。
    - 为已有设置提供默认值，旧用户继续保持原模型来源和请求行为。
    - `backend: 'pi'` API 方案保存完整连接快照：Provider、API、认证方式、endpoint、model、
      `useProxy`、`contextWindow`、custom headers/include/exclude
      body；迁移、另存和删除继续深拷贝并保留未知字段。
    - `pi.apiKeys` 与 `pi.credentials` 都不进入 `ExtraModelApiProfile`，不会把整份凭据 cache
      map 序列化进方案；切换方案时保留当前设置中的隔离 map。完整 profile 顶层的“密钥”（target
      key）只在其 Provider/API/auth/endpoint 快照安装并规范化成功后写入目标 Provider +
      endpoint 槽；非法 target 不读取任何旧槽。
    - OAuth Pi profile 和 malformed Pi profile 的顶层“密钥”恒为空；只有连接快照完整的 API Key
      target 才保存该字段，OAuth credential 仍只存在于按 Provider 隔离的 `pi.credentials`。
    - Pi profile 不保存或恢复隐藏的 Custom
      `api地址`/`模型名称`；切换 Pi 方案再切回 Custom 时，Custom
      endpoint、model 与独立 key 槽保持同一组。方案名称统一 trim 并按 first-wins 去重，
      `contextWindow` 数字字符串规范化为 number；单个 malformed 方案逐项隔离，不触发整份设置回默认。
    - 保存缺少完整连接快照的 Pi 方案时拒绝；加载或迁移 malformed `backend: 'pi'`
      方案时保留凭据 map，但清空活动 key 与连接字段，禁止与先前 Provider/endpoint/model 拼接后继续请求。
    - active 配置和 profile 中的 Provider/API/endpoint/model 统一规范化空白；未知认证值、非法 target 和 malformed
      `当前api方案`
      指针分别 fail-closed 为无活动 key/未绑定方案，不拖垮整份设置。迁移只清除无归属的根
      `密钥`，继续保留隔离的 `customApiKey`、`pi.apiKeys` 与 OAuth credential。
    - 增加缺凭据、OAuth 未登录/过期/回调无效、缺少/无效模型元数据、Provider/API不支持、CORS 和 token 超限的中英文消息。

- [x] **E-06 在 `Source.vue` 实现 pi 来源、API 与凭据 UI**
    - 模型来源增加“更多”选项；仅选中“更多”时显示 pi 来源二级菜单。
    - 二级菜单从 D-02 来源注册表生成，列出全部 34 个来源，并随来源切换展示对应配置字段和能力提示。
    - API 接口覆盖 OpenAI Responses、OpenAI Chat Completions、OpenAI Codex Responses、Anthropic
      Messages、Google Generative AI 和 Mistral
      Conversations；固定 API 来源显示只读值，多 API 来源显示选择框，OAuth 来源自动锁定兼容 API。
    - 增加认证方式选择；API Key 显示并复用现有“密钥”输入框，但切换来源/Provider/endpoint 时从隔离的
      `customApiKey` 或由 provider + normalized endpoint 生成的 `pi.apiKeys`
      scope 读写；OAuth 仅在所选来源支持时出现，并隐藏 API
      Key 输入框，非法 target 显示空 key 且不读取 cache。
    - 在“更多”配置区新增 `contextWindow`
      数字输入框，并同时展示现有“最大回复token数”输入框，不创建重复字段。
    - model catalog 命中时预填
      `contextWindow`，且允许用户覆盖；目录未命中的模型不得在该字段缺失时提交请求。
    - 模型字段提供“获取模型列表”，按当前来源/API/凭据请求可见目录；失败通过安全 `toastr`
      显示，不清空手工模型值。
    - Provider/API 下拉项根据有效路由附加
      `(Proxy)`；自定义 endpoint 规范化后不同于默认地址时显示“使用Proxy”勾选框。所有补充说明使用
      `HelpIcon`，不直接铺陈为常驻说明文本。
    - 选择需要 Proxy 的路由时探测当前 ST 配置；未开启时在配置区复用现有警告样式显示“没有开启Proxy”，请求边界仍独立执行 fail-fast 检查并弹出
      `toastr`。
    - 对两个输入执行正整数及“最大回复token数”不大于 `contextWindow` 的校验。
    - 切回“与插头相同”或“自定义”时隐藏 pi 字段但保留已保存值，避免误清配置。
    - 补齐中英文标签、帮助文本，以及来源/API/认证组合、显隐、预填、覆盖、持久化和非法值表单测试。

- [x] **E-07 在 `Source.vue` 实现 OAuth 交互**
    - OAuth 模式显示“登录”、登录状态、“重新登录”、“取消”和“登出”，不显示原始 access/refresh token。
    - 登录按钮必须由用户手势触发授权页；同时提供可复制的授权链接，避免 popup 被浏览器拦截。
    - 显示 callback URL 输入框和明确说明：loopback 页面无法打开属于预期，用户需复制地址栏中的完整
      `http://127.0.0.1:...?...`（或授权页实际返回的等价 `localhost`）URL 后粘贴回来。
    - 将 pi `AuthInteraction` 的 auth URL、manual
      code、progress、cancel/error 状态映射为非阻塞 UI；防止重复点击创建并发登录 attempt。
    - 覆盖成功登录、取消、重试、无效 callback、state 不匹配、token
      exchange 失败、切换来源和组件卸载清理的 Vue 测试。
    - `yarn test:pi:st-oauth` 在隔离 ST/Firefox 中以本地 mock 精确 token
      endpoint 验证 loopback 成功交换、请求形状、刷新后登录恢复、确认登出与凭据删除；同时验证取消、state
      mismatch、切源/卸载清理且无真实账号或 token
      endpoint 访问。外部真实账号授权仍属于 H-03 发布验收。

- [x] **E-08 更新 `requestReply` 集成测试**
    - “更多”下的三种破限方案分别覆盖聊天消息输出。
    - 断言捕获请求只使用 fixed custom marker/`.invalid`/空凭据；若 ST backend
      fetch 被调用，其 signal 已 aborted。
    - 断言捕获阶段不会到达真实外部 Provider、不会写回聊天，也不会追加 pi Context。
    - 保持现有串行/并行重试和 `generation_id` 中止行为；`Promise.any`
      结束后所有 loser 请求都已 abort。
    - 覆盖目录 `contextWindow` 预填、用户配置覆盖、未知 model 使用手工 `contextWindow`
      与现有“最大回复token数”，以及缺失/非法值被请求前校验拦截。
    - 覆盖六种 wire API 的路由、API Key/OAuth auth
      resolution、OAuth 自动 refresh，以及非法 Provider/API/auth 组合在请求前报错。
    - “与插头相同”和“自定义”的既有测试继续通过，并断言不会加载或调用 pi runtime。
    - `invoke_extra_model_pi_boundary.integration.test.ts` 不 mock
      invoke、capture、runtime、resolver、OAuth、credential、context、token/result
      adapter 或 controller，只在 Jest 无法载入 ESM-only pi-ai 的 transport
      seam 使用确定性 mock；三条 prompt 路由均穿过 production capture → `requestReply` →
      runtime，并覆盖真实 fixed fetch、三种 wire
      API、目录/手工窗口、Anthropic 过期 OAuth 自动 refresh、非法组合 preflight、旧来源零 Pi
      transport 及聊天/输入不变。并发 loser/手动停止和终态清理由既有集成测试覆盖。

> 完成 A–E 后达到文本 MVP，可先交付验证。

## 里程碑 F：工具调用与结构化输出（P1，阶段 C 的一部分）

- [x] **F-01 转换并校验 Tool schema**
    - 去掉 OpenAI 外层，将 parameters 包装为 pi/TypeBox schema。
    - 边界处校验根 schema 为 object；无 parameters 时使用空 object schema。

- [x] **F-02 实现 wire-API-aware tool choice router**
    - provider-neutral 路径只处理 `auto | none`。
    - OpenAI 映射 `required`/指定函数，Anthropic 映射 `any`/指定 tool，Google 当前只映射
      `any`，Mistral 映射 `required`/`any`/指定函数；Google named tool
      choice 尚未实现并在请求前明确拒绝。
    - 对已经实现的 tool choice 请求形状，不根据目录模型或 endpoint 静态能力提前拒绝。
    - 禁止用统一的无类型强转把同一值发送给所有 Provider。

- [x] **F-03 归一化 pi tool call 结果**
    - 将 tool-call blocks 转回当前 `GenerateToolCallResult` 形状。
    - `arguments` 用 `JSON.stringify` 转为 OpenAI/Slash 兼容字符串，保留 call
      id、name 和文本 content。

- [x] **F-04 接入结构化输出乐观发送与错误呈现**（依据 DEC-03）
    - 工具模式为 `MVU_TOOL_DEFINITION` 设置
      `constrainedSampling: { type: 'json_schema', strict: 'prefer' }`。
    - “格式化输出”按所选 wire
      API 已实现的原生 payload 形状映射；目录模型、动态模型或自定义 endpoint 不触发静态能力门禁，请求照常发送。
    - Anthropic Messages 的普通格式化输出映射为 `output_config.format` JSON Schema，v4/JSON
      Object 尚无 payload 映射并在调用 pi stream API 前明确拒绝。OpenAI Codex
      Responses 的普通和 v4 格式化输出都映射为 `text.format`。
    - Mistral Conversations 的普通格式化输出与 v4 分别映射为原生 JSON Schema 和 JSON Object
      `responseFormat`。
    - 目标 endpoint/model 实际拒绝工具调用或格式化输出时，归一化错误类别，并通过 `toastr.error`
      显示经过脱敏、可操作的错误信息。
    - 不把“格式化输出”转换成 constrained tool，不回退无约束文本，也不做失败后的策略重试。
    - 支持路径保证现有两种格式化输出解析器仍收到预期 JSON 结果。

- [x] **F-05 补齐工具与结构化输出测试**
    - 六种 wire API 覆盖 auto/none/required/named 的映射分支，包括 Google
      named 未实现时的请求前拒绝。
    - 普通格式化输出覆盖 OpenAI Responses、OpenAI Chat Completions、OpenAI Codex
      Responses、Anthropic Messages、Google 和 Mistral
      Conversations 的请求形状、目录外模型和自定义 endpoint 的乐观发送，以及目标返回不支持错误后的安全
      `toastr` 提示。
    - v4 覆盖 OpenAI Responses、OpenAI Chat Completions、OpenAI Codex
      Responses、Google 和 Mistral；Anthropic v4 因 wire payload 未实现而请求前拒绝，且未调用 pi
      stream API。
    - 断言上游拒绝后不会转换为 tool call、不会发送无约束文本请求，也不会以其他策略重试。
    - 覆盖 schema 非 object、无效 arguments、多 tool call、text + tool call、仅 tool
      call 和 length/abort。
    - 端到端结果可被当前 MVU 解析器消费并更新变量。

## 里程碑 G：图片与其他内容块（P1/P2）

- [x] **G-01（P1）转换 data URL 图片**
    - 将 ST `image_url` data URL 拆成 pi image block 的纯 base64 `data` 与 `mimeType`。
    - 校验 MIME、base64 和目标模型输入模态；错误在发送前报告。
    - 按解码后大小执行硬限制：每张最多 5 MiB；每个 context 合计最多 16
      MiB、最多 20 张图片，任一超限均在 Provider 请求前拒绝。

- [x] **G-02（P1）明确 remote image 与 video 行为**
    - 首版对远程 URL 可选择 fetch 转 base64 或 strict 拒绝，必须有测试和诊断。
    - video 无 pi 对应类型，首版明确拒绝，不静默丢失。

- [x] **G-03（P2）按 fixture 决定是否支持历史工具消息**
    - 先检查真实捕获 fixtures 是否包含 assistant `tool_calls` 或 `role: 'tool'`。
    - 若存在：转换为 pi `ToolCall`/`ToolResultMessage`，并从相邻 call 还原 `toolName`。
    - 若不存在：记录为后续项，不扩大首版范围。
    - B-04 三路真实“聊天消息”fixtures 中 assistant `tool_calls` 和 `role: 'tool'`
      均为 0；因此首版不扩大 fixture 范围。已有历史工具消息转换与单测保留，真实工具历史回归留作后续增强。

- [x] **G-04 补齐多模态测试**
    - 覆盖 text + image、多个 data URL、无效 MIME/base64、目标模型不支持图片、remote URL 和 video。

## 里程碑 H：总体验收与发布（P0/P1，0.5–1 天）

- [x] **H-01 自动化验证**
    - 2026-09-05 review 修复后通过 `yarn test --runInBand`：62 suites、1174 passed、53
      skipped；本轮新增 12 项回归，修复前已复现对应问题。
    - `yarn lint`、`yarn build:dts` 与 `CI=true yarn build`
      均通过；webpack 只有既有的动态依赖、浏览器数据陈旧和包体积提示。
    - SillyTavern 无代码改动，Slash-Runner submodule 指针不变，没有跨仓库代码改动。

- [x] **H-02 bundle 验收**
    - 最终生产包为 1,649,311 B / gzip-9 313,596 B，SHA-256 为
      `8219ff7d93b22d2ec36472f1e183f049675f1a19e2a014481b9214ac847bc9f9`；source map 为 4,561,697
      B。
    - 构建后 dependency boundary 与 LICENSE 契约 7 项通过：source
      map 恰有 34 个显式注册来源的独立 catalog、六个 wire adapter 和项目内 Google Proxy
      adapter，未导入 `providers/all`、动态模板/未注册 Provider factory、`node:http`、callback
      server 或未锁版 SDK CDN。

- [ ] **H-03 浏览器手工 smoke test**
    - 2026-09-05 使用 Firefox 154.0.1 与本地 HTTP 服务复现：默认 `srcdoc` 脚本环境的
      `location.origin` 为 `"null"`，旧 Proxy 探测未发出请求便返回不可用；修复后原样加载生产
      `sillytavern_proxy.ts` 编译模块，在继承页面 base 的 `srcdoc` 和带 `<base>` 的 Blob
      iframe 中均成功转发。服务端分别收到一次预期路径、合成认证头及 JSON 请求体；该检查不使用真实凭据、不访问真实 Provider，不替代下列完整 ST/Provider/OAuth 发布验收。
    - 选择模型来源“更多”，确认二级菜单完整列出 34 个来源；逐项切换时 API、认证和固定 endpoint 行为符合注册表，并验证 Fireworks、OpenCode
      Zen/Go 的 per-API URL。
    - 核对 DEC-07 的 15 个精确 Provider/API 组合在 Provider/API 下拉中带
      `(Proxy)`，同一 Provider 的非代理 API 不带后缀；自定义 endpoint 可独立开关“使用 Proxy”并随 Pi
      profile 恢复。
    - 分别在 ST
      Proxy 关闭与开启时验证 UI：关闭时配置区显示“没有开启Proxy”，生成和模型列表都在 Provider 请求前以
      `toastr` fail-fast；开启后相同请求经 `/proxy/<encoded-target>` 发送且不会额外直连。
    - 六种 wire
      API 各选一个代表来源完成文本请求和中止请求；支持的路径完成工具调用，并用支持图片的模型完成一次 data
      URL 图片请求。
    - 六种 wire API 各覆盖一次“获取模型列表”的成功或可解释失败；Proxy/CORS/权限失败必须显示脱敏
      `toastr`，不得删掉手工填写的模型或静默切换 Provider。
    - 验证 Proxy 下 OpenAI Codex 使用 SSE；验证 OpenCode Zen Google 经过项目内 Proxy-aware
      adapter，包含文本、工具/结构化输出和中止至少各一个代表 case。
    - 在已实现结构化输出请求形状的 wire
      API 中分别验证一个成功路径和一个目标 endpoint/model 实际拒绝路径；后者应已发送原请求、显示明确且经过脱敏的
      `toastr` 错误，且不发起任何降级或换策略重试。
    - 分别验证 Anthropic Messages 的普通格式化输出和 OpenAI Codex
      Responses 的普通/v4 格式化输出成功发送；另验证 Anthropic v4 因 wire
      payload 未实现而在请求前明确拒绝。
    - 分别验证 API Key 下的 `openai-responses`、`anthropic-messages`、`openai-completions`、
      `google-generative-ai` 和 `mistral-conversations`；Codex adapter 由下一项 OAuth 流程覆盖。
    - 分别完成一次 Anthropic 和 OpenAI Codex OAuth：打开授权页、复制 `127.0.0.1` callback
      URL、粘贴完成登录、请求、刷新页面后的认证恢复和登出。
    - 同时触发主聊天与 MVU 额外请求，确认 prompt 不串线、停止互不影响。
    - 检查捕获阶段不会携带真实 pi endpoint/key；正常路径快速以预期错误结束，监听失效时只访问
      `.invalid`。
    - 回归“与插头相同”和“自定义”，确认仍走原 TavernHelper 链路且结果不变。
    - 已完成的扩展前子集：ST 1.18.0 + TavernHelper 4.9.3 + Firefox
      154.0.1 加载本地生产产物；验证“更多”、原四类 Provider、API 标签、Anthropic API Key/OAuth
      endpoint 显隐、context/maxToken 编辑、Pi profile `backend: 'pi'`
      保存/切换/删除/整页刷新持久化及凭据排除，0 error
      toast。真实账号 OAuth 与真实 Provider 浏览器验收仍待完成；协议级功能、并发和旧链路自动回归见下文。
    - 另以 `yarn test:pi:live` 通过生产 Pi runtime 对真实测试链路完成
      `openai-responses`、`anthropic-messages`、`openai-completions` 三种 API
      Key 请求；预期路径、显式 AbortSignal、认证头、CORS 与响应标记全部通过。该 Node live
      smoke 不替代 Firefox/OAuth 验收。
    - `yarn test:pi:st-capture` 已在上述 ST/Firefox 组合中自动验证真实 backend
      fetch 的已中止 signal、fixed capture
      body、Provider 配置隔离和监听/一次性 inject/宏/进程清理。listener-miss 分支还验证 marker 不匹配时只访问
      `.invalid`、空凭据和 fixed custom，错误在 10 秒上界内传播，且 URL/body 不含 Pi
      endpoint、key 或 model。
    - `yarn test:pi:st-oauth` 独立执行无账号的本地 mock OAuth UI 流程，验证登录 attempt、取消、state
      mismatch、合法 loopback 成功交换、刷新恢复、确认登出、切源/卸载清理、凭据不展示/不泄漏及临时资源清理；真实授权页和真实 token
      endpoint 网络请求均为 0，因此不替代 H-03 外部真实 OAuth 验收。
    - `yarn test:pi:st-features`
      在同一真实 ST/Firefox/生产 bundle 中，以浏览器内协议 mock 验证了 OpenAI Responses、OpenAI Chat
      Completions、Anthropic Messages 和 Google 的文本请求，OpenAI/Anthropic/Google 工具调用，OpenAI
      data URL 图片，以及 Google 与 Anthropic 的原生 JSON
      Schema 格式化输出和三家 AbortSignal。终态计数为 14 次 Pi
      capture、14 次 Provider 协议请求、2 次 Legacy 请求和 4 次状态请求；同时验证两条旧来源各只走一次原 ST
      chat-completion
      transport、fetch 恢复和进程清理。两条旧路径还使用同一非空确定性更新，精确比较最终正文、UpdateVariable、`stat_data`、`display_data`
      和 `delta_data`。完整 send-button 并发按实际产品顺序执行：先挂起 Pi，再通过 `#send_but`
      进入主聊天请求，随后分别停止 Pi 和主聊天；两条 prompt 不串线，两个 stop 不互相中止。主聊天已 pending 后再点额外解析重试因最后楼层为 user 而按现有产品语义 no-op，runner 将其记录为诊断而没有伪造反向覆盖。
    - `yarn test:pi:st-live` 已在真实 OpenRouter/Firefox 中分别通过 OpenAI Responses、OpenAI Chat
      Completions 和 plain Anthropic Messages：请求到达
      `/api/v1/responses`、`/api/v1/chat/completions` 与 `/api/v1/messages`，HTTP
      200/CORS、认证头、真实且未预先中止的 AbortSignal、最终响应 marker、变量更新标签和 analysis 清理均通过。Anthropic
      case 只在该 custom target 中显式将 OpenRouter 预检不允许的三个默认 Anthropic header 置为
      `null`；这不证明 native
      Anthropic 或 beta/reasoning 语义。真实 Responses 中止 case 还验证请求已发出后 signal 变为 aborted、native
      fetch 抛 `AbortError`、BiDi 记录 aborted、无 retry 且不写结果。真实凭据只在 native
      fetch 边界替换固定 UI
      placeholder，没有进入 Vue/Pinia/ST 设置；临时目录扫描确认真实凭据未持久化，页面内存、进程和目录均已清理。
    - `yarn test:pi:st-server-cancel` 通过真实 Firefox
      → 本机流式 HTTP 服务验证客户端停止确实传播到可观测服务端：Pi 响应在 finish 前关闭且主聊天仍存活，随后主聊天 stop 才关闭自己的流。它证明取消传播与隔离，但不代表真实 Provider 已停止生成或计费。该历史测试也不覆盖 ST 通用 Proxy 在收到上游响应头之前的取消传播限制。
    - 尚待发布验收：34 来源菜单和六种 wire API 的代表性真实浏览器矩阵（含 Proxy 开关、model
      list、tools/image/structured 与预期 Proxy/CORS/权限失败）、真实 Anthropic 与 OpenAI Codex
      OAuth 登录/刷新/请求/登出，以及真实 Provider 侧可观察的服务端取消。因此 H-03 保持未勾选。

- [x] **H-04 发布与回滚准备**
    - 更新用户文档、Provider/API/auth 组合、OAuth loopback
      URL 复制步骤、浏览器凭据保存风险、登出方法、Proxy 启用方式/CORS 限制和能力矩阵；不增加额外 Slash-Runner 检查或安装步骤。
    - 保留一个可快速关闭 pi 路径的发布开关，直到 34 来源/六协议的代表性 smoke test 稳定。
    - 记录不在范围内的能力及后续任务，避免被误认为缺陷。

## 完成定义

全部 P0/P1 任务完成，并同时满足以下条件，才视为“覆盖当前 MVU 主要能力”：

- [x] prompt 捕获通过唯一 model
      marker 按 ID 隔离；捕获器在每次请求上下文内末位注册，并取得现有 settings-ready 监听器处理后的 messages。
- [x] 捕获请求不含真实 Provider endpoint/key/model；stop 成功时 fetch
      signal 已 aborted，stop 失效时只会访问 `.invalid`。
- [x] 捕获成功后的固定 Error 只在 marker、clone、stop 三项均成功时被吞掉，其他错误不会误判。
- [x] SillyTavern 无代码改动，Slash-Runner 无代码或 submodule 变更。
- [x] 只有模型来源“更多”进入 pi；“与插头相同”和“自定义”的既有链路保持兼容。
- [x] “更多”的二级来源菜单与实际注册/打包的 pi Provider 一致，相关设置全部由 `额外模型解析配置`
      持久化。
- [x] 二级菜单包含 32 个 Pi `Provider.baseUrl` 预设和 OpenCode Zen/Go 两个 concrete per-API
      catalog 地址，且不包含需要运行时参数拼接 URL 的动态模板来源。
- [x] `Source.vue` 可配置六种 pi wire API 和 API
      Key/OAuth；注册表阻止无效组合，OAuth 来源自动锁定兼容 API。
- [x] 注册表精确标记 15 个 Proxy Provider/API 组合；下拉 `(Proxy)`、自定义 endpoint
      `useProxy`、ST 未启用警告和请求前非重试 `toastr` fail-fast 共用同一有效路由解析规则。
- [x] Proxy 目标被限制在当前 Provider base origin/path 且仅转发 JSON 请求；Codex
      Proxy 固定 SSE，OpenCode Zen Google 使用项目内 Proxy-aware adapter，OAuth 请求保持直连。
- [x] 浏览器 OAuth 不启动本地 server；用户粘贴的 loopback callback URL 经过精确 redirect
      URI、host/path/state 校验后完成一次性交换，取消、重放和错误 URL 不会改写 credential。
- [x] OAuth
      credential 可持久化、串行 refresh 和登出删除，任何 UI、日志或错误都不泄漏 key/code/token。
- [x] “更多”显示并持久化 `contextWindow`，同时复用现有“最大回复token数”作为
      `maxTokens`；不存在重复配置，且目录预填、用户覆盖和非法值拦截均符合 DEC-02。
- [x] 捕获 prompt 与迁移前在宏、正则、世界书、角色卡、历史、注入和裁剪方面一致。
- [x] late system 不丢失，strict 模式可发现提示词结构变化。
- [x] 六种 wire
      adapter 的文本角色、流式完成、中止和错误行为由自动化契约覆盖；34 来源的真实浏览器矩阵仍归 H-03。
- [x] pi 回复不写回聊天、不追加到 Context；现有 MVU 下游解析不需要改接口。
- [x] generation ID 贯穿 prompt 与 Provider 两阶段；手动停止和并发 loser 清理都能终止实际 pi 请求。
- [x] 工具调用能产出当前解析器可消费的 `GenerateToolCallResult`；已实现 wire
      API 的工具调用和格式化输出对目录外模型/自定义 endpoint 乐观发送，目标实际拒绝时通过 `toastr`
      显示安全、可操作的错误；未实现的 wire 请求形状仍在请求前拒绝，且所有失败路径都不转换为工具或无约束文本。
- [x] data URL 图片正确转换；remote image/video 有明确且可测试的行为。
- [x] token
      preflight、凭据错误、Proxy/CORS 错误、未实现 wire 请求形状和目标 endpoint/model 的能力拒绝都在调用边界通过
      `toastr` 给出经过脱敏、可操作的提示。
- [x] Proxy 增量合并后的完整测试、lint、类型构建和生产构建通过，bundle 扫描确认未导入
      `providers/all` 或动态模板 Provider factory；当前产物信息已记录于 H-02。

## 建议执行顺序

关键路径：**A → B → C + D → E → F + G → H**。

- C 与 D 在 B 的接口确定后可以并行开发。
- F 与 G 在文本 MVP 完成后可以并行开发。
- A–E 完成后先做一次文本 MVP 验收，再继续 P1，便于隔离 prompt 捕获问题与 Provider 特例问题。

## 2026-09-05 分支 review 修复记录

评审范围为 `mag/responses_support` 与 `beta` 的 merge base `61010da` 起的全部变更；先以 `5b8d996`
提交原工作区变更。设计解释以本任务清单 DEC-01～DEC-07 的已确认决策为准，包括不修改 Slash-Runner 的捕获方案及后续确认的 ST
Proxy 路由。

| 问题                                 | 影响与修复                                                                                                                                                 | 验证                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1：默认 iframe 无法使用 Proxy       | `location.origin` 在 `srcdoc` 中为 `"null"`，导致 Proxy 始终被判为不可用；改用相对 fetch 实际使用的 `document.baseURI` 解析 origin。                       | 隔离模块回归；Firefox 的 `srcdoc`/Blob 两路真实 HTTP 转发。                |
| P1：Anthropic 默认采样参数冲突       | 同时发送温度及 `top_p` 会被部分 Claude 模型拒绝；默认端点省略值为 `1` 的未调整参数，两者都调整时给出不可重试的中英文配置错误。自定义端点保留自身协议语义。 | 默认参数、单独调整温度/`top_p`、冲突拒绝、自定义端点与本地化回归。         |
| P2：请求过程中修改面板会改变后续尝试 | Provider preflight 固定后，prompt 路由、应答格式、历史长度和 generation ID 仍读取活动设置；Pi 批次现在保存独立配置快照并在重试间复用。                     | 首次失败时切换来源、格式、模型及破限方案，第二次仍按原配置捕获并成功解析。 |
| P2：并发批次提前释放锁               | 返回 `concurrentInvoke()` 而未 await，导致外层 `finally` 在请求尚未结束时解锁；等待并发请求和 loser 清理完成后才释放。                                     | 请求挂起时再次调用不会启动第二次 preflight；完成后清理 analysis 状态。     |
| P2：自定义端点模型被内置目录误过滤   | `/models` 返回的 ID 与内置目录同名时，不应继承另一端点的 API 限制；只有规范化后的默认端点应用目录 API 过滤，与 runtime 解析规则一致。                      | 默认端点及完整 operation URL 仍过滤，自定义端点保留同名模型。              |

采样约束参考
[Anthropic 官方迁移说明](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/model-migration.md#sampling-parameters---temperature--top_p--top_k)。完整测试、lint、类型构建、生产构建及新 bundle 的 7 项依赖/许可证检查均通过。真实 Provider/OAuth 验收仍按 H-03 保留未完成状态。
