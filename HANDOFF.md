# 语音助手说明文档（最新现状）

> 整理时间：2026-10-19（北京时间）· 环境：macOS 26.2 / MacBook Air M4 / 24 GB / DeepSeek Harness 桌面版
> 本文档是语音助手的权威现状说明，只写已验证的事实。取代旧版交接文档与 README。

## 一、能力概览

在 DeepSeek Harness 桌面应用上实现的完整语音对话：

```
用户说话 → [ASR] SenseVoice 本地（官方实验插件，~/.dsh/speech-to-text/，242MB）
        → 文字进输入框 → 1.5s 倒计时自动发送（可取消）→ LLM 回复
        → [TTS] 按句合成、逐句朗读（句间预取，无停顿）→ 自动继续聆听（免手动循环）
```

**UI 四件**：完整语音页（`main` 面板 key=`voice`，语音球由真实音量驱动）＋ 输入框上方最小化语音条 ＋ 输入框右侧"开始语音"声波按钮 ＋ 每条助手消息的朗读按钮。语音会话由模块级单例持有，切视图不断线；绑定单个聊天会话，切走显示归属并可返回。

**TTS 引擎四选一**（语音设置里切换）：

1. **云端 Edge TTS**（当前默认，免费）：小晓/云希等中文神经音色。长回复按句切分；客户端带**一句预取**——第 N 句播放时第 N+1 句已在后台合成，句间无停顿（2026-10-19 上线，用户实测"效果不错"）。
2. 系统 speechSynthesis：macOS 自带音色，纯本地。
3. MiniMax T2A 云端：代码就绪但休眠，需 `MINIMAX_API_KEY`/`MINIMAX_GROUP_ID`。
4. ~~本地 GPT-SoVITS 克隆~~：已于 2026-10-18 按用户要求整体删除（回收 8.5GB），插件内代码保留但不可选。

**当前音频参数**：VAD 起判 RMS 0.015/250ms，停判 RMS 0.008/静音 1.3s，单段上限 30s，无语音 12s 重听；识别后 1.5s 自动发送；回复看门狗 25s。

## 二、文件与路径

| 内容 | 路径 |
|---|---|
| 插件源码（工作区） | `~/Documents/deepseek-harness/default-workspace/voice-conversation/` |
| 插件组成 | `client.js`（浏览器端全部 UI/逻辑）、`host.mjs`（Host 引导层，勿改）、`impl.mjs`（Host 逻辑层）、`cordis.patch.yml`、`locale/`、`icon.svg` |
| 插件安装 | 已装到 profile `desktop`，链接到工作区目录；行 id `include:voice-conversation` |
| Edge TTS 桥接 | `~/.dsh/edge-tts/`：`edge-server.py`（127.0.0.1:9884）+ 精简 venv（uv，Python 3.10）；插件按需自动拉起 |
| 日志 | `~/.dsh/edge-tts/voice-flow.log`（全链路关卡打点）、`client-errors.log`（页面黑匣子）、`proxy-errors.log` |
| 语音识别（勿删） | `~/.dsh/speech-to-text/`（官方 SenseVoice，语音输入在用） |

## 三、实测数据

- Edge TTS（云端）：首声 0.92s，整句合成 ~1.3s；桥接冷启动后单次合成 2.0s（含网络）。
- 预取：命中时记日志 `synth.prefetch-hit`，句间停顿从 ~1.3s 降到接近 0。
- SenseVoice 识别：短句 ~0.6s；超短句偶发误识别（"没反应"→拼音）。原因尚未完全定性；后续要先确认送入识别器的音频没有截断，再判断是否需要调 VAD 或模型参数。
- 本地 GPT-SoVITS（已删，留档）：暖机单句 2.4–3.8s，冷启动 ~1 分钟，RTF≈0.44；MPS 无收益；sample_steps 对 v2ProPlus 无效。

## 四、状态与时序修复（2026-10-19 已实施）

按方案 A 完成客户端状态机修复。未修改 ASR/TTS 引擎、`host.mjs`、Edge 服务、VAD 参数或跨会话架构。

