import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, ready, deferred, flush } from './client-harness.mjs';

const partial = (text, turn=1, step=1) => ({ turn, step, blocks: [{kind:'text',text}] });
const final = (text, turn=1, step=1, seq=2) => ({ kind:'assistant', messageId:`m${turn}:${step}`, seq, ...partial(text,turn,step) });
const chat = (nodes=[], p=null) => ({legacy:{nodes,partial:p}});
function observed() {
  const spoken=[], h=loadClient({hooks:{speak:text=>spoken.push(text)}}); ready(h); h.api.acceptChatSnapshot(chat()); return {...h,spoken};
}

test('complete streaming sentences are read before final, and final only reads the remaining tail', () => {
  const h=observed(); h.api.acceptChatSnapshot(chat([],partial('第一句。第二'))); assert.deepEqual(h.spoken,['第一句。']);
  h.api.acceptChatSnapshot(chat([],partial('第一句。第二句。尾巴'))); assert.deepEqual(h.spoken,['第一句。','第二句。']);
  h.api.acceptChatSnapshot(chat([final('第一句。第二句。尾巴')])); assert.deepEqual(h.spoken,['第一句。','第二句。','尾巴']);
  h.api.acceptChatSnapshot(chat([final('第一句。第二句。尾巴')])); assert.equal(h.spoken.length,3);
  assert.equal(h.voice.lastReply.text,'第一句。第二句。尾巴'); h.dispose();
});
test('unpunctuated partials wait for final and do not replay on page changes',()=>{
 const h=observed();h.api.acceptChatSnapshot(chat([],partial('没有句号的文字')));assert.deepEqual(h.spoken,[]);
 h.api.setPageVisible(false);h.api.setKeyboardOpen(true);h.api.acceptChatSnapshot(chat([final('没有句号的文字')]));assert.deepEqual(h.spoken,['没有句号的文字']);h.dispose();
});
test('opening during an existing partial never replays that partial or its final',()=>{
 const spoken=[],h=loadClient({hooks:{speak:t=>spoken.push(t)}});ready(h);h.api.acceptChatSnapshot(chat([],partial('已有的句子。')));
 h.api.acceptChatSnapshot(chat([final('已有的句子。之后。')]));assert.deepEqual(spoken,[]);h.dispose();
});
test('tool steps have separate stream identities and preserve sentence order',()=>{
 const h=observed();h.api.acceptChatSnapshot(chat([],partial('我来查询。')));const a=final('我来查询。');h.api.acceptChatSnapshot(chat([a]));
 h.api.acceptChatSnapshot(chat([a],partial('结果已准备好。',1,2)));h.api.acceptChatSnapshot(chat([a,final('结果已准备好。还有补充',1,2,3)]));
 assert.deepEqual(h.spoken,['我来查询。','结果已准备好。','还有补充']);h.dispose();
});
test('interrupting playback invalidates streaming tails, including a late final',()=>{
 const h=observed();h.api.acceptChatSnapshot(chat([],partial('旧句。')));h.api.stopSpeaking();
 h.api.acceptChatSnapshot(chat([],partial('旧句。迟到的句子。')));h.api.acceptChatSnapshot(chat([final('旧句。迟到的句子。')]));
 assert.deepEqual(h.spoken,['旧句。']);h.dispose();
});
test('rewritten emitted prefixes stop playback and do not repeat conflicting content',()=>{
 const h=observed();h.api.acceptChatSnapshot(chat([],partial('灯已经打开。')));h.api.acceptChatSnapshot(chat([],partial('灯没有打开。')));
 h.api.acceptChatSnapshot(chat([final('灯没有打开。')]));assert.deepEqual(h.spoken,['灯已经打开。']);h.dispose();
});
test('old owner streaming callbacks cannot reach a new session',async()=>{
 const h=observed(),old=h.voice.owner;await h.api.startVoice({sessionId:'b',send:async()=>{}});
 h.api.acceptChatSnapshot(chat([],partial('不能读。')),old,1);assert.deepEqual(h.spoken,[]);h.dispose();
});
test('sentence parsing skips code, URLs, incomplete Markdown and decimal boundaries',()=>{
 const h=observed(),parse=t=>Array.from(h.api.sentencePrefix(t,false).chunks);
 assert.deepEqual(parse('第一句。第二句。未完'),['第一句。','第二句。']);
 assert.deepEqual(parse('**加粗。'),[]);assert.deepEqual(parse('**加粗。**'),['加粗。']);
 assert.deepEqual(parse('```js\nsecret();\n```\n安全。'),['安全。']);assert.deepEqual(parse('```js\nsecret();'),[]);
 assert.deepEqual(parse('温度 3.14 度。'),['温度 3.14 度。']);
 assert.deepEqual(parse('[官网](https://example.com/a.b)。'),['官网。']);h.dispose();
});
test('first sentence is not combined with following sentences up to 120 characters',()=>{
 const h=observed();assert.deepEqual(Array.from(h.api.splitSentences('第一句。第二句。')),['第一句。','第二句。']);h.dispose();
});
test('newly arriving second sentence starts one-sentence prefetch while the first is playing',async()=>{
 const h=loadClient();ready(h);h.api.acceptChatSnapshot(chat());h.api.acceptChatSnapshot(chat([],partial('第一句。')));await flush();
 h.api.acceptChatSnapshot(chat([],partial('第一句。第二句。')));await flush();
 const reqs=h.requests.filter(r=>r.url==='/voice-tts/tts');assert.equal(reqs.length,2);assert.equal(JSON.parse(reqs[1].init.body).text,'第二句。');h.dispose();
});

