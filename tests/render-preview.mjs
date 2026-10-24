// Reproducible static UI fixture. No microphone, model, tool or network calls.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadClient, ready } from './client-harness.mjs';
const h = loadClient(); ready(h, 'preview');
h.voice.owner.useSessions = selector => selector({ byId: { preview: { title: '今天的安排' } } });
h.voice.set({ muted: false, phase: 'listening', captureState: 'active', keyboardOpen: true, keyboardDraft: '把第二项再展开讲讲。',
  messages: [
    { id: '1', who: 'you', text: '今天想把事情安排得轻松一点，你有什么建议？' },
    { id: '2', who: 'assistant', text: '可以，从三件小事开始就好。\n\n- **先选一件最重要的事**：留一段不被打扰的时间。\n- **给自己一点空白**：散步、喝水，或者只是休息十分钟。\n- **晚上简单回顾**：记下一件今天做得不错的事。\n\n不用把每一分钟都排满，留点余地会更舒服。', streaming: false },
    { id: '3', who: 'you', text: '好，那我先从第一件事开始。' },
    { id: '4', who: 'assistant', text: '好呀。想好要做什么后，可以直接告诉我，也可以在下面打字。', streaming: false },
  ] });
const row = h.api.inputRow(); h.api.updateInput(row, { text: '好，先从第一件事', status: 'recognizing' });
const t = key => h.api.dictionary[key] || key;
const page = renderToStaticMarkup(React.createElement(h.api.VoicePageGuarded, { t, sessionId: 'preview' }));
const shell = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>语音对话 2.2 · 静态界面预览</title><style>
:root { --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f5f6f8; --dsw-alias-bg-overlay:#fff; --dsw-alias-label-primary:#24282f; --dsw-alias-label-secondary:#90959f; --dsw-alias-border-l1:#e9ecf1; --dsw-alias-brand-primary:#517cef; --dsw-alias-state-error-primary:#e36569; --dsw-alias-state-idle-primary:#b8bcc5; }
* { box-sizing:border-box; } body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; } .preview-label { height:28px; display:grid; place-items:center; color:#7c8494; background:#f7f8fa; font-size:10px; letter-spacing:1px; border-bottom:1px solid #eef0f3; } .shell { display:grid; grid-template-columns:228px minmax(0,1fr); height:calc(100vh - 28px); } aside { background:#f3f4f7; padding:28px 16px; border-right:1px solid #e8ebf0; color:#555d6b; } .brand { font-size:19px; color:#252a34; font-weight:650; margin:10px 10px 34px; } aside button { width:100%; background:#fff; border:1px solid #e4e7ed; border-radius:10px; padding:11px; color:#394151; margin-bottom:30px; } aside small { font-size:10px; padding:10px; color:#9da4b1; } .nav { padding:12px; margin-top:8px; font-size:12px; border-radius:9px; } .nav.selected { background:#e5e8f0; color:#313c54; } main { min-height:0; min-width:0; } @media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}}
</style><div class="preview-label">静态界面预览 · 演示内容 · 非 Harness 实机截图</div><div class="shell"><aside><div class="brand">DeepSeek Harness</div><button>＋ 新会话</button><small>工作区</small><div class="nav selected">今天的安排</div><div class="nav">项目讨论</div><div class="nav">随便聊聊</div></aside><main>${page}</main></div></html>`;
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/voice-preview.html', import.meta.url), shell);
h.dispose();
console.log('Static preview written: docs/voice-preview.html');