| 改动 | 文件 | 行为变化 | 验证 | 性能影响 |
|---|---|---|---|---|
| 待发送状态机 | `client.js` | 自动发送改为 `sendId + sendDraft + sessionGen + turnId`；提交前重新校验 owner、输入状态和完整草稿 | 4 个自动发送竞态测试通过 | 1.5s 延迟不变；无新增请求 |
| 取消语义 | `client.js` | 点击取消进入 `editing`，保留草稿且不自动录音；编辑/清空同样进入 `editing`；手动发送只使旧定时器失效并等待回复 | 手动发送、编辑、点击取消测试通过 | 不提前、不延迟正常提交 |
| 继续聆听入口 | `client.js` | `editing` 状态在完整语音页和最小语音条提供“继续聆听” | 状态函数测试通过；界面未目测 | 只有用户点击才启动录音 |
| 会话/轮次防护 | `client.js` | 快速结束重开或同会话旧轮次的识别结果，在写草稿前被丢弃 | 3 个旧会话/旧轮次测试通过 | 仅 O(1) 代次比较 |
| 分环节错误 | `client.js` | 错误分为 mic/asr/draft/synth；成功只清对应环节，不再互相覆盖 | 2 个错误恢复测试通过 | 不改变引擎调用 |
| 合成失败重试 | `client.js` | “重试朗读”只重新朗读已保存回复，不重新发送问题或执行工具 | 重试朗读测试确认未调用 `submit()` | 用户主动重试才产生一次预期合成请求 |
| 播放泵停止竞态 | `client.js` | 停止 Edge/PCM 播放后释放 `gsvPlaying`，旧播放代次不能晚到完成 | Edge 停止播放回归测试通过 | 修复卡死；无新增等待 |
| 引擎标识 | `client.js`、`locale/*.json` | Edge 统一标为“云端 Edge TTS”，系统语音标为“本地系统语音” | 引擎标签测试与 JSON 解析通过 | 无新增轮询或预热 |
| 测试专用句柄 | `client.js`、`tests/voice-state.test.mjs` | 状态测试只在 `__VC_TEST__ === true` 时可用，生产环境不暴露新增控制 API | 11 个 Node VM 测试通过 | 生产路径不加载测试 |

**保持不变**：`SEND_DELAY_MS=1500`；VAD `0.015/250ms`、`0.008/1300ms`、30s、12s；Edge 一句预取；SenseVoice 模型；Edge 桥接；`host.mjs`；`impl.mjs`。

**自动化验收**：

```bash
node --test tests/voice-state.test.mjs   # 11 passed, 0 failed
node --check client.js                   # PASS
node --check impl.mjs                    # PASS
node -e "for (const f of ['package.json','locale/zh.json','locale/en.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('json ok')"
```

**运行时验收状态**：第一轮实施后未做运行时验收；第二轮修补后已热重载（见下节）。整体验收未完成。

### 复审修补（2026-10-19 第二轮）

复审发现第一轮实现存在一个回归：insert 路径（聊天视图 + 已有草稿 + 语音追加）在 `insertText` 后同步读旧缓存，`transcriptDraft` 记错，倒计时永不启动。按用户审定的约束修复：废掉 `transcriptDraft`，改为 `armPending` 标记 + `isPureInsertion` 拼接校验——只有观察到的草稿能精确分解为「写入前草稿 + 识别文本」才认定是我们的语音写入并启动倒计时；用户编辑/清空/手动提交/结束重开均使标记失效。待发送绑定 sessionGen、turnId、owner 和真实写入后的草稿；零固定延时。空草稿/语音页路径（结果可精确计算）在落字时直接启动。

同步完成：`synth.prefetch-start` 日志补齐（预取请求不再隐形）；完整语音页增加"取消自动发送"按钮（此前仅最小化条有）；`window.__vc` 调试句柄整体收进 `__VC_TEST__` 开关——生产环境不再暴露可写状态对象，诊断走 voice-flow.log 与 client-errors.log。

**自动化测试通过项（16/16，2026-10-19）**：第一轮 11 项 + 第二轮 5 项：insert 后缓存未刷新时不启动、刷新且确证为本方写入后启动并只提交一次、等待期间用户编辑拒绝启动（进 editing）、等待期间用户清空拒绝启动、等待期间手动提交不重复提交、结束重开后旧标记失效。测试以 store/cache 分离模拟真实渲染刷新时序，不再由同步桩掩盖竞态。`node --check` 通过；插件已热重载，client-errors.log 无报错。

