import assert from 'node:assert/strict';
import { formatIcsDate } from '../src/lib/ics.ts';
import { createDecisionLifecycle } from '../src/lib/decisionLifecycle.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assert.equal(formatIcsDate('2026-10-01', '09:00'), '20261001T090000');
  assert.equal(formatIcsDate('2026/10/01', '09:00:30'), '20261001T090030');

  const lifecycle = createDecisionLifecycle();
  const events: string[] = [];
  const oldRequest = lifecycle.begin();
  lifecycle.schedule(oldRequest.requestId, () => events.push('old-edit'), 5);
  const newRequest = lifecycle.begin();
  lifecycle.schedule(newRequest.requestId, () => events.push('new-edit'), 5);
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
