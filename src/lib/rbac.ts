export type WorkspaceRole = 'Admin' | 'Editor' | 'Viewer'

export interface RolePermissions {
  role: WorkspaceRole
  canViewDashboard: boolean
  canCreateProject: boolean
  canRunAudit: boolean
  canCreateTask: boolean
  canModifyTask: boolean
  canDeleteTask: boolean
  canManageRoles: boolean
  canManageSchedules: boolean
  canModifyWorkspaceSettings: boolean
  canManageSeoBriefs: boolean
  canManageBrandGuard: boolean
  canManageSocialDrafts: boolean
  canEditKnowledge: boolean
  canDeleteKnowledge: boolean
}

export type RbacPermissionKey = keyof Omit<RolePermissions, 'role'>

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  Admin: 'Admin',
  Editor: 'Editor',
  Viewer: 'Viewer',
}

export function normalizeWorkspaceRole(rawRole?: string | null): WorkspaceRole {
  const normalized = (rawRole ?? '').trim().toLowerCase()
  if (normalized === 'admin') return 'Admin'
  if (normalized === 'editor') return 'Editor'
  if (normalized === 'viewer') return 'Viewer'
  return 'Viewer'
}

export function getRolePermissions(rawRole?: string | null): RolePermissions {
  const role = normalizeWorkspaceRole(rawRole)
  switch (role) {
    case 'Admin':
      return {
        role,
        canViewDashboard: true,
        canCreateProject: true,
        canRunAudit: true,
        canCreateTask: true,
        canModifyTask: true,
        canDeleteTask: true,
        canManageRoles: true,
        canManageSchedules: true,
        canModifyWorkspaceSettings: true,
        canManageSeoBriefs: true,
        canManageBrandGuard: true,
        canManageSocialDrafts: true,
        canEditKnowledge: true,
        canDeleteKnowledge: true,
      }
    case 'Editor':
      return {
        role,
        canViewDashboard: true,
        canCreateProject: true,
        canRunAudit: true,
        canCreateTask: true,
        canModifyTask: true,
        canDeleteTask: false,
        canManageRoles: false,
        canManageSchedules: true,
        canModifyWorkspaceSettings: false,
        canManageSeoBriefs: true,
        canManageBrandGuard: true,
        canManageSocialDrafts: true,
        canEditKnowledge: true,
        canDeleteKnowledge: false,
      }
    case 'Viewer':
    default:
      return {
        role: 'Viewer',
        canViewDashboard: false,
        canCreateProject: false,
        canRunAudit: false,
        canCreateTask: false,
        canModifyTask: false,
        canDeleteTask: false,
        canManageRoles: false,
        canManageSchedules: false,
        canModifyWorkspaceSettings: false,
        canManageSeoBriefs: false,
        canManageBrandGuard: false,
        canManageSocialDrafts: false,
        canEditKnowledge: false,
        canDeleteKnowledge: false,
      }
  }
}

export function resolveEffectiveRole(input?: {
  activeRole?: string | null
  activeUserId?: string | null
  memberRoles?: Record<string, string> | null
} | null): WorkspaceRole {
  if (!input) return 'Admin'
  if (input.activeRole) {
    return normalizeWorkspaceRole(input.activeRole)
  }
  if (input.activeUserId && input.memberRoles?.[input.activeUserId]) {
    return normalizeWorkspaceRole(input.memberRoles[input.activeUserId])
  }
  return 'Admin'
}

export function hasWorkspacePermission(
  rawRole: string | null | undefined,
  permission: RbacPermissionKey,
): boolean {
  return getRolePermissions(rawRole)[permission]
}

export function assertRbacPermission(
  rawRole: string | null | undefined,
  permission: RbacPermissionKey,
  actionLabel: string,
): void {
  const role = normalizeWorkspaceRole(rawRole)
  const perms = getRolePermissions(role)
  if (!perms[permission]) {
    throw new Error(
      `Permission denied: ${ROLE_LABELS[role]} role is not authorized to ${actionLabel}.`,
    )
  }
}
