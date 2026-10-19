# 语音对话插件 v2.0（@local/voice-conversation）

DeepSeek Harness 的语音与键盘对话页面。**使用当前会话原生的历史、模型、工具与权限**，不会创建一个脱离该会话上下文的独立助手。

## 本版变化

- 语音页内置独立键盘输入：文字仅手动发送，支持 Enter 发送、Shift+Enter 换行及中文输入法；不读写普通聊天输入框。
- 语音识别也有独立草稿。完整语音页中有效转写等待 1.5 秒发送，可取消、清除、编辑；最小化取消倒计时，后续转写留待语音页确认，不在聊天输入框自动提交。
- 每个会话都可开启。全局只持有一个录音/播放会话；在 B 开启语音会释放 A 的录音与播放、隔离迟到回调，再使用 B 的上下文。未发送草稿按会话保存在内存；最小化不结束当前语音或打断朗读。
- 语音页展示当前会话的已加载对话，优先复用宿主 `MarkdownText`，保留段落、加粗、列表、代码等格式；旧宿主无此导出时使用安全的文本元素回退。
- 过滤空白、纯标点、零宽字符及纯识别控制标签，保留“好”“对”等正常短回答；VAD 改为连续语音判定，阈值不变。
- 音量单独订阅，避免整页随音频帧刷新；WAV/base64 分块让出界面线程；录音资源按轮次归属；Host 日志异步写入。增加 `ui.long-task` 诊断。

识别沿用宿主已配置的 `remote.speech` 服务，插件**不固定 ASR 提供方或安装识别模型**。默认朗读为云端 Edge TTS；系统语音仍可选。旧文档的本地 SenseVoice/GPT-SoVITS 安装信息不是升级要求。

## 更新

先读 [更新步骤与给 Harness 的完整提示词](docs/UPGRADE-v2.md)。完整实现边界与验收记录见 [HANDOFF.md](HANDOFF.md)。

开发检查（Node.js 22+；测试依赖不属于插件运行依赖）：

```bash
npm ci
npm run check
npm test
```

本版 **50 项自动测试通过**，不等于真实设备或 Harness 实机验收。十余秒卡顿的实际根因、麦克风/识别服务/云端音频耗时，以及深色与窄窗口效果仍需本机验证。

[静态界面预览](docs/voice-preview.html) 使用实际组件导出的演示内容，无录音/网络/模型调用，**不是运行截图**。可下载后用浏览器打开。重建：`node tests/render-preview.mjs`。

## Edge TTS 桥接（新环境才需要）

已有云端朗读可用时无需重装。默认引擎通过本机轻量桥接请求云端，不运行本地语音合成模型。

在仓库根目录执行：

```bash
mkdir -p ~/.dsh/edge-tts/tmp
cp edge-bridge/edge-server.py edge-bridge/requirements.txt ~/.dsh/edge-tts/
python3 -m venv ~/.dsh/edge-tts/venv
~/.dsh/edge-tts/venv/bin/pip install -r ~/.dsh/edge-tts/requirements.txt
```

插件在需要朗读时沿用现有机制拉起桥接。凭据、日志、录音、模型文件均不应提交到仓库。长期记忆系统不属于本版，按用户安排另行讨论。
