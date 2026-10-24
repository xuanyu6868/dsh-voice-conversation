import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Python Edge bridge passes real HTTP streaming, compatibility and disconnect tests', () => {
  const result=spawnSync('python3',['-B',fileURLToPath(new URL('./bridge_stream_test.py',import.meta.url))],{encoding:'utf8',timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr); assert.match(result.stderr,/Ran 5 tests/);
});
