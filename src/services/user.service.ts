import { User, AuditLog, GlobalRole } from '../database/models';
import { logger } from '../logger';

// Load Super Admin IDs from environment
const superAdminIds = (process.env.SUPER_ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

/**
 * Audit Logger Helper
 */
export async function logAction(actorId: string, action: string, targetType?: string, targetId?: string, details?: any): Promise<void> {
  try {
    await AuditLog.create({ actorId, action, targetType, targetId, details });
    logger.info(`Audit Log: ${actorId} performed ${action} on ${targetType || 'system'} (${targetId || 'N/A'})`);
  } catch (error) {
    logger.error('Failed to write audit log:', error);
  }
}

/**
 * Checks if a user has a specific global role or is a Super Admin.
 */
export async function hasRole(discordId: string, allowedRoles: GlobalRole[]): Promise<boolean> {
  // If the user's ID is in the hardcoded SUPER_ADMIN_IDS env list, they bypass all checks.
  if (superAdminIds.includes(discordId)) {
    return true;
  }

  const user = await User.findOne({ discordId });
  if (!user) {
    return false;
  }

  // If user has super_admin role DB-side, they also bypass all checks
  if (user.roles.includes('super_admin')) {
    return true;
  }

  // Check if any allowedRoles intersect with the user's roles
  return allowedRoles.some(r => user.roles.includes(r));
}

/**
 * Returns the roles of a user.
 */
export async function getUserRoles(discordId: string): Promise<GlobalRole[]> {
  if (superAdminIds.includes(discordId)) {
    return ['super_admin', 'participant'];
  }
  const user = await User.findOne({ discordId });
  return user ? user.roles : ['participant'];
}

/**
 * Ensures a user document exists in MongoDB, returning it.
 */
export async function getOrCreateUser(discordId: string, username: string): Promise<any> {
  let user = await User.findOne({ discordId });
  if (!user) {
    const isSuperAdmin = superAdminIds.includes(discordId);
    user = await User.create({
      discordId,
      username,
      roles: isSuperAdmin ? ['super_admin', 'participant'] : ['participant']
    });
    await logAction('system', 'create_user', 'User', discordId, { username, roles: user.roles });
  }
  return user;
}

/**
 * Assigns a role to a user. Requires Super Admin or Event Admin authority (checked at the controller/command level).
 */
export async function assignUserRole(actorId: string, targetDiscordId: string, role: GlobalRole): Promise<void> {
  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) {
    throw new Error('Target user not found in database. Ask them to run `/auth` or `/register` first.');
  }

  if (user.roles.includes(role)) {
    return; // Role already assigned
  }

  user.roles.push(role);
  await user.save();
  await logAction(actorId, 'assign_role', 'User', targetDiscordId, { role });
}

/**
 * Removes a role from a user.
 */
export async function removeUserRole(actorId: string, targetDiscordId: string, role: GlobalRole): Promise<void> {
  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) {
    throw new Error('Target user not found.');
  }

  user.roles = user.roles.filter(r => r !== role) as GlobalRole[];
  if (user.roles.length === 0) {
    user.roles.push('participant'); // Ensure user has at least participant role
  }
  await user.save();
  await logAction(actorId, 'remove_role', 'User', targetDiscordId, { role });
}
