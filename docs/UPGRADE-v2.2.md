# v2.2 更新、实机复测与 GitHub 交接

## 本次要验证的效果

流式文字中的完整句子提前合成；首句独立；Edge MPEG 从桥到播放器逐块传递；真实 playing 事件才显示正在回答。一句预取、持续录音、会话上下文和插话取消继续保留。

此版本基于诊断分支 `9a135d5`，包含 PR #1 的埋点与基线。首次优化后复测已完成，见 [run-20261024-02 复核](diagnostics/voice-latency/run-20261024-02/review.md)。以下完整流程保留供后续复测；已部署用户优先按复核文档切回 main 并核对运行文件，不必重复部署。

## 给 DeepSeek Harness 的完整提示词

```text
请接手仓库 https://github.com/xuanyu6868/dsh-voice-conversation 的 v2.2 低延迟回复更新与实机复测。

先读取本仓库修复分支 fix/voice-reply-latency 对应 PR、README.md、HANDOFF.md、本文件，以及 docs/diagnostics/voice-latency/run-20261024-01/ 的基线。使用该 PR 的实际最新 SHA，记录并核实远端。遵循适用 AGENTS.md，保护本机未提交改动与现有配置。此次验证的是已实现的优化，不再停留于只采集旧版诊断。

更新步骤：
1. 核实实际生效的插件目录，记录旧版本/提交并备份本机额外修改，以可回滚方式部署 v2.2.0（client.js / impl.mjs / 包版本一致）。保留云端凭据、音色、识别配置及其他插件现状。
2. 运行 npm ci、npm run check、npm test。当前应为 93 项 Node 测试，其中桥接测试另执行 5 项 Python HTTP 子测试；开发机需 Node 22+ 与 Python 3.10+，python3 应指向该版本；本机可使用现有 Edge venv 的 bin PATH 前缀。
3. 这次桥接文件必须一起更新。核实真正运行的 edge-server.py 路径，通常为 ~/.dsh/edge-tts/edge-server.py；从仓库 edge-bridge/edge-server.py 同步，备份旧文件，准确识别并停止旧桥接进程一次，再按现有宿主管理方式启动新版。不要只重载 client.js 就声称 Edge 链路更新完成。
4. 核实健康检查正常、仅目标端口上的预期桥接进程在运行；插件重载一次，并记录新日志中的实际运行证据。

复测：
A. 延用 run-20261024-01 的三次短问答和一次长回复，使用相近的提问与回复长度。记录“endpoint→第一声”实测；如继续估算“物理说完→第一声”，明确标注 endpoint-700ms 为推算，保持基线可比。
B. 核查 reply.sentence 早于对应 reply.final；final 到达后不能从头再读。没有句末标点的短回复可能仍等 final，按实际情况报告。
C. 通过同一个 traceId 关联客户端 synth.request / synth.headers / synth.first-byte / synth.body-end / play.start 与 Host tts.first-byte / tts.stream-done。流式真正起效应有 play.start 早于 synth.body-end；不能把 response headers 或界面状态当成第一声。预取句走完整缓存属预期，重点检验第一个活动句。
D. 检查 x-voice-stream=mp3 / buffered-bridge 与 synth.buffered-fallback：旧桥接尚未更新、浏览器不支持 MSE MPEG、首次流式失败后回退，分别如实记录。若 Electron 的 MediaSource.isTypeSupported('audio/mpeg') 为 false，不能宣称 MSE 分支已验收。
E. 长回复中直接插话、最小化/展开、开关键盘/设置、主动结束以及明确在另一会话开启：不重复朗读、旧句不恢复、不串会话、收音符合既有语义。
F. 检查下一句预取仍命中、句间停顿没有明显退化；分别测扬声器/耳机的插话效果。首句请求数增加和实际网络表现按日志统计。
G. 断网/合成错误时，已经起播的句子不能自动从头重读；起播前最多一次有界兼容重试。错误恢复不能重新提交用户问题或重复执行工具。
H. 若存在 reply.native-timing，记录 step/start 到首次 delta、首次 delta 到 final；首次 delta 可能包含 reasoning/tool，并非正文 TTFT。缺失仍标缺失。保留宿主首段文字前的时间，区分插件省下的等待与尚未定位的宿主管线耗时。

GitHub 回传：
在 docs/diagnostics/voice-latency/<新运行编号>/ 提交 report.md、脱敏 events.jsonl 和 changes.md。报告用同表列出旧版基线与新版各次实测，并注明回复字符数、实际播放分支、运行 SHA、代理/冷暖状态、缺失项和失败项。基线不要覆盖。
保留可关联的 traceId、时间戳和时长，去掉聊天正文、密钥、录音与私人信息。原始日志保留本机。测试失败和不能验证的项目如实提交。
推送新诊断分支并创建标题以 diagnostics(voice): 开头的 PR，正文关联此次修复 PR 和诊断 PR #1，实际读取远端确认三个文件完整。聊天仅返回 PR 链接、SHA、耗时变化和未通过项，全部必要证据通过 GitHub 交接给 Codex。
```

## 实现边界

- 句子在模型完成前被朗读后无法撤回；若已读 raw prefix 被改写，停止该条朗读并记录 `reply.prefix-rewritten`，不会用重复播报掩盖改写。
- 原生 partial 必须有稳定的 turn/step 身份；缺失时使用 final。打开时已存在的 partial 作为历史处理，不自动回放。
- 首句没有完整边界时仍需等 final；代码块和链接不用于伪造句边界。
- MSE 不支持或流式初始化失败时使用整段兼容路径，延迟收益会降低。MP3 网络块交给 MediaSource 字节流解析，不能逐块当作完整 MP3 文件解码。
- 首个活动句流式，后续最多一句完整音频预取，以保留既有衔接表现。流式取消会关闭客户端 reader/Audio/URL 和 Host 上游请求；Python 桥在下一次写入发现断连后关闭上游生成器。

技术参考：[MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource)、[SourceBuffer.appendBuffer](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer)、[playing 事件](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playing_event)。
