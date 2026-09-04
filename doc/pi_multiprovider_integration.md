# Pi 多来源额外模型接入

Pi 链路为“额外模型解析”新增了一条由浏览器执行 Provider
adapter 的路径。它复用 SillyTavern/Slash-Runner 完成提示词构建，再由 `@earendil-works/pi-ai`
调用所选 Provider；根据来源与 wire API 的审计结果，请求会直接发送，或经 SillyTavern 的通用 CORS
Proxy 转发。原有的“与插头相同”和“自定义”路径保持不变。

当前“更多”注册 34 个带确定请求地址的来源：32 个来自锁定版 Pi 的
`Provider.baseUrl`，另加 Pi 目录已给出分 API 地址的 OpenCode
Zen/Go。原四来源版本已具备自动化测试和真实 SillyTavern/Firefox UI
smoke 覆盖；34 来源与 Proxy 路由的最终全仓测试、lint、声明构建、生产构建和 bundle 边界扫描均已通过。完整发布验收仍以任务清单 H-03 为准；真实 OAuth、Provider 权限、Proxy 部署状态和上游行为仍需在实际环境中验证。

## 模型来源

| 模型来源   | 请求路径                         | 配置位置         |
| ---------- | -------------------------------- | ---------------- |
| 与插头相同 | 原 TavernHelper/SillyTavern 链路 | 现有连接设置     |
| 自定义     | 原 TavernHelper 自定义 API 链路  | 额外模型解析配置 |
| 更多       | Slash prompt 捕获 → Pi Provider  | 额外模型解析配置 |

只有选择“更多”时才会进入 Pi 请求路径。切回另外两个来源会隐藏 Pi 字段，但不会清空已保存的 Pi 连接设置和 OAuth 凭据。

## Provider、API 与认证组合

来源、wire
API、认证方式和 endpoint 的合法组合由同一份注册表同时约束 UI 与运行时。非法组合会在 Provider 请求之前直接报错。

除 Anthropic（API Key 或 OAuth）和 OpenAI Codex（仅 OAuth）外，下表来源都使用 API
Key。即使 Pi 上游还为个别来源实现了其他认证方式，MVU 也不会将其显示为可用 OAuth；浏览器手工 OAuth 仍只注册 Anthropic 与 OpenAI
Codex。

| 来源                       | wire API                                                                               | 默认 API base URL                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ant Ling                   | `openai-completions`                                                                   | `https://api.ant-ling.com/v1`                                                                        |
| Anthropic                  | `anthropic-messages`                                                                   | `https://api.anthropic.com`                                                                          |
| Baseten                    | `openai-completions`                                                                   | `https://inference.baseten.co/v1`                                                                    |
| Cerebras                   | `openai-completions`                                                                   | `https://api.cerebras.ai/v1`                                                                         |
| DeepSeek                   | `openai-completions`                                                                   | `https://api.deepseek.com`                                                                           |
| Fireworks                  | `anthropic-messages`、`openai-completions`                                             | Messages：`https://api.fireworks.ai/inference`；Completions：`https://api.fireworks.ai/inference/v1` |
| GitHub Copilot             | `anthropic-messages`、`openai-completions`、`openai-responses`                         | `https://api.individual.githubcopilot.com`                                                           |
| Google Gemini              | `google-generative-ai`                                                                 | `https://generativelanguage.googleapis.com/v1beta`                                                   |
| Groq                       | `openai-completions`                                                                   | `https://api.groq.com/openai/v1`                                                                     |
| Hugging Face               | `openai-completions`                                                                   | `https://router.huggingface.co/v1`                                                                   |
| Kimi For Coding            | `anthropic-messages`                                                                   | `https://api.kimi.com/coding`                                                                        |
| MiniMax                    | `anthropic-messages`                                                                   | `https://api.minimax.io/anthropic`                                                                   |
| MiniMax（中国）            | `anthropic-messages`                                                                   | `https://api.minimaxi.com/anthropic`                                                                 |
| Mistral                    | `mistral-conversations`                                                                | `https://api.mistral.ai`                                                                             |
| Moonshot AI                | `openai-completions`                                                                   | `https://api.moonshot.ai/v1`                                                                         |
| Moonshot AI（中国）        | `openai-completions`                                                                   | `https://api.moonshot.cn/v1`                                                                         |
| NVIDIA                     | `openai-completions`                                                                   | `https://integrate.api.nvidia.com/v1`                                                                |
| OpenAI                     | `openai-responses`、`openai-completions`                                               | `https://api.openai.com/v1`                                                                          |
| OpenAI Codex               | `openai-codex-responses`                                                               | `https://chatgpt.com/backend-api`                                                                    |
| OpenCode Zen               | `anthropic-messages`、`google-generative-ai`、`openai-completions`、`openai-responses` | Messages：`https://opencode.ai/zen`；其他 API：`https://opencode.ai/zen/v1`                          |
| OpenCode Go                | `anthropic-messages`、`openai-completions`、`openai-responses`                         | Messages：`https://opencode.ai/zen/go`；其他 API：`https://opencode.ai/zen/go/v1`                    |
| OpenRouter                 | `openai-completions`                                                                   | `https://openrouter.ai/api/v1`                                                                       |
| Qwen Token Plan            | `openai-completions`                                                                   | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`                             |
| Qwen Token Plan（中国）    | `openai-completions`                                                                   | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`                                 |
| Qwen Token Plan Individual | `openai-completions`                                                                   | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`                             |
| Together                   | `openai-completions`                                                                   | `https://api.together.ai/v1`                                                                         |
| Vercel AI Gateway          | `anthropic-messages`                                                                   | `https://ai-gateway.vercel.sh`                                                                       |
| xAI                        | `openai-responses`                                                                     | `https://api.x.ai/v1`                                                                                |
| Xiaomi                     | `openai-completions`                                                                   | `https://api.xiaomimimo.com/v1`                                                                      |
| Xiaomi Token Plan AMS      | `openai-completions`                                                                   | `https://token-plan-ams.xiaomimimo.com/v1`                                                           |
| Xiaomi Token Plan（中国）  | `openai-completions`                                                                   | `https://token-plan-cn.xiaomimimo.com/v1`                                                            |
| Xiaomi Token Plan SGP      | `openai-completions`                                                                   | `https://token-plan-sgp.xiaomimimo.com/v1`                                                           |
| Z.AI                       | `openai-completions`                                                                   | `https://api.z.ai/api/coding/paas/v4`                                                                |
| Z.AI Coding（中国）        | `openai-completions`                                                                   | `https://open.bigmodel.cn/api/coding/paas/v4`                                                        |

