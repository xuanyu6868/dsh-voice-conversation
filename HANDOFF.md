# 语音对话 v2.1 实施与交接

日期：2026-10-22。此文覆盖当前实现；v2.0 的确认卡片、倒计时、键盘/朗读暂停录音行为已被本版替代。旧版升级文档仅作历史参考。

## 需求与行为

| 用户问题 | 当前代码行为 | 证据边界 |
|---|---|---|
| 要边说边在对话区域输入 | PCM 持续采集；增量快照返回时替换同一条用户气泡；最小化条显示最新转写 | 批量识别快照，不是提供方原生流式；云端时间不能用本地测试替代 |
| 多余标点 | 过滤纯符号、控制标签和零宽字符；清理前导孤立标点及连续同类标点 | 不删除所有标点，不保证消除 ASR 一切文字幻觉 |
| 不要确认再发送 | 约 700ms 静音判定结束一句；最终结果完整成功后立即提交 | 无额外 1500ms 定时器、无确认卡片；最终识别仍需网络时间 |
| 操作界面就不收音 | 模块持有 stream/context/processor；页面与阶段变更不销毁它 | 正常视图操作已受控测试；系统权限、休眠和真实故障另计 |
| 回答途中说话打断 | 连续约 300ms 语音起判停止播放、合成与预取；新问题以 steer 提交 | 依赖浏览器 AEC 和实际声学环境；不宣称扬声器回声已实测通过 |

## 录音、识别与生命周期

`startListening` 只由会话生命周期控制，不依赖 `pageVisible`、`keyboardOpen`、`document.hidden`、`modelRunning`、`awaitingReply` 或播放状态。只在明确结束/静音/重绑、设备更换、恢复故障或插件销毁时释放。晚到的权限请求通过独立 request 代次清理自己的流，不影响新会话。

优先内部 Blob 加载 AudioWorklet：平均降采样至 16kHz，按 1600 样本（100ms）传递，静音 gain 接 destination 保持图运行、不监听麦克风回放。无 Worklet 则尝试 16kHz ScriptProcessor 并记降级日志；不支持时明确报错。Worklet 内没有网络、日志、VAD 或大段同步编码。

VAD 使用实际音频帧时钟，连续 250ms 起判（100ms 帧下约 300ms），起判 RMS 0.015，结束 RMS 0.008，静音约 700ms，单句最长 30 秒。保留约 400ms 前滚音频，避免切掉开头。阈值不保证适合全部麦克风；真实音量仍有独立低频观察源，不让字幕随音频帧重绘。

`captureState` 与对话阶段独立：收到 PCM 才 active，超过 2.5 秒无帧显示 recovering；尝试 resume，超过 5 秒无帧重建采集，30 秒窗口最多 3 次恢复。超过次数或权限失败明确 error，界面提供重试。track ended 同用有界恢复。采集中断时未完成输入标为失败，不拿半句偷偷发送。

识别使用已注入的 `remote.speech.transcribe({audioBase64, language:'zh'}, signal)`。Host `speech.follow` 是状态流，不可当成流式转写。每 1.2 秒采集量尝试增量识别；约 5 秒封块并带 0.3 秒重叠。边界只消除至少两个有效字符的相同后缀/前缀，不全局去重。

每个 run 一个请求泵、最多 12 个最终块排队、一个最新中间快照；最多 8 个未完成输入。最终块优先并取消旧中间请求；超时 12 秒。WAV/base64 编码分块让出主线程。部分结果可修正，只有全部最终块成功才发送；超时/明确失败不拿中间结果代替。静音、结束和会话替换 abort 旧识别并释放流/节点/context/定时器。音频仅留在内存，不写录音文件。

ASR 请求数和累计音频量会增加；慢接口下不能保证 1.2 秒一次显示，也不保证中间文字正确。如果要逐字级低延迟，需要另行接入用户实际提供方的原生流式协议，不能伪造 API 或用动画冒充流式识别。

## 发送、原生聊天与打断

