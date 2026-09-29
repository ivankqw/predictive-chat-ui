import assert from 'node:assert/strict';
import { recentChatHistory } from '../src/lib/chatHistory.ts';
import { formatIcsDate } from '../src/lib/ics.ts';
import { createDecisionLifecycle } from '../src/lib/decisionLifecycle.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assert.equal(formatIcsDate('2026-10-01', '09:00'), '20261001T090000');
  assert.equal(formatIcsDate('2026/10/01', '09:00:30'), '20261001T090030');

  const longChat = Array.from({ length: 42 }, (_, index) => ({ role: index % 2 ? 'user' as const : 'assistant' as const, content: `message ${index}` }));
  const recent = recentChatHistory(longChat);
  assert.equal(recent.length, 40);
  assert.equal(recent.at(-1)?.content, 'message 41');
  const largeChat = [...Array.from({ length: 8 }, () => ({ role: 'assistant' as const, content: 'a'.repeat(5990) })), { role: 'user' as const, content: 'next question' }];
  assert.ok(recentChatHistory(largeChat).reduce((size, item) => size + item.content.length, 0) <= 24000);
  assert.equal(recentChatHistory(largeChat).at(-1)?.content, 'next question');
  const lifecycle = createDecisionLifecycle();
  const events: string[] = [];
  const oldRequest = lifecycle.begin();
  lifecycle.schedule(oldRequest.requestId, () => events.push('old-edit'), 5);
  const newRequest = lifecycle.begin();
  lifecycle.schedule(newRequest.requestId, () => events.push('new-edit'), 5);
  lifecycle.schedule(oldRequest.requestId, () => events.push('stale-retry'), 5);
  await wait(15);
  assert.deepEqual(events, ['new-edit'], 'an edited draft must invalidate the old debounce');

  const dismissedRequest = lifecycle.begin();
  lifecycle.schedule(dismissedRequest.requestId, () => events.push('dismissed'), 5);
  lifecycle.invalidate();
  await wait(15);
  assert.deepEqual(events, ['new-edit'], 'a dismissed suggestion must cancel its pending request');

  const currentRequest = lifecycle.begin();
  lifecycle.schedule(currentRequest.requestId, () => events.push('current'), 5);
  await wait(15);
  assert.deepEqual(events, ['new-edit', 'current']);
  console.log('frontend lifecycle and ICS tests passed');
}

await main();