OpenAI Codex OAuth 是独立的 Responses 适配器，不能作为普通 OpenAI Responses API
Key 请求使用。同样，OAuth 不能与自定义 endpoint 或另一个 wire API 任意组合。

固定来源的 endpoint 由注册表决定并在界面隐藏；Fireworks、OpenCode Zen 和 OpenCode Go 会随所选 wire
API 自动切换 base
URL。来源不会按页面加载时的一次性 CORS 探测结果过滤；注册表只对已经审计确认需要转发的 Provider/API 组合启用 Proxy，其他组合保持直连。上游的权限、协议或未登记的 CORS 变化仍会通过经过脱敏的
`toastr` 错误呈现。

需要运行时账号、区域或资源标识才能拼出地址的动态模板来源不进入菜单，包括 Amazon Bedrock、Azure
OpenAI Responses、Cloudflare AI Gateway、Cloudflare Workers AI、Google Vertex 和 Radius。OpenCode
Zen/Go 虽由 Pi provider factory 动态构造，但其 model
catalog 已提供确定的分 API 地址，因此属于本次 34 个具体来源。

OpenAI 或 Anthropic API
Key 的自定义 endpoint 可以使用任意有效的 HTTPS 地址；明文 HTTP 只允许明确的本机 loopback host：
`localhost`、`127.0.0.1` 或
`[::1]`。地址不得包含用户名/密码、query 或 fragment，远端 HTTP、内网 HTTP、其他协议和非法 URL 都会在请求前 fail-closed。显式填写但规范化后与 Provider 默认地址一致的 endpoint 仍按默认链路处理。

## CORS Proxy 路由

以下是已审计并登记的 15 个精确 Provider/wire API 组合。只有这些内置地址会自动使用 SillyTavern
Proxy；同一 Provider 的其他 API 不会因为名称相同而一并代理。

