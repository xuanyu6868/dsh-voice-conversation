# 语音对话插件（@local/voice-conversation）

DeepSeek Harness 的免手动语音对话插件：说话 → 本地识别 → 自动发送 → 云端朗读回复 → 自动继续聆听。

- 默认 TTS：云端 Edge TTS（免费中文神经音色，按句合成 + 句间预取）；备选：系统语音（本地）、MiniMax（休眠）
- 识别：官方 SenseVoice 本地插件（`~/.dsh/speech-to-text/`）
- UI：完整语音页 + 最小化语音条 + 输入框声波按钮 + 逐条朗读按钮

**完整现状文档见 [HANDOFF.md](HANDOFF.md)**（能力、参数、实测数据、已验证问题清单与修复计划、机制坑清单、运维速查）。

## Edge TTS 桥接（默认引擎的运行时依赖）

`edge-bridge/` 是默认云端引擎的本地桥接服务（`POST 127.0.0.1:9884/speak` → mp3）。插件首次合成时按需自动拉起，但 Python 环境需手动准备一次：

```bash
mkdir -p ~/.dsh/edge-tts
cp edge-bridge/edge-server.py ~/.dsh/edge-tts/
cd ~/.dsh/edge-tts
python3 -m venv venv && venv/bin/pip install -r edge-bridge/requirements.txt
# 或用 uv：uv venv && uv pip install -r edge-bridge/requirements.txt
```

语音识别（SenseVoice）来自 DeepSeek Harness 官方实验插件，模型在 `~/.dsh/speech-to-text/`，不在本仓库。

## 快速上手

1. 输入框右下角**声波图标** = 开始语音对话（与官方"语音转文字"麦克风是两个入口）
2. 完整语音页：语音球 + 状态 + 静音/结束/字幕；右上角语音设置（音色/语速/输入设备）
3. 最小化后输入框上方出现紧凑语音条，文字输入不受影响
4. 语音会话绑定当前会话；切走显示归属、可返回
