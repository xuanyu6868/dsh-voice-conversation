import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadClient, flush, recordingMocks } from './client-harness.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const textOf = node => !node ? '' : typeof node === 'string' ? node : (node.children || []).map(textOf).join(' ');
const button = (view, name) => view.root.findAllByType('button').find(node => node.props['aria-label'] === name);
async function mounted(options = {}) {
  const h = loadClient(options);
  let current = { legacy: { nodes: [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: '继续我们之前的讨论' }] },
    { kind: 'assistant', messageId: 'a1', time: 1, blocks: [{ kind: 'text', text: '**当前会话**的回答\n\n- 第一项\n- 第二项' }] },
  ], partial: null } };
  const useChat = selector => selector(current);
  const useSessions = selector => selector({ byId: { a: { title: '会话 A' }, b: { title: '会话 B' } } });
  const t = key => h.api.dictionary[key] || key;
  let view;
  await act(async () => {
    await h.api.startVoice({ sessionId: 'a', send: options.send || (async () => {}), useChat, useSessions });
    view = TestRenderer.create(React.createElement(React.Fragment, null,
      React.createElement(h.api.VoiceEffects), React.createElement(h.api.VoicePageGuarded, { t, sessionId: 'a' })));
    await flush();
  });
  return { ...h, view, t, useChat, useSessions, setChat: value => { current = value; },
    async cleanup() { await act(async () => { view.unmount(); h.dispose(); }); },
  };
}