function streamingHarness({rejectPlayback=false,afterFirstError=false}={}) {
 const audios=[], media=[], revoked=[], reads=[], pending=deferred();let controller;
 class Buffer extends EventTarget {
   updating=false;appendBuffer(value){this.updating=true;reads.push(value);queueMicrotask(()=>{this.updating=false;this.dispatchEvent(new Event('updateend'));});}
   abort(){this.updating=false;}
 }
 class MediaSource extends EventTarget {
   static isTypeSupported(type){return type==='audio/mpeg';}
   readyState='closed';constructor(){super();media.push(this);}addSourceBuffer(){this.buffer=new Buffer();return this.buffer;}
   endOfStream(){this.readyState='ended';queueMicrotask(()=>audios.at(-1).onended?.());}
 }
 class Audio {
   constructor(){audios.push(this);}set src(v){this.url=v;const m=media.at(-1);queueMicrotask(()=>{m.readyState='open';m.dispatchEvent(new Event('sourceopen'));});}
   async play(){if(rejectPlayback)throw new Error('autoplay denied');this.onplaying?.();}
   pause(){this.paused=true;}removeAttribute(){}load(){}
 }
 const body=new ReadableStream({start(c){controller=c;c.enqueue(new Uint8Array([1,2,3]));},cancel(){pending.resolve('cancelled');}});
 const h=loadClient({globals:{MediaSource,Audio,URL:{createObjectURL:()=>`blob:${media.length}`,revokeObjectURL:u=>revoked.push(u)}}});ready(h);
 h.sandbox.fetch=async()=>({ok:true,body,headers:new Headers()});
 h.sandbox.__vc.speak('流式第一句。');
 return {...h,audios,media,revoked,reads,controller,pending};
}

test('MPEG bytes start playback before response EOF and preserve serialized SourceBuffer appends',async()=>{
 const h=streamingHarness();await flush();await flush();assert.equal(h.reads.length,1);assert.equal(h.voice.outputPlaying,true);assert.equal(h.voice.phase,'speaking');
 assert.equal(h.media[0].readyState,'open');h.controller.enqueue(new Uint8Array([4,5]));await flush();h.controller.close();await flush();await flush();
 assert.equal(h.reads.length,2);assert.equal(h.api.isSpeaking(),false);assert.equal(h.revoked.length,1);h.dispose();
});
test('stopping a live MPEG stream cancels reader, pauses audio and releases its URL without replay',async()=>{
 const h=streamingHarness();await flush();await flush();h.api.stopSpeaking();await flush();
 assert.equal(await h.pending.promise,'cancelled');assert.equal(h.audios[0].paused,true);assert.equal(h.revoked.length,1);assert.equal(h.api.isSpeaking(),false);h.dispose();
});
test('a stream failing after playback started is not automatically replayed from its beginning',async()=>{
 const h=streamingHarness();await flush();await flush();h.controller.error(new Error('connection lost'));await flush();await flush();
 assert.equal(h.voice.errors.synth,'error.synthFailed');assert.equal(h.audios.length,1);assert.equal([...h.timers.values()].some(x=>x.ms===250),false);h.dispose();
});
test('preparation state lasts until an actual playing event, not until synthesis is requested',async()=>{
 const h=loadClient(),gate=deferred();ready(h);h.sandbox.fetch=()=>gate.promise;
 h.sandbox.__vc.speak('还没播放。');assert.equal(h.voice.phase,'preparing');assert.equal(h.voice.outputPlaying,false);
 gate.resolve({ok:true,body:true,blob:async()=>new Blob(['audio'])});await flush();assert.equal(h.voice.phase,'preparing');h.dispose();
});
test('MSE unsupported browsers request buffered compatibility explicitly',async()=>{
 const h=loadClient();ready(h);h.sandbox.__vc.speak('兼容播放。');await flush();
 assert.equal(JSON.parse(h.requests.find(x=>x.url==='/voice-tts/tts').init.body).stream,false);h.dispose();
});


test('a new ordinary chat user record resumes reading after an explicit voice stop',()=>{
 const h=observed();h.voice.readBlocked=true;
 h.api.acceptChatSnapshot(chat([{kind:'user',seq:4,content:[{type:'text',text:'普通输入框手动提交'}]}],partial('新回答。',2,1)));
 assert.deepEqual(h.spoken,['新回答。']);h.dispose();
});

test('native interrupted final cancels an already queued streaming prefix',()=>{
 const h=loadClient();ready(h);h.api.acceptChatSnapshot(chat());h.api.acceptChatSnapshot(chat([],partial('旧回复。')));
 assert.equal(h.api.isSpeaking(),true);
 h.api.acceptChatSnapshot(chat([{...final('旧回复。'),interrupted:true}]));
 assert.equal(h.api.isSpeaking(),false);h.dispose();
});

test('a reply read budget applies across all its streaming sentences',()=>{
 const h=observed();let text='';
 for(let i=0;i<60;i++){text+='长'.repeat(100)+'。';h.api.acceptChatSnapshot(chat([],partial(text)));}
 h.api.acceptChatSnapshot(chat([final(text)]));assert.ok(h.spoken.join('').length<=4000);h.dispose();
});
