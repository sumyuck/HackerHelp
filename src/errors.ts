/**
 * An error whose message is written for end users (validation, permissions,
 * workflow rules). Only these messages are shown in Discord; anything else
 * (database, network, provider errors) is logged and replaced with a generic reply.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** The text shown to a Discord user for an error: its own message only if it was written for them. */
export const userMessage = (error: unknown) =>
  error instanceof UserFacingError ? error.message : 'Something went wrong on our side. Please try again, or ask a moderator.';