语音的中间结果仅在语音页气泡/最小化条呈现，不写共享 composer。键盘草稿手动发送，中文 IME、Shift+Enter、独立 revision 和按会话保存保持有效。录音不因键盘展开而暂停。最终发送可在最小化或浏览别的页面时完成，目标始终是当前通话 owner。

原生 Session 发送顺序：

1. `sessions.retain(sessionId, {source:'voiceConversation'})`，`ready` 后明确检查绑定与会话代次，调用 `binding.session.prompt(content, mode, undefined, requestId)`。存在 `beginSubmission` 时先注册原生聊天回显，沿用其 requestId；明确失败 abandon。
2. 仅普通 queue 兼容 `sessions.scope(sessionId).conversation.send(text)`。
3. 显式 `remote.session.prompt({sessionId,requestId,mode,content,clientTimeZone})`。旧接口不支持 steer 时失败，不静默排队、也不退回输入框。

正在回答/思考或该句话已触发插话时 mode=steer，否则 queue。不发送额外异步 cancel，避免取消新轮次。`stopSpeaking` 当场清播放、在途合成与预取；原模型/工具在最终识别后收到 steer，不能撤销已经发生的外部动作。

每条识别输入在 await 前认领一次，发送泵串行处理收据，20 秒结果未知时不自动重发。失败文字仍显示在气泡；新输入可继续。原生用户节点按“当前 owner、完整文本、基准之后的 seq、单条一次匹配”退休临时气泡，连续相同话语也不会合成一条。发送成功不能清掉键盘里碰巧相同的草稿。

插话后 `readBlocked` 忽略旧回复，新用户记录入账才解除，并按 seq 跳过之前的回复；interrupted 记录不朗读。正常打开、返回或切换会话只展示历史，不重播旧回答。普通浏览 B 不重新绑定，明确在 B 开始才切换；全局仅一个麦克风/播放 owner，内容和记忆仍由各原生 Session 管理。

## 自动验证

`npm run check` 与 `npm test` 通过，共 70 项（38 状态、18 连续音频/链路、11 React、3 Host）。执行真实 client.js、Worklet 字符串、React 18 与 impl.mjs handler；设备、网络、时钟为测试替身。

新增证据包括：PCM→中间气泡→最终唯一提交；静音/离散噪声不请求 ASR；纯标点最终结果覆盖正常中间结果仍不发送；最终结果取消慢中间请求；12 秒超时不发半句；旧会话结果不能进入新会话；朗读中语音起判即停、最终 steer；旧回复静默与新回复恢复；连续相同话语退休两条 native 记录；5 秒分块与 WAV 格式；音频心跳恢复与恢复次数限制；真实 Worklet 源码 48k→16k；原生回显 requestId 和失败退休；收据未知不重复；React 转写只更新一个气泡，无确认卡片；隐藏历史仍保留实时输入；页面卸载不释放录音。

静态预览由真实组件生成，但不是 Harness 实机截图。

## 尚未实机验收

- 用户 Mac 的实际云端 ASR 提供方、首字/最终耗时、额度以及 AbortSignal 是否及时终止远端工作。
- 实际宿主 Worklet/CSP 支持、后台窗口/键盘/设置/会话导航的音频稳定性，降级分支的后台表现。
- 笔记本扬声器与耳机两种环境下的回声、误打断、短句/轻声漏检、边界文字重复或丢失。
- 原来十多秒全局卡顿是否消失；若仍出现，需要关联 `ui.long-task` 与宿主主线程/IPC 日志。没有本机性能记录，不宣称根因全部找到。
- 各会话上下文/工具权限、steer 的实际运行与同句重复控制风险。

可记录的日志：`mic.connected/degraded/stalled/error`、`voice.input-start/endpoint/barge-in`、`asr.request/first-text/result/error/discarded`、`send.start/accepted/error`、既有 `synth.*`、`ui.long-task`。新增日志只记录 ID/计数/时长/模式，不写转写原文；既有其他日志策略未扩展。

更新与给 Harness 的完整提示词见 [docs/UPGRADE-v2.1.md](docs/UPGRADE-v2.1.md)。记忆系统未修改。
