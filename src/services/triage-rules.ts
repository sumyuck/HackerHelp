/**
 * Deterministic triage gates that run before any model call.
 *
 * Support triage has asymmetric risk: a confident wrong answer about someone's
 * prize, account, or disqualification is worse than an unnecessary escalation.
 * These high-precision rules force escalation for such cases, and the model is
 * never allowed to override them. They are intentionally narrow; anything they
 * miss still goes through retrieval-grounded model triage.
 */

export type SensitiveCategory =
  | 'prize_payment'
  | 'account_security'
  | 'disqualification_appeal'
  | 'score_dispute'
  | 'conduct_report'
  | 'personal_data';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface SensitiveMatch {
  category: SensitiveCategory;
  priority: Priority;
  reason: string;
}

interface SensitiveRule extends SensitiveMatch {
  patterns: RegExp[];
}

// [^.?!\n]{0,N} keeps each pattern within one sentence so unrelated clauses don't combine.
const SENTENCE = (n: number) => `[^.?!\\n]{0,${n}}`;

const SENSITIVE_RULES: SensitiveRule[] = [
  {
    category: 'account_security',
    priority: 'urgent',
    reason: 'Possible account compromise needs the HackerRank team.',
    patterns: [
      new RegExp(`\\b(hacked|compromised|stolen|taken over)\\b${SENTENCE(30)}\\baccount\\b`, 'i'),
      new RegExp(`\\baccount\\b${SENTENCE(30)}\\b(hacked|compromised|stolen|taken over)\\b`, 'i'),
      /\bunauthori[sz]ed (access|login|sign-?in)\b/i,
      /\bsomeone (else )?(logged|signed) (in|into)\b/i
    ]
  },
  {
    category: 'prize_payment',
    priority: 'high',
    reason: 'Prize payment status is account-specific.',
    patterns: [
      new RegExp(`\\b(not|never|haven'?t|havent|didn'?t|didnt|yet to)\\b${SENTENCE(40)}\\b(received|receive|got|gotten|paid|credited)\\b${SENTENCE(40)}\\b(prize|payment|reward|money|cash|merch\\w*|swag|payout)`, 'i'),
      new RegExp(`\\b(prize|reward|payment|payout|merch\\w*)\\b${SENTENCE(30)}\\b(pending|delayed|missing|hasn'?t arrived|not arrived|not received|not credited)\\b`, 'i'),
      /\b(bank (account|details|transfer)|paypal|wire transfer|tax form|w-?8(ben)?|w-?9|invoice)\b/i
    ]
  },
  {
    category: 'disqualification_appeal',
    priority: 'high',
    reason: 'Disqualification and appeals are decided by the HackerRank team.',
    patterns: [
      // First-person only: "what gets you disqualified?" is an informational question.
      new RegExp(`\\b(i|i'?m|i was|i'?ve|i got|my|me)\\b${SENTENCE(30)}\\b(disqualif\\w*|banned|suspended)\\b`, 'i'),
      /\bappeal\b/i
    ]
  },
  {
    category: 'score_dispute',
    priority: 'normal',
    reason: 'Score and ranking disputes need human review.',
    patterns: [
      /\b(re-?evaluat\w*|re-?grad\w*|recount)\b/i,
      new RegExp(`\\b(score|rank|ranking|grade|result)s?\\b${SENTENCE(40)}\\b(wrong|unfair|incorrect|mistake|error)\\b`, 'i'),
      new RegExp(`\\b(unfair|wrong|incorrect)\\b${SENTENCE(40)}\\b(score|rank|ranking|judge|judging|evaluation)\\b`, 'i')
    ]
  },
  {
    category: 'conduct_report',
    priority: 'high',
    reason: 'Reports about other participants are handled by moderators.',
    patterns: [
      // Requires someone else as the subject: "is using AI cheating?" is a rules question, not a report.
      new RegExp(`\\b(someone|somebody|another (participant|user|person)|a participant|this (user|person|participant)|they|he|she)\\b${SENTENCE(40)}\\b(cheat\\w*|plagiari[sz]\\w*|copied|copying|stole|stealing|harass\\w*)\\b`, 'i'),
      new RegExp(`\\breport(ing)?\\b${SENTENCE(20)}\\b(user|participant|member|person|cheat\\w*|plagiari[sz]\\w*|harass\\w*)\\b`, 'i')
    ]
  },
  {
    category: 'personal_data',
    priority: 'normal',
    reason: 'Personal data requests must be handled by HackerRank.',
    patterns: [
      new RegExp(`\\b(delete|remove|erase)\\b${SENTENCE(20)}\\b(my )?(account|data|personal (data|information))\\b`, 'i'),
      /\bgdpr\b/i
    ]
  }
];

/**
 * Folds typographic variants to ASCII before matching. Discord clients (especially
 * mobile) often send curly apostrophes, and "haven’t" must hit the same gate as "haven't".
 */
export function normalizeForRules(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/[‘’‚‛ʼ`´]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

/** Rule order is priority order: the first matching rule wins. */
export function detectSensitiveCategory(message: string): SensitiveMatch | null {
  const text = normalizeForRules(message);
  for (const rule of SENSITIVE_RULES) {
    if (rule.patterns.some(pattern => pattern.test(text))) {
      const { category, priority, reason } = rule;
      return { category, priority, reason };
    }
  }
  return null;
}

const INJECTION_PATTERNS: RegExp[] = [
  new RegExp(`\\b(ignore|disregard|forget)\\b${SENTENCE(30)}\\b(previous|prior|above|earlier|all|your|these)\\b${SENTENCE(20)}\\b(instructions?|rules|prompts?|directions|guidelines)\\b`, 'i'),
  /\b(system|developer|hidden|initial|original)\s+(prompt|instructions|message)\b/i,
  /\b(jailbreak|DAN mode|developer mode|do anything now)\b/i,
  /\byou are (now|no longer)\b/i,
  /\b(pretend|roleplay)\b[^.?!\n]{0,10}\b(to be|you are|as)\b/i,
  new RegExp(`\\b(reveal|print|show|output|repeat|leak)\\b${SENTENCE(30)}\\b(your|the)\\b${SENTENCE(20)}\\b(prompt|instructions|rules|configuration)\\b`, 'i')
];

/** Catches obvious instruction-override attempts. Subtler ones are handled by the system prompt treating input as data. */
export function detectPromptInjection(message: string): boolean {
  const text = normalizeForRules(message);
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}