**实际操作通过项**：暂无（待用户实测）。

**未验证项（完成前不标记整体验收通过）**：

1. 三条真实路径语音实测：完整语音页说话、聊天页空草稿说话、聊天页已有草稿后追加语音（回归路径）。
2. 追加后立即编辑/清空/手动发送的实际表现（看日志 `send.arm-rejected`/`send.cancel` 佐证）。
3. 修改前后 `voice-flow.log` 性能对比（asr/synth/play 各关卡耗时）。
4. 深色模式/窄窗口目测。

## 五、已知限制（不在本批范围）

1. 超短句识别质量原因未完全定性；需先检查输入音频是否完整。
2. 跨会话：语音绑定原会话；切走后新消息朗读暂停（宿主不挂载后台会话组件，架构限制）。
3. 语音插话 = 点状态行打断，不是真语音打断检测。
4. 深色模式/窄窗口有适配代码但未经目测。
5. MiniMax 引擎未实测（缺 key；用户的 M Plan 官方 FAQ 称含音频模型）。
6. 长会话注意 LLM 上下文上限（CONTEXT_WINDOW_EXCEEDED），长聊天建议新会话。

## 六、插件机制要点（踩过的坑，别再踩）

1. **模块缓存**：改 `impl.mjs`/`client.js` 后禁用+启用插件即生效（`host.mjs` 用带时间戳的动态 import 加载 `impl.mjs`）；改 `host.mjs` 才需重启应用。
2. **cordis 服务守卫**：可选服务用 `ctx.get('name')`；嵌套 Remote 命名空间必须 `ctx.inject(['remote.speech'], scope => ...)`（直接 `ctx.remote.speech` 抛 "cannot get property without inject"）。
3. **宿主认证**：路由 handler 里 `ctx.get('connection').requestRejection(req)`（传完整 req）；页面同源 fetch 自带凭证。
4. **视图切换**：完整页用 `main` 面板 + `ctx.layout.selectPanel('voice'|null)`；`uiConversation.binding().activate()` 只更新快照不切渲染（实证）。
5. **编辑器卸载**：语音页显示时输入框编辑器是卸载的，转写文字必须走 `inputActions.setDraft()`，不能用 `captureInsertion()/insertText()`（抛 React #321）。
6. **React 钩子纪律**：shell 的 `useInput/useChat` 只能在组件渲染顶层调用；回读草稿用 draftCache 模式（渲染时刷新缓存，回调读缓存）。
7. **桌面协议**：页面是 `dsh-app://app` 自定义协议，`forwardWebRequest` 转发 Host loopback；`/plugins/events` SSE 在插件重载时短暂断开并自愈（正常）。
8. **macOS 代理坑**：Clash 系统代理会让 Python requests 的 localhost 探测失败（curl 没事）；Edge TTS 走直连正常。

## 七、运维速查

```bash
# 插件热重载（改代码后）
# plugin_manager: set_plugin include:voice-conversation false → true

# 日志
tail -f ~/.dsh/edge-tts/voice-flow.log     # 全链路关卡（含 synth.prefetch-hit）
tail -f ~/.dsh/edge-tts/client-errors.log  # 页面报错（黑匣子）
tail -f ~/.dsh/edge-tts/proxy-errors.log   # Host 代理错误

# Edge 桥接手动排障（通常插件自动拉起，无需手动）
~/.dsh/edge-tts/venv/bin/python ~/.dsh/edge-tts/edge-server.py

# 彻底卸载
# plugin_manager remove_bundle @local/voice-conversation
# rm -rf ~/.dsh/edge-tts   # 语音输入的 ~/.dsh/speech-to-text 别动
```

## 八、协作偏好（用户惯例）

- 大改动先出方案给用户审，修订后执行；验收用日志/实测数据说话，不接受"注册了=能用了"式虚报。
- 不做未验证的承诺；不能测的明确标注。
- 清理要彻底，不留残留缓存；插件本体保留。
