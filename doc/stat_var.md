**## Abstract**
[头图](https://gitgud.io/MagicalAstrogy/yukisecret/-/raw/master/artifacts/00005-396695889.png?ref_type=heads&inline=false) 在过往的状态栏实现中，往往需要专门的输出格式规定，使得 LLM 在每一个会话结束时，输出完整的角色状态信息。为了改进状态信息的保存格式，
在之前的部分状态栏实现中，也使用到了 {{set_chat_variable}} 等方式将变量维护在聊天尺度的变量列表中，但依然没有改变需要以特定格式输出完整状态这一点。
在本文中，提出了一种借助于前端框架代码的方式，使得LLM只需要输出差分数据，而不需要输出完整的状态栏，以降低输出token消耗。在这种实现下，开发者也可以更方便地进行阶段名的自定义，
对玩家的属性隐藏等特性。对于这种显示方案，在[这张角色卡](https://discord.com/channels/1291925535324110879/1345643664701001808) 中进行了实践。
这个文章以及相关代码遵循MIT协议。其中世界书部份因为参考了[6]，为默认的CC4.0。
**## 前人的工作**
在之前进行的状态栏尝试中，有通过 QuickReply[[1]](https://discord.com/channels/1134557553011998840/1290919613516873775/1290919613516873775) 产生一次额外 的请求，送与 LLM，来对状态栏进行生成，这样会导致额外的请求，并且由于前文可能出现多于一次状态栏，导致ai仍然输出状态栏。也有通过 QuickReplay[[2]](https://discord.com/channels/1134557553011998840/1243994303101931591/1243994303101931591)
触发，将内容放入世界树条目来存储的，这个做法主要解决的是状态栏的存储问题，而不是输出方面的问题，对于这个方向也有 [[3]](https://discord.com/channels/1134557553011998840/1322458153622835220)
进行了支持多人物场景的实践。在 [[5]](https://discord.com/channels/1134557553011998840/1326304207464169482) [[6]](https://discord.com/channels/1134557553011998840/1312448971054252092) [[7]](https://discord.com/channels/1134557553011998840/1326304207464169482) 中，给出了移除历史状态栏，每次发送时基于存储的变量值生成最新值的方案，不过引入了额外的正则来做属性值的取值范围限定，以及阶段别名处理。在 [[8]](https://discord.com/channels/1134557553011998840/1310996336903979008) 中给出了一种基础的状态栏编写实践，可用于参考。也有作者[[9]](https://discord.com/channels/1291925535324110879/1347055731760824340) 提出了使用 js 进行变量的维护，以及更新的方案。在这个方案中也提供了一系列 QR 以及脚本来对状态进行维护，整体思路基于 `[1]` 中的额外请求，因为也不再需要输出完整的状态栏，做到了对复杂状态的支持。不过从目前的了解来看，似乎需要 llm 输出有效的json 代码，不太确定这方面的稳定性是否满足要求，从大模型训练集包含js代码来看，这种做法的效果是值得期待的。

**## 方案说明
### 核心思路**
这个方案依然基于 [[10]](https://sillytavern-stage-girls-dog.readthedocs.io/tool_and_experience/variable_in_lorebook_without_qr/) 中所述的机制，通过 世界书中的条目，要求 llm 以 `set|${variable}=${old}→${new}|(reason)` 输出在某次对话中变更的所有数值。这些变更量会在 `GENERATION_END` 时间点，也就是 llm 的应答结束时，被脚本读取，根据上一层的最新状态，以及这一层的变化，生成 分层的变量 `display_data` 和 `stat_data`，存放在当前层的当前swipe中。前者用于前端的状态栏显示读取，后者用于下一层读取最新状态。这样做的优点是因为 `display_data` 不会被后续的对话读取，可以在这个变量上应用所有需要对用户显示的更新操作，如好感度的 `50` -> `情窦初开` 等个性化的阶段显示，抑或是对用户隐藏特定状态，而不用将这些复杂度堆积在状态栏的 html 上，便于编写/管理。基于上面的内容也可以发现，前端状态栏 / 状态栏的内容并不直接基于 llm 的输出，因此可以在脚本中固定在对话底部追加一个 `<StatusPlaceHolderImpl/>` 形式的内容触发正则显示状态栏html，而不再需要 llm 输出什么。

对于这部分的逻辑，主要在 [function.ts](https://gitgud.io/MagicalAstrogy/yukisecret/-/blob/master/mods/src/function.ts?ref_type=heads) 中实现。
### 前端html写法
在这种情况下，给一个 `display_data` 的样例 json，就可以丢给小克生成了，唯一需要注意的是，最后 `display_data` 的来源需要改成下面的形式:
```javascript
            const message_data = await getChatMessages(getCurrentMessageId());
            var gameData = message_data[0].data.stat_data;
            if (_.has(message_data[0].data, 'display_data'))
            {//higher priority
                gameData = message_data[0].data.display_data;
            }
```

**### 变量初始化**
目前选择的方案是在 `GENERATION_STARTED` `MESSAGE_SENT` 时间点，通过脚本进行变量检查，如果变量不存在，则给 0 层的所有 swipe 进行一次赋值。保证生成过程中 `get_message_variable` 始终能拿到有效值。

对于这部分逻辑，主要在 [variable_init.ts](https://gitgud.io/MagicalAstrogy/yukisecret/-/blob/466fc091889f84ee3dddadfee15a2a15abffbe3d/mods/src/variable_init.ts) 中实现。

### 如何提供状态给 llm & 明确输出规则
这部分是在世界书条目中实现，与前人的做法类似，通过 `get_message_variable` 输出一个格式化的数据，并描述变量更新规则。在我的实践中，采用了注释的方式，在同一行描述规则，整体效果符合预期。不过对于物品栏这样存在增加、减少的项目，形如 sonnet 3.7 的模型并不能正确地更新 减少 的情况。
``` json5
<status_current_variable>//do not output following content
{
  '地点': '{{get_message_variable::stat_data.地点}}', //现在 <user> 所在的地点
  '场景人物': '{{get_message_variable::stat_data.场景人物}}', //现在 <user> 周围的人物
  '日期': '{{get_message_variable::stat_data.日期}}', //代表现在的日期，每一轮对话后都应当更新日期，即使日期不变，当经过0点时日期变化
  '当前时间': '{{get_message_variable::stat_data.当前时间}}', //'代表现在是几点，每一轮对话后都应当更新时间
  ‘世界状态': '{{get_message_variable::stat_data.世界状态}}',
  重要物品: {{get_message_variable::stat_data.重要物品}}, //<user> 持有的重要物品，在增加时以逗号追加，减少时删去减少的那一个
}
</status_current_variable>

rule:
  description: You should output the update analysis in the end of the next reply
  analysis:
    - You must rethink what variables are defined above, and analyze how to update each of them accordingly
    - For counting variables, change it when the corresponding event occur but don't change it any more during the same event
    - When a numerical variable changes, check if it crosses any stage threshold and update to the corresponding stage
    - <previous_status></previous_status> is no need to recall.
  format: |-
    <UpdateVariable>
    set|${variable}=${old}→${new}|(reason)
    </UpdateVariable>
  example: |-
    <UpdateVariable>
    set|悠纪.好感度=0→1|(初次见面的良好第一印象)
    </UpdateVariable>

```

### 如何集成到你的前端项目中

1. 参照 [文档](https://sillytavern-stage-girls-dog.readthedocs.io/tool_and_experience/js_slash_runner/user/advanced/#webpack) 配置好多文件的前端项目
2. 把那几个ts加进来，并配置好对应的事件监听，即（目前还没完全拆出来独立的模块，之后会逐步更新吧）：
```typescript
import './function';
import { initCheck } from './variable_init'

eventOn(tavern_events.GENERATION_ENDED, hello);
eventOn(tavern_events.MESSAGE_SENT, initCheck);
eventOn(tavern_events.GENERATION_STARTED, initCheck);
```

### 已知问题
前端框架对于 `get_message_variable` 还有一些问题，可能导致 swipe 时丢状态，等更新吧。
