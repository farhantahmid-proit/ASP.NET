/**
 * Phase 0: Firestore Security Rules Adversarial Test Suite ("Dirty Dozen" Payloads)
 * Verifies that all 12 adversarial payloads against /users, /users/{uid}/private, and /audits
 * return PERMISSION_DENIED under the hardened ruleset.
 */

export interface DirtyDozenTestVector {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_VECTORS: DirtyDozenTestVector[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Audit Creation',
    collectionPath: '/audits/audit_spoof_01',
    operation: 'create',
    authUid: 'attacker_uid_111',
    emailVerified: true,
    payload: {
      auditId: 'audit_spoof_01',
      ownerId: 'victim_uid_999',
      repoFullName: 'owner/repo',
      repoUrl: 'https://github.com/owner/repo',
      runPhase: 'static',
      mode: 'live',
      totalCommitsCount: 12,
      selectedCommitsCount: 12,
      performanceBefore: 64,
      performanceAfter: 94,
      accessibilityBefore: 70,
      accessibilityAfter: 96,
      bestPracticesBefore: 78,
      bestPracticesAfter: 95,
      seoBefore: 80,
      seoAfter: 98,
      securityBefore: 72,
      securityAfter: 94,
      summaryNotes: 'Spoofed owner record',
      commitTitles: ['Add fetchpriority="high" to hero image']
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Shadow Field / Ghost Property Injection',
    collectionPath: '/audits/audit_ghost_02',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      auditId: 'audit_ghost_02',
      ownerId: 'user_uid_1',
      isAdmin: true
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'Unverified Email Spoof Attack',
    collectionPath: '/audits/audit_unverified_03',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: false,
    payload: {
      auditId: 'audit_unverified_03',
      ownerId: 'user_uid_1'
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'PII Blanket Read Attack on /users/{uid}/private/info',
    collectionPath: '/users/victim_uid_999/private/info',
    operation: 'get',
    authUid: 'attacker_uid_111',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Unauthorized List Scraping on /audits',
    collectionPath: '/audits',
    operation: 'list',
    authUid: 'attacker_uid_111',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Path Variable ID Poisoning',
    collectionPath: '/audits/invalid$id!poison',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      auditId: 'invalid$id!poison',
      ownerId: 'user_uid_1'
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Value Poisoning on Update (Out-of-Bounds Metric)',
    collectionPath: '/audits/audit_valid_01',
    operation: 'update',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      performanceAfter: 999
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Immortal Field Mutation (Changing ownerId on Update)',
    collectionPath: '/audits/audit_valid_01',
    operation: 'update',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      ownerId: 'other_user_2'
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Temporal Integrity Bypass (Forged createdAt Timestamp)',
    collectionPath: '/audits/audit_time_09',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      auditId: 'audit_time_09',
      ownerId: 'user_uid_1',
      createdAt: '1999-01-01T00:00:00Z'
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'Unbounded Array Exhaustion (>25 commitTitles)',
    collectionPath: '/audits/audit_array_10',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      auditId: 'audit_array_10',
      ownerId: 'user_uid_1',
      commitTitles: new Array(30).fill('Commit title')
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Orphaned Audit Record (Missing /users/{uid} Parent Profile)',
    collectionPath: '/audits/audit_orphan_11',
    operation: 'create',
    authUid: 'non_existent_user_uid',
    emailVerified: true,
    payload: {
      auditId: 'audit_orphan_11',
      ownerId: 'non_existent_user_uid'
    },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Denial-of-Wallet String Bomb (>1000 chars summaryNotes)',
    collectionPath: '/audits/audit_bomb_12',
    operation: 'create',
    authUid: 'user_uid_1',
    emailVerified: true,
    payload: {
      auditId: 'audit_bomb_12',
      ownerId: 'user_uid_1',
      summaryNotes: 'X'.repeat(2000)
    },
    expectedOutcome: 'PERMISSION_DENIED'
  }
];