|   # | 来源            | wire API                 |
| --: | --------------- | ------------------------ |
|   1 | Ant Ling        | `openai-completions`     |
|   2 | Fireworks       | `anthropic-messages`     |
|   3 | GitHub Copilot  | `anthropic-messages`     |
|   4 | GitHub Copilot  | `openai-responses`       |
|   5 | Kimi For Coding | `anthropic-messages`     |
|   6 | MiniMax（中国） | `anthropic-messages`     |
|   7 | NVIDIA          | `openai-completions`     |
|   8 | OpenAI Codex    | `openai-codex-responses` |
|   9 | OpenCode Zen    | `anthropic-messages`     |
|  10 | OpenCode Zen    | `google-generative-ai`   |
|  11 | OpenCode Zen    | `openai-completions`     |
|  12 | OpenCode Zen    | `openai-responses`       |
|  13 | OpenCode Go     | `anthropic-messages`     |
|  14 | OpenCode Go     | `openai-completions`     |
|  15 | OpenCode Go     | `openai-responses`       |

二级来源与 API 下拉框会在有效路由的显示文本后附加字面量
`(Proxy)`；多 API 来源会按当前 API 更新标记。OpenAI/Anthropic API
Key 的自定义 endpoint 不套用上述静态矩阵：输入值规范化后不同于默认地址时显示“使用 Proxy”勾选框，并由
`pi.useProxy` 决定传输；显式填写的默认 operation/base URL 仍按内置路由处理。该选项也会随 Pi
API 方案保存和恢复。所有补充说明都放在相邻的 `HelpIcon` 中，不用常驻说明文本占用表单空间。

Proxy 必须在 SillyTavern 中通过 `config.yaml` 的 `enableCorsProxy: true` 或启动参数 `--corsProxy`
开启，并在修改配置后重启。界面会用由 SillyTavern 本地解析、不会访问外部 Provider 的 data URL
sentinel 检查 `/proxy/:url`
路由；有效路由需要 Proxy 而探测结果为关闭或不可用时，在对应配置区显示“没有开启Proxy”警告。生成请求和“获取模型列表”都会再次独立检查，并在提交 Provider 请求前强制刷新探测、fail-fast；等待可随当前请求取消，单次探测最多等待 5 秒。实际转发阶段再次发现路由关闭时也会保留
`proxy_unavailable` 分类并通过 `toastr` 明确报错，不会静默退回浏览器直连。

Provider 生成请求经 `/proxy/<encoded-target>` 转发，目标被限制在当前配置的 Provider base
URL 及其子路径，并且只接受可重放的 JSON 请求体。OpenAI
Codex 经 Proxy 时固定使用 SSE，避免选择 Proxy 无法承载的 WebSocket 传输。OpenCode Zen 的
`google-generative-ai` 使用项目内的、请求级 Proxy-aware Google
adapter；不需要 Proxy 的 Google 路径继续使用上游 Pi adapter。

模型发现仍按 Provider 的真实目录协议执行。需要 Proxy 的有效 target 会先做同样的可用性检查；直接访问 Anthropic、Google、Mistral 或 Codex 目录的请求会使用受限 Proxy
fetch，而原本就通过 SillyTavern 模型状态接口读取 OpenAI 结构目录的分支继续使用该接口，不做二次 Proxy 包装。失败不会清空手工填写的模型 ID。

## 配置步骤

1. 在“模型来源”中选择“更多”。
2. 在二级“来源”菜单中选择 Provider；API 和认证选项会随来源调整或锁定，`(Proxy)`
   表示该有效路由需要SillyTavern Proxy。
3. API Key 模式填写现有“密钥”字段；该输入框只投影当前槽位，“自定义”使用独立的 `customApiKey`，Pi API
   Key 则按“Provider + 规范化后的有效 endpoint”分槽保存在
   `pi.apiKeys`。自定义 endpoint 可按目标的 CORS 策略勾选“使用 Proxy”；OAuth 模式按下一节完成登录。
4. 填写模型 ID，也可以从 Pi 内置模型目录选择；“获取模型列表”会按当前来源/API/认证请求上游可见模型。
5. 设置 `contextWindow` 和现有“最大回复 token 数”。
6. 如果当前路由标有 `(Proxy)`，先确认 SillyTavern 已启用 Proxy 且界面没有“没有开启Proxy”警告。
7. 根据所选 API/model 的能力提示选择应答格式和采样参数。

自定义 body 使用 Provider adapter 的原生 payload。Google SDK 的请求参数位于 `config`
内，因此 Google 的 include 需要写成 `config: { ... }`，exclude 使用 `config.<field>`；例如
`config.safetySettings`。MVU 会拒绝覆盖 signal、system、tools、token 上限、采样和结构化输出等受保护字段，也会拒绝会被 Google
SDK 静默忽略的顶层 include。

