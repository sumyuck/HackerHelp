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