test('voice page renders existing conversation with bubbles, paragraphs, lists and bold text', async () => {
  const h = await mounted();
  assert.ok(textOf(h.view.toJSON()).includes('会话 A'));
  assert.ok(h.view.root.findAllByType('strong').some(node => textOf(node.toJSON?.() || { children: node.children.filter(x => typeof x === 'string') }).includes('当前会话')));
  assert.equal(h.view.root.findAllByType('li').length, 2);
  assert.equal(h.view.root.findAll(node => node.props?.className === 'dsh-vc-usertext').length, 1);
  assert.equal(h.view.root.findAllByType('textarea').length, 0); await h.cleanup();
});
test('keyboard controls edit a dedicated draft and only explicit send submits it', async () => {
  const sent = [], h = await mounted({ send: text => sent.push(text) });
  await act(async () => { button(h.view, '键盘').props.onClick(); });
  const field = h.view.root.findByType('textarea');
  await act(async () => { field.props.onChange({ target: { value: '手动发送的内容' } }); await h.fire(1500); });
  assert.equal(h.voice.keyboardDraft, '手动发送的内容'); assert.deepEqual(sent, []);
  await act(async () => { h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }); await flush(); });
  assert.deepEqual(sent, ['手动发送的内容']); assert.equal(h.voice.keyboardDraft, ''); await h.cleanup();
});
test('native MarkdownText is preferred and receives stable labels and streaming state', async () => {
  const seen = [];
  const Markdown = props => { seen.push(props); return React.createElement('div', { 'data-native-markdown': true }, props.text); };
  const h = await mounted({ markdown: Markdown });
  assert.ok(seen.length > 0); assert.equal(seen[0].streaming, false); const labels = seen[0].labels;
  await act(async () => { button(h.view, '键盘').props.onClick(); });
  assert.ok(seen.every(props => props.labels === labels)); await h.cleanup();
});
test('audio level updates render only the orb, not the message/Markdown subtree', async () => {
  let renders = 0;
  const h = await mounted({ markdown: props => { renders++; return React.createElement('div', null, props.text); } });
  const before = renders;
  await act(async () => { for (let i = 0; i < 100; i++) { h.advanceTime(100); h.api.publishLevel(i % 2); } });
  assert.equal(renders, before); await h.cleanup();
});
test('switching sessions remounts owner hooks and exposes no old draft or messages', async () => {
  const h = await mounted();
  await act(async () => { button(h.view, '键盘').props.onClick(); h.api.updateKeyboardDraft('A 的未发送文字'); });
  await act(async () => { await h.api.startVoice({ sessionId: 'b', send: async () => {}, useChat: selector => selector({ legacy: { nodes: [], partial: null } }) }); await flush(); });
  assert.equal(h.voice.sessionId, 'b'); assert.equal(h.voice.keyboardDraft, '');
  assert.ok(!textOf(h.view.toJSON()).includes('语音界面出错了')); assert.ok(!textOf(h.view.toJSON()).includes('A 的未发送文字'));
  await h.cleanup();
});
test('keyboard can explicitly interrupt a busy model', async () => {
  const h = await mounted(); await act(async () => { button(h.view, '键盘').props.onClick(); h.api.acceptRunning(true); });
  await act(async () => h.view.root.findByType('textarea').props.onChange({ target: { value: '下一个问题' } }));
  assert.equal(h.view.root.findAllByType('button').find(node => node.props.type === 'submit').props.disabled, false);
  assert.equal(h.voice.keyboardDraft, '下一个问题'); await h.cleanup();
});
test('settings do not offer the removed GPT-SoVITS engine or hardcode the recognition provider', async () => {
  const h = await mounted(); await act(async () => button(h.view, '语音设置').props.onClick());
  const contents = textOf(h.view.toJSON());
  assert.ok(!contents.includes('GPT-SoVITS')); assert.ok(!contents.includes('本地 SenseVoice'));
  assert.ok(h.view.root.findAllByType('option').some(node => node.props.value === 'edge:zh-CN-XiaoxiaoNeural'));
  assert.equal(h.requests.filter(request => JSON.parse(request.init?.body || '{}').action === 'warmup').length, 0); await h.cleanup();
});
test('fallback Markdown escapes raw HTML and does not activate unsafe links', () => {
  const h = loadClient();
  const html = renderToStaticMarkup(React.createElement(h.api.SafeMarkdown, { text: '**加粗**\n\n- 一\n- 二\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n```js\nconst x=1\n```' }));
  assert.ok(html.includes('<strong>加粗</strong>')); assert.ok(html.includes('<li>一</li>')); assert.ok(html.includes('<pre><code>'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:')); h.dispose();
});

test('minimizing or unmounting the voice view does not stop an active spoken reply', async () => {
  const h = await mounted();
  await act(async () => { h.sandbox.__vc.speak('保持朗读不中断。'); await flush(); await flush(); });
  assert.equal(h.api.isSpeaking(), true);
  await act(async () => { button(h.view, '返回聊天').props.onClick(); h.view.unmount(); });
  assert.equal(h.voice.pageVisible, false); assert.equal(h.api.isSpeaking(), true);
  h.dispose();
});


test('partial speech updates a single conversation bubble with no confirmation card or countdown', async () => {
  const h = await mounted(); let row;
  await act(async () => { row = h.api.inputRow(); h.api.updateInput(row, { text: '打开' }); });
  assert.ok(textOf(h.view.toJSON()).includes('打开'));
  const before = h.view.root.findAll(node => node.props?.className === 'dsh-vc-usertext').length;
  await act(async () => h.api.updateInput(row, { text: '打开灯带' }));
  assert.equal(h.view.root.findAll(node => node.props?.className === 'dsh-vc-usertext').length, before);
  assert.equal(h.view.root.findAll(node => node.props?.className === 'dsh-vc-transcript-review').length, 0);
  assert.ok(!textOf(h.view.toJSON()).includes('1.5 秒'));
  await act(async () => button(h.view, '对话记录').props.onClick());
  assert.ok(textOf(h.view.toJSON()).includes('打开灯带')); await h.cleanup();
});

test('voice view controls and unmount do not dispose continuous capture', async () => {
  const h = await mounted({ globals: recordingMocks() });
  // Speech injection can arrive after the page. Retry starts session-owned capture.
  await act(async () => { h.api.svc.speech = {}; h.api.retryMic(); await flush(); });
  const run = h.api.rec.current; assert.ok(run);
  await act(async () => { button(h.view, '键盘').props.onClick(); button(h.view, '语音设置').props.onClick(); await flush(); });
  await act(async () => { button(h.view, '返回聊天').props.onClick(); h.view.unmount(); });
  assert.equal(h.api.rec.current, run); assert.equal(run.stream.track.stopped, 0);
  h.dispose(); assert.equal(run.stream.track.stopped, 1);
});