模型列表发现按 Provider 的实际目录协议选择路径：OpenAI-compatible 来源，以及目录为 OpenAI 结构的 Fireworks、GitHub
Copilot、OpenCode Zen/Go 和 Vercel AI
Gateway，复用 SillyTavern 的模型状态接口；官方 Anthropic、Google 和 Mistral 使用各自模型端点，OpenAI
Codex 使用登录账号的订阅目录。共享目录返回多个生成协议的模型时，已知目录 ID 会按当前 API 过滤，未知新 ID 仍会保留供手工配置。模型列表接口与生成接口的 CORS/权限可以不同；获取失败只会明确报错，仍可手工输入模型 ID，不会改走另一个 Provider。

`contextWindow` 与“最大回复 token 数”都必须是正整数，且后者不能大于前者。选择目录模型时，
`contextWindow` 默认使用目录元数据；手动填写正整数会覆盖目录值。模型不在目录中时必须手工填写
`contextWindow`。自定义 endpoint 即使复用了官方目录中的模型 ID，也按动态模型处理并要求手工填写
`contextWindow`，不会继承官方 endpoint 的目录元数据。最终回复上限还会受目录模型自身的 `maxTokens`
限制。

发送前会进行保守的 token 预算检查，并预留上下文余量。超限时应缩短聊天历史、降低“最大回复token 数”，或修正模型的
`contextWindow`，不会把明显超限的请求发送给 Provider。

## API 方案与 `ExtraModelApiProfile`

API 方案现在通过 `backend` 区分两类快照：

- `backend: 'custom'`：保存原有自定义 API 字段。
- `backend: 'pi'`：保存结构完整的 Pi 连接快照，包括 provider、API、认证方式、endpoint、`useProxy`、model、
  `contextWindow`、`customHeaders`、`customIncludeBody` 和 `customExcludeBody`。

旧方案没有 `backend` 时按 `custom`
迁移。保存、另存、切换和删除 Pi 方案时会深拷贝连接字段并保留未知字段，避免响应式对象共享或前向兼容数据丢失。

Pi profile 不会保存或恢复顶层 `api地址` /
`模型名称`，因为它们属于隐藏的 Custom 来源；因此选择 Pi 方案后再切回 Custom，不会把当前 Custom
endpoint/model 回滚成创建该 Pi 方案时的旧值。方案名称在导入和操作时统一 trim，trim 后重名采用 first-wins；空白或外层结构损坏的单个方案会被隔离，不会使整份 MVU 设置回到默认值。profile 内可解析的
`contextWindow` 数字字符串会规范化为 number，非法值则按 malformed snapshot fail-closed。

`pi.apiKeys` 和 `pi.credentials` 都不会写入 `ExtraModelApiProfile` 的 Pi
connection 快照。`pi.apiKeys`
按“Provider + 规范化后的有效 endpoint”隔离；空 endpoint 会先解析为 Provider 默认地址，因此与显式填写的 canonical 默认地址共用同一槽。`pi.credentials`
仍按 Provider ID 隔离 OAuth credential，“自定义”的 API Key 则单独保存在 `customApiKey`。

切换模型来源、Pi
Provider、endpoint 或认证方式时，界面会先把当前“密钥”写回原有效 target 槽，再加载目标槽。OAuth、尚未配置的槽位，或 Provider/API/auth/endpoint 任一项非法而无法形成有效 target 时，活动 key 都为空且不会读取任何
`apiKeys` 槽。加载完整 profile 时，profile 顶层的“密钥”（该 profile 的 target
key）会在完整连接快照安装后只写入该 Provider + endpoint 的目标槽；`apiKeys`
cache 本身仍不进入 profile 快照。

只有连接快照完整且认证方式为 API Key 的 Pi profile 才保存这一个 target key。OAuth
profile 的顶层“密钥”恒为空，OAuth credential 只保存在按 Provider 隔离的 `pi.credentials`
中；从旧设置加载 OAuth Pi 配置时也会在面板挂载前清空陈旧的活动顶层 key，同时保留
`customApiKey`、`pi.apiKeys` 和 `pi.credentials`。malformed Pi
profile 也会在迁移或导入时移除其无归属的顶层 key。

手工改变 Pi Provider、wire API、认证方式或规范化后的实际 endpoint 时，界面还会清空当前的
`customHeaders`、`customIncludeBody` 和
`customExcludeBody`，避免 header 或 body 中的私有值被带到另一个请求目标。填写空 endpoint 与显式填写 canonical 默认地址在模型/key 解析和传输策略上都视为同一内置目标；只有规范化后不同于默认地址的 endpoint 才以“使用 Proxy”勾选值为准。切换 API
profile 则恢复该 profile 自己保存的完整连接快照，包括 `useProxy`。

