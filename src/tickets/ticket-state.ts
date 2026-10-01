/**
 * Ticket lifecycle as a pure state machine. Every status change in the
 * system goes through transition(), so the allowed moves and who may make
 * them are defined (and tested) in exactly one place.
 *
 *   open ──assign──► assigned ──wait──► waiting_user
 *    │                 ▲  │                │   │
 *    │                 │  └────resolve─┐   │   │ user replies → assigned
 *    │                 └───────────────┼───┘   │
 *    └──────────────resolve────────────┴───────┴──► resolved ──reopen──► open
 */

export type TicketStatus = 'open' | 'assigned' | 'waiting_user' | 'resolved';
export type TicketAction = 'assign' | 'wait_for_user' | 'user_replied' | 'resolve' | 'reopen';

export interface Actor {
  id: string;
  isModerator: boolean;
}

export interface TicketSnapshot {
  status: TicketStatus;
  creatorId: string;
  assigneeId: string | null;
}

export type TransitionResult =
  | { ok: true; status: TicketStatus; assigneeId: string | null }
  | { ok: false; error: string };

interface Rule {
  from: TicketStatus[];
  to: TicketStatus;
  allowed: (actor: Actor, ticket: TicketSnapshot) => boolean;
  forbidden: string;
}

const moderatorOnly = (actor: Actor) => actor.isModerator;

const RULES: Record<TicketAction, Rule> = {
  assign: {
    from: ['open', 'assigned', 'waiting_user'],
    to: 'assigned',
    allowed: moderatorOnly,
    forbidden: 'Only moderators can assign tickets.'
  },
  wait_for_user: {
    from: ['assigned'],
    to: 'waiting_user',
    allowed: moderatorOnly,
    forbidden: 'Only moderators can mark a ticket as waiting on the participant.'
  },
  user_replied: {
    from: ['waiting_user'],
    to: 'assigned',
    // Only the participant who opened the ticket un-blocks it.
    allowed: (actor, ticket) => actor.id === ticket.creatorId,
    forbidden: 'Only the ticket creator can reply to a waiting ticket.'
  },
  resolve: {
    from: ['open', 'assigned', 'waiting_user'],
    to: 'resolved',
    allowed: moderatorOnly,
    forbidden: 'Only moderators can resolve tickets.'
  },
  reopen: {
    from: ['resolved'],
    to: 'open',
    // The creator can reopen if the fix didn't work; moderators can always reopen.
    allowed: (actor, ticket) => actor.isModerator || actor.id === ticket.creatorId,
    forbidden: 'Only the ticket creator or a moderator can reopen a ticket.'
  }
};

export function transition(
  ticket: TicketSnapshot,
  action: TicketAction,
  actor: Actor,
  options: { assigneeId?: string } = {}
): TransitionResult {
  const rule = RULES[action];
  if (!rule.allowed(actor, ticket)) return { ok: false, error: rule.forbidden };
  if (!rule.from.includes(ticket.status)) {
    return { ok: false, error: `Cannot ${action.replace(/_/g, ' ')} a ticket that is ${ticket.status.replace('_', ' ')}.` };
  }

  let assigneeId = ticket.assigneeId;
  if (action === 'assign') assigneeId = options.assigneeId ?? actor.id;
  if (action === 'reopen') assigneeId = null;
  // Resolving keeps the assignee, so analytics can attribute resolutions.
  if (action === 'resolve' && !assigneeId) assigneeId = actor.id;

  return { ok: true, status: rule.to, assigneeId };
}

export const OPEN_STATUSES: TicketStatus[] = ['open', 'assigned', 'waiting_user'];
