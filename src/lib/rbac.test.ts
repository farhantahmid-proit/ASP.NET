import { describe, expect, it } from 'vitest'
import {
  assertRbacPermission,
  getRolePermissions,
  hasWorkspacePermission,
  normalizeWorkspaceRole,
  resolveEffectiveRole,
} from './rbac'

describe('lib/rbac', () => {
  it('normalizes lowercase and title-case roles and defaults unknown values to Viewer', () => {
    expect(normalizeWorkspaceRole('admin')).toBe('Admin')
    expect(normalizeWorkspaceRole('ADMIN')).toBe('Admin')
    expect(normalizeWorkspaceRole('editor')).toBe('Editor')
    expect(normalizeWorkspaceRole('viewer')).toBe('Viewer')
    expect(normalizeWorkspaceRole('guest')).toBe('Viewer')
    expect(normalizeWorkspaceRole(null)).toBe('Viewer')
  })

  it('grants appropriate permissions for Admin, Editor, and Viewer roles', () => {
    const adminPerms = getRolePermissions('admin')
    expect(adminPerms.canManageRoles).toBe(true)
    expect(adminPerms.canDeleteTask).toBe(true)
    expect(adminPerms.canModifyWorkspaceSettings).toBe(true)

    const editorPerms = getRolePermissions('editor')
    expect(editorPerms.canRunAudit).toBe(true)
    expect(editorPerms.canManageRoles).toBe(false)
    expect(editorPerms.canDeleteTask).toBe(false)

    const viewerPerms = getRolePermissions('viewer')
    expect(viewerPerms.canRunAudit).toBe(false)
    expect(hasWorkspacePermission('viewer', 'canCreateTask')).toBe(false)
  })

  it('resolves effective workspace roles and enforces permission assertions', () => {
    expect(resolveEffectiveRole({ activeRole: 'editor' })).toBe('Editor')
    expect(
      resolveEffectiveRole({ activeUserId: 'usr-1', memberRoles: { 'usr-1': 'admin' } }),
    ).toBe('Admin')
    expect(resolveEffectiveRole(null)).toBe('Admin')

    expect(() =>
      assertRbacPermission('admin', 'canManageRoles', 'manage workspace roles'),
    ).not.toThrow()
    expect(() =>
      assertRbacPermission('editor', 'canManageRoles', 'manage workspace roles'),
    ).toThrow(/Permission denied: Editor role/)
  })
})
