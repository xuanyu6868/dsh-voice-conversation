# 本轮诊断埋点说明（commit 29e20d5，分支 diagnostics/voice-latency-run-20261024-01）

全部为只增日志、不改行为的最小埋点。基准版本 v2.1.0（f8096d5）。

## 修改位置与开销

| 文件 | 位置 | 埋点 | 开销 |
|---|---|---|---|
| client.js | dispatchMessage（send.start 处） | 记录 `voice.sendT0`，重置首轮标记 | 每发送 3 个字段写入，可忽略 |
| client.js | acceptChatSnapshot（partial 分支） | `reply.first-text` / `reply.first-sentence`：流式回复的首个可见文字与首个完整句边界，相对 send.start 的 ms | 每次快照一次正则；每轮最多记 2 行日志 |
| client.js | gsvPump edge 分支 + primePrefetch | `synth.headers`：fetch 响应头到达时刻（≈宿主合成完毕、整段传输开始） | 每合成请求 1 行日志 |
| impl.mjs | callEdge / tts.done | 透传桥接响应头 `x-edge-first-chunk-ms` 到 `tts.done.edgeFirstChunkMs` | 每请求 1 次 header 读取 |
| edge-bridge/edge-server.py | synthesize / do_POST | 记录上游首个音频块到达的单调时钟，经 `x-edge-first-chunk-ms` 响应头返回 | 每请求 1 次时间戳比较 |

日志走既有 `voice-flow.log` 异步批量通道，不新增网络请求、不改热路径等待。

## 同步说明

- 运行中的桥接进程文件 `~/.dsh/edge-tts/edge-server.py` 已同步为本版本并重启。
- 验证：`npm run check` 与 `npm test`（70/70）在埋点版本上通过；桥接自检返回 `x-edge-first-chunk-ms` 正常。

## 移除方式

`git revert 29e20d5` 或切回 `f8096d5`；桥接文件从仓库 `edge-bridge/` 的旧版本复制回 `~/.dsh/edge-tts/` 并重启桥接即可。
