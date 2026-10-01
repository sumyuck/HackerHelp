import assert from 'node:assert/strict';
import { transition, TicketSnapshot } from '../tickets/ticket-state';
import { decideDuplicate, SimilarTicket } from '../tickets/dedup-policy';
import { applyGateFloors, fallbackClassification, maxPriority } from '../services/ticket-classifier.service';
import { describeEscalation } from '../discord/ticket-forum';

const mod = { id: 'mod-1', isModerator: true };
const creator = { id: 'user-1', isModerator: false };
const stranger = { id: 'user-2', isModerator: false };
const ticket = (status: TicketSnapshot['status'], assigneeId: string | null = null): TicketSnapshot => ({ status, creatorId: 'user-1', assigneeId });

function testStateMachine() {
  // Happy path: open → assigned → waiting → assigned → resolved → reopened.
  let r = transition(ticket('open'), 'assign', mod);
  assert.deepEqual(r, { ok: true, status: 'assigned', assigneeId: 'mod-1' });
  assert.deepEqual(transition(ticket('open'), 'assign', mod, { assigneeId: 'mod-2' }), { ok: true, status: 'assigned', assigneeId: 'mod-2' });
  assert.deepEqual(transition(ticket('assigned', 'mod-1'), 'wait_for_user', mod), { ok: true, status: 'waiting_user', assigneeId: 'mod-1' });
  assert.deepEqual(transition(ticket('waiting_user', 'mod-1'), 'user_replied', creator), { ok: true, status: 'assigned', assigneeId: 'mod-1' });
  assert.deepEqual(transition(ticket('assigned', 'mod-1'), 'resolve', mod), { ok: true, status: 'resolved', assigneeId: 'mod-1' });
  // Resolving an unassigned ticket attributes it to the resolver; reopening clears the assignee.
  assert.deepEqual(transition(ticket('open'), 'resolve', mod), { ok: true, status: 'resolved', assigneeId: 'mod-1' });
  assert.deepEqual(transition(ticket('resolved', 'mod-1'), 'reopen', creator), { ok: true, status: 'open', assigneeId: null });

  // Permissions: participants cannot run moderator actions.
  for (const action of ['assign', 'resolve'] as const) {
    r = transition(ticket('open'), action, creator);
    assert.equal(r.ok, false, `participant must not ${action}`);
  }
  assert.equal(transition(ticket('assigned'), 'wait_for_user', creator).ok, false);
  // Only the creator un-blocks a waiting ticket, and only the creator or a moderator reopens.
  assert.equal(transition(ticket('waiting_user'), 'user_replied', stranger).ok, false);
  assert.equal(transition(ticket('waiting_user'), 'user_replied', mod).ok, false);
  assert.equal(transition(ticket('resolved'), 'reopen', stranger).ok, false);
  assert.equal(transition(ticket('resolved'), 'reopen', mod).ok, true);

  // Invalid moves are rejected with a readable reason.
  r = transition(ticket('resolved'), 'resolve', mod);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /resolved/);
  assert.equal(transition(ticket('open'), 'reopen', mod).ok, false);
  assert.equal(transition(ticket('open'), 'wait_for_user', mod).ok, false);
  assert.equal(transition(ticket('open'), 'user_replied', creator).ok, false);
}