保存 `backend: 'pi'` 方案时如果缺少结构完整的 Pi 连接快照会直接拒绝。加载或迁移已存在的 malformed Pi
profile 时也会 fail-closed：保留隔离的
`apiKeys`/`credentials`，但清空活动 key 和 Pi 连接字段，绝不会把畸形方案中的 key 与此前活动的 Provider、endpoint 或 model 拼接使用；用户必须修复并重新保存完整快照。active 配置与 profile 的 Provider/API/endpoint/model 会统一 trim 后再解析；未知认证值或非法 target 会清空无归属的根“密钥”，但不会删除
`customApiKey`、`pi.apiKeys` 或 OAuth credential。导入 malformed `当前api方案`
指针时仅恢复为未绑定状态，不会让整份设置解析失败。

## 浏览器 OAuth：手工 loopback callback

浏览器端不会启动本地 callback server，也不会使用未声明的中转服务。支持的注册信息如下：

| 来源         | 授权请求使用的精确 redirect URI       | 粘贴时允许的 loopback host |
| ------------ | ------------------------------------- | -------------------------- |
| OpenAI Codex | `http://localhost:1455/auth/callback` | `localhost`、`127.0.0.1`   |
| Anthropic    | `http://localhost:53692/callback`     | `localhost`、`127.0.0.1`   |

登录步骤：

1. 选择 OAuth 后点击“登录”，再打开或复制界面给出的授权链接。
2. 在 Provider 页面完成授权。浏览器最后访问本机地址时页面无法打开属于预期行为。
3. 从浏览器地址栏复制完整 callback URL，包括协议、host、端口、路径、`code` 和 `state` 查询参数。
4. 将完整 URL 粘贴回密码型 callback 输入框，点击“完成登录”。
5. 登录成功后可查看状态；“重新登录”只会在新 credential 成功保存后替换旧值，“登出”会删除该Provider 的 OAuth
   credential。

不要手工修改 callback 的端口、路径、`code` 或
`state`，也不要重复使用已经提交过的 callback。实现会校验协议、loopback
host、端口、路径和 state，并一次性消费登录尝试。虽然粘贴时接受 `127.0.0.1` 与 `localhost`
两种等价本机 host，授权请求和 token exchange 始终使用注册表中的原始 redirect URI。

SillyTavern Proxy 只用于已选择的模型生成与模型目录请求，不代理 OAuth authorize、token
exchange 或 refresh。若 token
endpoint 阻止浏览器 CORS，请求会直接报错，不会静默改走 Proxy 或服务端 relay。这意味着手工 callback、PKCE/state 和 credential 保存逻辑可用，并不保证上游允许当前页面完成纯浏览器 token
exchange。模型请求是否使用 Proxy 与 OAuth
token 请求是否可直连是两个独立条件，都需要在实际部署来源中验证。

## 能力与错误边界

普通文本是基础路径；自定义或目录外模型仍需有效模型 ID 和
`contextWindow`。工具调用与格式化输出按已经实现的 wire
API 请求形状判断，不根据目录模型或自定义 endpoint 的静态能力信息提前拦截：

| wire API                | 工具调用                        | 格式化输出（JSON Schema） | v4（JSON Object） |
| ----------------------- | ------------------------------- | ------------------------- | ----------------- |
| OpenAI Responses        | 支持                            | `text.format`             | `text.format`     |
| OpenAI Chat Completions | 支持                            | `response_format`         | `response_format` |
| OpenAI Codex Responses  | 支持                            | `text.format`             | `text.format`     |
| Anthropic Messages      | 支持                            | `output_config.format`    | 不支持            |
| Google Generative AI    | 支持 `any`，不支持 named choice | `responseJsonSchema`      | JSON MIME         |
| Mistral Conversations   | 支持                            | `responseFormat`          | `responseFormat`  |

- 表中支持的请求形状会对目录外模型和自定义 endpoint 乐观发送。若目标 endpoint/model 实际拒绝，MVU 会保留错误类别并通过
  `toastr` 显示经过脱敏、可操作的提示。
- Anthropic v4、Google named tool choice 等尚未实现的 wire 请求形状会在请求前明确拒绝。
- 工具调用和“格式化输出”保持为独立模式；任何失败都不会触发 constrained
  tool 转换、无约束文本降级或换策略重试。
- `temperature`、`top_p`、`top_k`、frequency penalty 和 presence
  penalty 只在当前 API/model 明确支持时发送；不支持的控件会禁用或被过滤。
