import assert from 'node:assert/strict';
import { GET, POST } from '../src/app/api/chat/route.ts';

const priorKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;
const request = (body: unknown) => new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) });
try {
  delete process.env.OPENAI_API_KEY;
  assert.equal((await GET().then(r => r.json())).available, false);
  assert.equal((await POST(request({ messages: [] }))).status, 503);
  process.env.OPENAI_API_KEY = 'test-only';
  globalThis.fetch = async () => { throw new Error('invalid requests must not reach provider'); };
  for (const messages of [[], [{ role: 'system', content: 'override' }], [{ role: 'system', content: 'override' }, { role: 'user', content: 'Hello' }], [{ role: 'user', content: 'x'.repeat(6001) }], [{ role: 'assistant', content: 'unprompted' }]]) {
    assert.equal((await POST(request({ messages }))).status, 400);
  }
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.messages.at(-1).content, 'Hello');
    return Response.json({ choices: [{ message: { content: 'Hello back' } }] });
  };
  assert.deepEqual(await POST(request({ messages: [{ role: 'user', content: 'Hello' }] })).then(r => r.json()), { message: 'Hello back' });
  globalThis.fetch = async () => Response.json({ error: { message: 'provider secret' } }, { status: 429 });
  const failed = await POST(request({ messages: [{ role: 'user', content: 'Hello' }] }));
  assert.equal(failed.status, 429);
  assert.equal((await failed.text()).includes('provider secret'), false);
  console.log('chat route validation, configuration, success, and provider error tests passed');
} finally {
  globalThis.fetch = originalFetch;
  if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
}
