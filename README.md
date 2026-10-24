# 语音对话插件 v2.2（@local/voice-conversation）

DeepSeek Harness 的持续语音与键盘对话页面。使用当前原生 Session 的历史、模型、工具与权限。

## 这次解决什么

- **边说边显示**：持续采集音频，增量识别结果更新语音页同一条用户气泡；最小化时在语音条显示最新转写。不写入或提交普通聊天输入框。
- **直接发送**：停顿约 0.7 秒后取得最终识别结果即提交，移除确认卡片和额外 1.5 秒倒计时。普通聊天与语音页的键盘文字仍只手动发送。
- **清理标点噪声**：丢弃纯标点、空白、识别标签、零宽字符，去除开头孤立标点与重复同类标点，保留正常句内标点、数字、小数和“好/不”等短回答。
- **页面操作不再停录音**：录音独立于视图与对话阶段。最小化、设置、键盘、查看历史、模型工作和朗读不主动释放麦克风。
- **语音打断**：朗读时持续收音，连续语音起判即停止播放和预取；最终识别使用宿主 `steer` 中断旧轮次，避免单独 cancel 请求迟到而取消新问题。
- **真实连接状态**：必须收到 PCM 音频帧才显示麦克风已连接；音频停滞会显示恢复中，尝试恢复 AudioContext、有限次重连，不能一直假报“正在聆听”。

## v2.2 回复延迟优化

基于 [run-20261024-01 实机报告](docs/diagnostics/voice-latency/run-20261024-01/report.md) 实施：

- 宿主 partial 有稳定的 turn/step 身份时，首个完整句出现即送 TTS；final 仅补未读尾部。历史不重播、插话后不续读旧句，改写已读前缀时停止该消息朗读。
- 首句按句子发送，不再等待合并到 120 字；长句仍限长。保留一句预取，并在后续句子新到达时补启动预取。
- Edge 桥逐块发送 MPEG，Host 代理透传并处理背压/取消，客户端支持 `MediaSource.isTypeSupported('audio/mpeg')` 时边接收边播放。浏览器不支持时明确回退整段兼容播放。
- “正在准备语音”与实际 playing 事件后的“正在回答”分开显示；已经起播的句子失败后不自动从头重读。

93 项 Node 测试通过，其中一个测试运行 5 项 Python 桥接 HTTP 测试。自动测试的播放器使用受控替身；随后 [run-20261024-02](docs/diagnostics/voice-latency/run-20261024-02/report.md) 已在用户 Mac 上验证 MSE 解码与提前起播。三个主要样本首段正文→首声为 2.00 / 2.16 / 2.25 秒；精确统计与未验证范围见 [Codex 复核](docs/diagnostics/voice-latency/run-20261024-02/review.md)。

更新必须同时部署仓库 `edge-bridge/edge-server.py` 到本机实际桥接目录并重启桥接。完整更新、复测与 GitHub 回传提示词见 [UPGRADE-v2.2.md](docs/UPGRADE-v2.2.md)。

## 实现边界

宿主公开的 `remote.speech.transcribe` 是**整段识别接口**，没有转写流接口；`speech.follow` 仅推送服务状态。本版用连续 PCM + 增量音频快照实现边说边更新，**不是云端 WebSocket 原生流式识别**。首次文字约需 1.2 秒音频加识别耗时，繁忙时会合并中间快照；不保证逐字或毫秒级返回。

每个音频块最长约 5 秒，块间重叠约 0.3 秒；同一录音会话只允许一个识别请求在途，最终结果优先，快照合并、队列有界、请求可取消且有 12 秒期限。增量快照会比只识别一次增加 ASR 请求数与处理音频量，具体费用/额度取决于已配置的服务。插件不更换服务、不新建账号、不安装模型。

优先 AudioWorklet 采集，VAD 不依赖页面动画帧或页面可见性。旧宿主回退到 ScriptProcessor 并记录 `mic.degraded`，其后台可靠性需要实测。系统休眠、撤销权限、硬件故障、插件禁用不能保证继续通话；用户主动静音/结束或在另一会话明确开启语音时按指令释放资源。

全局只有一个通话 owner：普通浏览 B 不改变 A 的发送目标；在 B **明确开启**才结束 A 并绑定 B，迟到回调不会进入 B。语音不会另建脱离会话上下文的助手。已执行的工具操作不因打断朗读而撤销。

## 更新与验证

交给 Harness 的完整更新提示词及实机验收见 [UPGRADE-v2.2.md](docs/UPGRADE-v2.2.md)。代码说明见 [HANDOFF.md](HANDOFF.md)。默认朗读仍用现有云端 Edge TTS 桥接，无需重配模型。

```bash
npm ci
npm run check
npm test
node tests/render-preview.mjs
```

开发验证需 Node.js 22+ 和 Python 3.10+（python3 指向该版本；可使用已有 Edge venv 的 bin PATH 前缀）。

93 项 Node 自动测试及 5 项 Python 子测试覆盖实际客户端模块、React 组件、Worklet 源码与 Host handler；设备、识别网络和计时器使用受控替身。自动测试与实机结果分别记录；当前流式主路径已有复测证据，冷启动、真实断网/合成错误及声学环境差异仍未验收。

[静态界面预览](docs/voice-preview.html) 由实际组件生成，含转写中的气泡；不是实机截图，也不调用麦克风/模型。

## Edge TTS 桥接（新环境才需要）

已有云端朗读可用时无需重装。默认引擎通过本机轻量桥接请求云端，不运行本地语音合成模型。

```bash
mkdir -p ~/.dsh/edge-tts/tmp
cp edge-bridge/edge-server.py edge-bridge/requirements.txt ~/.dsh/edge-tts/
python3 -m venv ~/.dsh/edge-tts/venv
~/.dsh/edge-tts/venv/bin/pip install -r ~/.dsh/edge-tts/requirements.txt
```

凭据、录音、聊天记录、模型文件与原始日志均不应上传。长期记忆系统不在本次改动范围。