- Anthropic 默认端点的温度与 `top_p` 只调整其中一个，另一个保持默认值
  `1`，请求会省略未调整的参数。两者都改为非默认值时会在请求前报错，避免违反
  [Claude 的采样参数约束](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/model-migration.md#sampling-parameters---temperature--top_p--top_k)。
- data URL 图片会转换成 Pi image block，并校验 MIME、base64 与模型输入能力。解码后每张图片最大 5
  MiB；单个 context 中所有图片合计最大 16
  MiB、最多 20 张。远程图片 URL 和 video 当前明确拒绝，不会静默丢弃。
- 历史 tool call/tool result 会转换为 Pi 对应内容块；普通文本、消息名和后置 system 消息也会保留。

Provider 目录和上游能力会变化；上表只表示 MVU 已实现请求形状，不保证任意目标 endpoint/model 都会接受。

## Prompt 捕获与停止

“更多”不会把真实 Provider 配置交给 Slash。每次请求的流程为：

1. 生成唯一 `generation_id`，用固定 `custom` 通道和 model marker 发起提示词构建；endpoint 固定为
   `.invalid`，key、真实 model、自定义 header 和 body 均为空。
2. 在本次请求上下文中，将 `CHAT_COMPLETION_SETTINGS_READY`
   监听器注册到末位，复制已有监听器处理后的最终 `messages`，再调用
   `stopGenerationById(generation_id)`。
3. 只有 marker 匹配、消息复制和定向 stop 全部成功时，才把随后固定失败的 fetch 视为正常控制流；其他错误原样进入失败路径。
4. 捕获的消息转换为 Pi Context，使用同一个 ID 注册 Provider `AbortController` 并执行流式请求。
5. “停止 Pi 额外模型解析”按钮会同时尝试停止 Slash 捕获阶段和 Pi
   Provider 阶段；并发策略选出结果后也会中止其余请求并等待清理。

Pi 的最终结果只转换回现有的 `string | GenerateToolCallResult` 接口，不追加到 Pi
Context，也不直接写入 SillyTavern
chat。仓库不修改 SillyTavern 或 Slash-Runner，也不增加额外的 Slash 版本探测。

## 安全说明

- API Key 和 OAuth
  credential 都由浏览器侧 MVU 设置持有，不是服务端密钥保险库。任何能读取同一 SillyTavern 页面/扩展存储的脚本都可能接触这些数据；只应在可信环境使用，并使用最小权限凭据。
- OAuth 的 PKCE verifier、state、authorization code 和 callback
  URL 只存在于当前内存登录尝试；callback 输入在完成或取消后清空。界面和状态只显示登录状态及到期时间，不回显 access/refresh
  token。
- OAuth credential 与按 Provider + 规范化 endpoint 隔离的 API Key
  map 都不进入 API 方案快照；日志和归一化 Provider 错误不应包含 key、code、token、请求 header 或响应正文。
- Prompt 捕获请求永远使用空凭据和 `.invalid` endpoint。即使捕获监听器失效，也不应把真实 Pi
  endpoint、key 或 model 发送给 SillyTavern 后端。
- Proxy 模式会把模型请求及其凭据交给当前 SillyTavern 实例转发，只应连接可信的 SillyTavern，并且只为可信、不跨站重定向的 HTTPS（或允许的 loopback
  HTTP）JSON 模型 endpoint 开启。代理 fetch 会限制目标 origin/base
  path 和 JSON 请求体，但这不等同于服务端密钥保险库或对目标服务的信任验证。
- SillyTavern 自身使用 HTTP Basic Auth 时，代理请求与上游依赖 `Authorization` 的 Bearer/API
  Key 认证可能在同一个 header 边界发生冲突；这是当前已知限制。OAuth 授权和 token/refresh 请求不通过该 Proxy。
- AbortSignal 会传到浏览器访问 SillyTavern
  Proxy 的 fetch；但在 SillyTavern 收到上游响应头之前，当前通用 Proxy 不能保证把浏览器断连继续传播到上游。因此点击停止可终止本地等待，却不能据此保证真实 Provider 已停止生成或计费。

## 当前限制与验收状态

- 不持久化跨轮 Pi Context，不回放 reasoning signature，不把回复写回聊天。
- 远程图片和视频输入未支持。Pi
  adapter 本身不会绕过浏览器 CORS；已审计的 15 个组合可借助已启用的 SillyTavern
  Proxy，其余来源/API 仍按注册表直连，未登记的 CORS 改动会作为请求错误呈现。
- 真实 Anthropic/Codex OAuth 是否可用取决于上游 token/refresh
  endpoint 对当前 SillyTavern 页面来源的 CORS/origin 放行；OAuth
  token/refresh 不使用 Proxy，自动化测试只覆盖浏览器协议逻辑和 mock
  exchange。Codex 模型目录和生成请求使用 Proxy，并不改变 OAuth token exchange 的这一限制。
- 未导入 `providers/all`。生产代码显式引入 34 个已注册来源的独立 model
  catalog，以及六种实际使用的 wire
  adapter；不加载需要账号/区域参数才能生成地址、且当前没有具体目录 URL 的其他 Pi Provider。
- 自动化测试覆盖配置、profile、捕获、消息适配、OAuth mock、凭据并发、payload、wire
  API 请求形状、token
  preflight、中止和 MVU 路由。以下真实 ST/Firefox 记录来自扩展前的四来源版本：已验证本地产物加载、“更多”与四类来源、Anthropic
  API Key/OAuth endpoint 显隐、context/maxToken 编辑、Pi
  profile 保存/切换/删除/整页刷新持久化和凭据排除。隔离的 OAuth UI smoke 还以本地 mock 精确 token
  endpoint 验证了登录尝试、合法 loopback
  callback 成功交换、刷新后登录恢复、确认登出与凭据删除，并验证取消、state
  mismatch、切源和卸载清理；没有使用真实账号或访问真实 token endpoint。真实 OpenAI Responses、OpenAI
  Chat Completions 和 OpenRouter-compatible Anthropic
  Messages 浏览器请求已经通过；真实 Google、native
  Provider 功能矩阵、真实账号 OAuth 登录/刷新和真实 Provider 服务端取消仍需按任务清单 H-03 完成验收。
- `yarn test:pi:st-capture`
  会启动隔离的临时 SillyTavern/Firefox 环境并加载本地产物，不读取 Provider 凭据。它已实际观察到一次 SillyTavern
  backend fetch，确认 signal 在 fetch 时已经 aborted，请求体仅使用 fixed
  `custom`、`.invalid`、空 key 与唯一 marker，且不含 Pi Provider
  endpoint/key/model；同时验证最终 messages、监听器、一次性
  `INJECTION`、宏、fetch 包装、analysis 状态、临时 profile 和进程清理。另有 marker 不匹配的 listener-miss 分支：它只向
  `.invalid` 发出一次空凭据 fixed-custom
  backend 请求，在 10 秒硬上界内传播预期错误，且请求 URL/body 不含 Pi endpoint、key 或 model。
- `yarn test:pi:st-oauth` 复用上述隔离 ST/Firefox harness，但只执行无账号、无真实凭据的 OAuth
  UI 本地 mock。它拦截授权 popup，并仅在浏览器内对精确 Anthropic token
  endpoint 返回合成响应；覆盖登录 attempt、取消、state mismatch、合法 loopback
  callback、刷新恢复、确认登出、切源与卸载清理，以及凭据不展示/不泄漏。runner 明确断言真实授权页和真实 token
  endpoint 的网络请求均为 0，并在结束时删除合成凭据和全部临时资源；它不代表外部真实 OAuth 验收。
- `yarn test:pi:st-features`
  在同一隔离 ST/Firefox/生产 bundle 中拦截实际 SDK/adapter 发出的浏览器请求，提供协议级证据：OpenAI
  Responses、OpenAI Chat Completions、Anthropic
  Messages、Google 的文本；OpenAI、Anthropic、Google 的工具调用；OpenAI data
  URL 图片；Google 与 Anthropic 原生 JSON
  Schema 格式化输出；三家 AbortSignal；Pi 与 ST 主 chat-completion
  transport 并发时的 prompt/stop 隔离；以及“自定义”和“与插头相同”各一次旧链路回归。两条旧链路使用同一非空确定性更新，并精确比较最终正文、UpdateVariable、`stat_data`、`display_data`
  和
  `delta_data`。最近一次终态为 14 次 capture、14 次 Provider 协议请求、2 次 Legacy 请求和 4 次状态请求，fetch、临时 profile 与进程均完成清理。该 runner 还通过真实
  `#send_but`/`#mes_stop`
  路径验证“Pi 先挂起 → 主聊天发起 → 分别停止”的完整并发顺序；prompt 不串线，两个 stop 不互相中止。主聊天 pending 后再点额外解析重试因最后楼层为 user 而按产品语义 no-op，并被明确记录。runner 使用浏览器内 mock
  Provider 响应，因此不验证真实 TLS/CORS、账号权限、配额、上游响应或服务端取消。
- `update:pi:st-prompt-fixtures`
  在隔离真实浏览器中同时捕获 Legacy 与 Pi 的当前预设、其他预设、内置破限三条 prompt 路径，并生成带版本/产物 provenance 的回归 fixtures。三路分别为 12/11/15 条 messages，逐路 JSON 完全一致且没有允许差异或 normalization；覆盖宏、prompt-only 正则、角色卡、世界书过滤与深度、历史裁剪、注入和
  `filterPrompts`。这三条“聊天消息”fixtures 均未出现历史工具消息，因此首版不额外扩大该回归范围。
- `yarn test:pi:live` 会从未跟踪的 `test_token.md` 仅在内存中读取测试凭据，通过生产 Pi
  runtime 请求三种 OpenRouter-compatible wire
  API，并只输出脱敏后的路径、signal、认证头、CORS 和结果布尔值；遇到 HTTP
  429 会立即停止后续请求。本次受控重试中 Responses、Anthropic Messages 和 Chat
  Completions 三条均成功返回预期响应，且路径、signal、认证头和 CORS 检查全部通过。
- `yarn test:pi:st-server-cancel` 让真实 Firefox 中的 Pi
  Responses 请求和主聊天请求同时连接到本机跨端口流式 HTTP 服务。停止 Pi 后，服务端观察到对应响应在
  `finish` 前关闭，而主聊天流与 signal 仍保持活跃；只有再点击真实 `#mes_stop`
  后主聊天流才关闭。该测试证明浏览器到可观测服务端的取消传播及两条 stop 路径隔离，不代表任何真实 Provider 已停止生成或计费。
- `yarn test:pi:st-live` 使用临时 ST/Firefox
  profile 和同一份内存凭据尝试真实浏览器请求，并在结束前清空页面内存、扫描临时数据后再删除目录。OpenAI
  Responses 与 OpenAI Chat Completions 已分别通过：请求到达 `/api/v1/responses` 和
  `/api/v1/chat/completions`，HTTP 200、CORS、Authorization、真实且未预先中止的
  `AbortSignal`、最终响应 marker、变量更新标签和 analysis 清理均符合预期。OpenRouter-compatible
  Anthropic Messages 也已通过 `/api/v1/messages`、`x-api-key` 和 HTTP 200。该 case 只在这个 custom
  target 的高级 headers 输入中显式将 `anthropic-version`、`anthropic-beta` 和
  `anthropic-dangerous-direct-browser-access` 置为 `null`，以避免 OpenRouter OPTIONS
  allowlist 拒绝；不要把这一覆盖应用到 `api.anthropic.com`。它只证明 plain、非 reasoning
  Messages 兼容路径，不证明 native Anthropic 或 beta/reasoning 语义。另一个真实 Responses
  case 在请求发出后停止，观察到 signal 中止、native fetch `AbortError`、BiDi
  `network.fetchError=aborted`、零重试和零结果写入。真实凭据只在 native
  fetch 传输边界替换固定 placeholder，从未进入 Vue/Pinia/ST 设置；扫描确认没有持久化真实凭据，页面内存、临时目录和全部进程均已清理。
- Proxy 增量合并后的最终状态通过 62 个测试套件（1162 passed、53
  skipped）、`yarn lint`、`yarn build:dts` 与生产构建。构建后依赖边界扫描确认 source
  map 只包含 34 个独立 model catalog、六种 wire adapter 和项目内 Google Proxy adapter，并继续排除
  `providers/all`、未注册 Provider factory 与 Node callback server。生产包为 1,649,123 B / gzip-9
  313,620 B，SHA-256 为
  `1a4117629e47fb52dfcff58f82626a3312b8f06d13ae271016cf479e1be940fe`；这些自动化结果不构成 34 个真实 Provider 的浏览器发布验收，后者仍见 H-03。

需要快速退出 Pi 路径时，可用下列任一方式；两种方式都不会删除已保存的 Pi 配置或 OAuth credential：

- 配置回退：把“模型来源”切回“与插头相同”或“自定义”。
- 发布熔断：以 `MVU_PI_MULTIPROVIDER_ENABLED=false yarn build` 构建；或在 MVU 加载前设置
  `globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ = false`
  并刷新页面。构建时关闭后不能由运行时开关重新启用。
