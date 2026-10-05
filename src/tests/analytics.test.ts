import assert from 'node:assert/strict';
import { computeSupportMetrics, EventFact, formatDuration, median, TicketFact } from '../analytics/support-metrics';

const t0 = new Date('2026-10-01T10:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const ev = (type: EventFact['type'], n = 1): EventFact[] => Array.from({ length: n }, () => ({ type }));
const ticket = (number: number, over: Partial<TicketFact> = {}): TicketFact => ({
  number, canonicalIssue: 'Submission: portal upload fails', category: 'submission', status: 'open',
  createdAt: at(number), firstModeratorActionAt: null, resolvedAt: null, addedToKnowledgeBase: false, ...over
});

function testEmptyWindow() {
  const m = computeSupportMetrics([], []);
  assert.equal(m.questions.total, 0);
  // Nothing to divide by: report n/a rather than 0%.
  assert.equal(m.selfServe.rate, null);
  assert.equal(m.timing.medianToFirstModeratorActionMs, null);
  assert.equal(m.timing.medianToResolutionMs, null);
  assert.deepEqual(m.topUnresolvedIssues, []);
}

function testCounts() {
  const events = [
    ...ev('question_answered', 6), ...ev('question_escalated', 3), ...ev('question_clarified'),
    ...ev('question_out_of_scope'), ...ev('question_refused'), ...ev('question_error'),
    ...ev('answer_marked_helpful', 4), ...ev('resolution_reused'), ...ev('duplicate_prevented', 2),
    // Not questions: must not inflate question volume.
    ...ev('ticket_created', 3), ...ev('ticket_transition', 5)
  ];
  const tickets = [
    ticket(1, { status: 'resolved', category: 'rewards', firstModeratorActionAt: at(31), resolvedAt: at(121), addedToKnowledgeBase: true }),
    ticket(2, { status: 'assigned', firstModeratorActionAt: at(12) }),
    ticket(3)
  ];
  const m = computeSupportMetrics(events, tickets);

  assert.equal(m.questions.total, 13);
  assert.deepEqual(m.questions.byOutcome, { answered: 6, clarify: 1, escalated: 3, out_of_scope: 1, refused: 1, error: 1 });
  assert.equal(m.selfServe.confirmed, 5);
  // 5 confirmed self-serve vs 3 tickets.
  assert.equal(m.selfServe.rate, 5 / 8);
  assert.deepEqual(m.tickets.byStatus, { open: 1, assigned: 1, waiting_user: 0, resolved: 1 });
  assert.deepEqual(m.tickets.byCategory, { rewards: 1, submission: 2 });
  assert.equal(m.tickets.duplicatesPrevented, 2);
  assert.equal(m.tickets.addedToKnowledgeBase, 1);

  // First action: ticket 1 after 30m, ticket 2 after 10m; ticket 3 still waiting.
  assert.equal(m.timing.medianToFirstModeratorActionMs, 20 * 60_000);
  assert.equal(m.timing.awaitingFirstModeratorAction, 1);
  assert.equal(m.timing.medianToResolutionMs, 120 * 60_000);
  assert.equal(m.timing.resolved, 1);
}

function testUnresolvedIssues() {
  const tickets = [
    ticket(1, { canonicalIssue: 'Prize: payment not received', category: 'rewards' }),
    ticket(2, { canonicalIssue: 'Submission: portal upload fails' }),
    // Case and trailing punctuation differ between classifier calls; still the same issue.
    ticket(3, { canonicalIssue: 'submission: portal upload fails.' }),
    ticket(4, { canonicalIssue: 'Submission: Portal upload fails', status: 'waiting_user' }),
    // Resolved tickets are not "unresolved issues".
    ticket(5, { canonicalIssue: 'Prize: payment not received', status: 'resolved', resolvedAt: at(60) }),
    ticket(6, { canonicalIssue: 'Interview: schedule unclear', category: 'interview', createdAt: at(-60) })
  ];
  const top = computeSupportMetrics([], tickets).topUnresolvedIssues;
  assert.equal(top[0].tickets, 3);
  assert.deepEqual(top[0].ticketNumbers, [2, 3, 4]);
  assert.equal(top[0].canonicalIssue, 'Submission: portal upload fails', 'labelled by the oldest ticket');
  // Ties broken by the longest wait.
  assert.deepEqual(top.slice(1).map(i => i.canonicalIssue), ['Interview: schedule unclear', 'Prize: payment not received']);
  assert.equal(computeSupportMetrics([], tickets, { topIssues: 1 }).topUnresolvedIssues.length, 1);
}

function testHelpers() {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(formatDuration(null), 'n/a');
  assert.equal(formatDuration(20_000), '<1m');
  assert.equal(formatDuration(45 * 60_000), '45m');
  assert.equal(formatDuration(150 * 60_000), '2h 30m');
  assert.equal(formatDuration(3 * 24 * 3_600_000 + 5 * 3_600_000), '3d 5h');
}

try {
  testEmptyWindow();
  testCounts();
  testUnresolvedIssues();
  testHelpers();
  console.log('HackerHelp analytics tests passed (outcome counts, self-serve rate, medians, unresolved issue grouping).');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
