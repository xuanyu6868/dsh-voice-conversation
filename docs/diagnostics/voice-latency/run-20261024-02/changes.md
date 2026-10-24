# run-20261024-02 本机改动说明

本轮**无新增代码埋点**。v2.2.0（fix/voice-reply-latency `f5b42e5`）已内含 run-20261024-01 的全部埋点（29e20d5）并新增 traceId / synth.first-byte / synth.body-end / reply.native-timing 等日志。

## 本机部署动作（非源码改动）

1. 活目录（profile 软链 → 工作区）切换到 `fix/voice-reply-latency`；升级前整树备份在 `backups/voice-pre-v2.2-20261024/`（含旧 git rev `9a135d5` 与旧桥接文件副本）。
2. 桥接同步：仓库 `edge-bridge/edge-server.py` → `~/.dsh/edge-tts/edge-server.py`；停止旧进程一次；以宿主既有方式（impl 按需拉起的同一命令行）手动启动新版；健康检查 ok；9884 仅一个 python 进程。
3. 插件禁用+启用一次；client-errors.log 无新增。
4. 测试环境注意：`npm test` 的桥接子测试需 python≥3.10（系统 3.9 缺 `contextlib.aclosing`），本机用 `~/.dsh/edge-tts/venv/bin/python`（3.10.20）置于 PATH 前缀通过。

## 导出工具

events.jsonl 由本机一次性 Python 脚本白名单导出（保留 ts/ev/traceId/耗时/字节数/队列标记，丢弃全部文本载荷）；脚本未入库（临时文件），原始 voice-flow.log 保留本机。