function testDedupPolicy() {
  const thresholds = { duplicate: 0.8, related: 0.6 };
  const t = (n: number, creatorId: string, status: SimilarTicket['status'], similarity: number): SimilarTicket =>
    ({ ticketId: `id-${n}`, ticketNumber: n, creatorId, status, similarity });

  // Nothing similar → create.
  assert.deepEqual(decideDuplicate('u1', [], thresholds), { action: 'create', related: [] });

  // Own open near-duplicate wins over everything (absorbs double submissions).
  let d = decideDuplicate('u1', [t(2, 'u2', 'resolved', 0.95), t(1, 'u1', 'open', 0.85)], thresholds);
  assert.equal(d.action, 'existing_own_ticket');
  assert.equal(d.action === 'existing_own_ticket' && d.match.ticketNumber, 1);

  // Own *resolved* ticket is not "existing": they may need help again.
  d = decideDuplicate('u1', [t(1, 'u1', 'resolved', 0.9)], thresholds);
  assert.equal(d.action, 'suggest_resolution');

  // Someone else's resolved duplicate → suggest it, unless the user chose "open anyway".
  d = decideDuplicate('u1', [t(3, 'u2', 'resolved', 0.82), t(4, 'u3', 'open', 0.7)], thresholds);
  assert.equal(d.action, 'suggest_resolution');
  assert.deepEqual(d.action === 'suggest_resolution' && d.related.map(r => r.ticketNumber), [4]);
  d = decideDuplicate('u1', [t(3, 'u2', 'resolved', 0.82)], thresholds, { forceCreate: true });
  assert.deepEqual(d, { action: 'create', related: [t(3, 'u2', 'resolved', 0.82)] });

  // Someone else's open duplicate never blocks creation (their account problem isn't yours) but is linked.
  d = decideDuplicate('u1', [t(5, 'u2', 'assigned', 0.93)], thresholds);
  assert.equal(d.action, 'create');
  assert.deepEqual(d.action === 'create' && d.related.map(r => r.ticketNumber), [5]);

  // Below the duplicate bar: no suggestion, only "related" links above the lower bar, max 3.
  d = decideDuplicate('u1', [t(6, 'u1', 'open', 0.79), t(7, 'u2', 'resolved', 0.65), t(8, 'u2', 'open', 0.61), t(9, 'u2', 'open', 0.62), t(10, 'u2', 'open', 0.5)], thresholds);
  assert.equal(d.action, 'create');
  assert.deepEqual(d.action === 'create' && d.related.map(r => r.ticketNumber), [6, 7, 9]);
}

function testClassifierFloors() {
  const proposal = { title: 'Prize', summary: 's', canonicalIssue: 'Prize: payment not received', category: 'general' as const, priority: 'low' as const, reason: 'r' };
  // The model cannot downgrade a gated case.
  assert.deepEqual(applyGateFloors(proposal, { category: 'prize_payment', priority: 'high' }), { ...proposal, category: 'rewards', priority: 'high' });
  assert.equal(applyGateFloors({ ...proposal, priority: 'urgent' }, { category: 'prize_payment', priority: 'high' }).priority, 'urgent');
  assert.equal(applyGateFloors(proposal, { category: 'account_security', priority: 'urgent' }).category, 'account');
  assert.deepEqual(applyGateFloors(proposal, { category: null, priority: null }), proposal);
  assert.equal(maxPriority('normal', null), 'normal');

  const fallback = fallbackClassification(`${'x'.repeat(100)}\nsecond line`, { category: 'score_dispute', priority: 'normal' });
  assert.equal(fallback.title.length, 80);
  assert.equal(fallback.category, 'evaluation');
  assert.equal(fallback.reason, 'classifier_unavailable');
}

function testEscalationDescriptions() {
  assert.match(describeEscalation('deterministic_gate:prize_payment'), /prize payment is always handled by staff/);
  assert.match(describeEscalation('validation_downgrade:weak_evidence (0.2 < 0.3)'), /citation checks/);
  assert.match(describeEscalation('model:escalate (Docs do not cover December.)'), /^The docs do not cover this\. Docs do not cover December\.$/);
  assert.match(describeEscalation('upstream_unavailable:anthropic.messages'), /unavailable/);
  assert.match(describeEscalation('user_requested_after_answer'), /asked for a human/);
}

try {
  testStateMachine();
  testDedupPolicy();
  testClassifierFloors();
  testEscalationDescriptions();
  console.log('HackerHelp ticket tests passed (lifecycle and permissions, duplicate policy, classifier floors).');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
