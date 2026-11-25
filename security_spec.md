# Fresnel — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Default-Deny Catch-All**: No document outside explicitly defined `/users/{userId}`, `/users/{userId}/private/{docId}`, and `/audits/{auditId}` paths can ever be read or written.
2. **PII Isolation (Split Collection Invariant)**: User email addresses are strictly isolated inside `/users/{userId}/private/{docId}` (`docId == 'info'`) and can only be read or written by the authenticated owner (`request.auth.uid == userId`).
3. **Identity & Ownership Integrity**:
   - A `/users/{userId}` document can only be read, created, or updated by `request.auth.uid == userId`, and `incoming().uid == userId`.
   - An `/audits/{auditId}` document can only be read, listed, created, updated, or deleted when `ownerId == request.auth.uid`, and on creation the parent user profile `/users/$(request.auth.uid)` must exist (`exists()`).
4. **Path Variable Hardening**: Every single-document target operation (`get`, `create`, `update`, `delete`) validates its path ID with `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
5. **Strict Schema & Anti-Update-Gap**:
   - Every string field enforces `.size() <= maxLength` matching `firebase-blueprint.json`.
   - Every numeric metric (`performanceBefore`, `performanceAfter`, `accessibilityBefore`, `accessibilityAfter`, etc.) is constrained to `0 <= val && val <= 100`.
   - `commitTitles` is a bounded list (`size() <= 25`) with first-element type/length guard when non-empty.
   - `createdAt`, `ownerId`, and `auditId` are strictly immutable on update, and `updatedAt` must equal `request.time`.

---

## 2. The "Dirty Dozen" Payloads (Adversarial Test Vectors)

1. **Payload 1 (Identity Spoofing on Audit Creation)**: `ownerId` set to `"victim_uid_999"` while authenticated as `"attacker_uid_111"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Shadow Field / Ghost Property Injection)**: Audit creation payload containing all valid keys plus `"isAdmin": true`. -> `PERMISSION_DENIED`
3. **Payload 3 (Unverified User Spoof)**: Write attempt by an authenticated token where `email_verified == false` and provider is not a verified OAuth token. -> `PERMISSION_DENIED`
4. **Payload 4 (PII Blanket Read Attack)**: User `"attacker_uid_111"` attempts `get` on `/users/victim_uid_999/private/info`. -> `PERMISSION_DENIED`
5. **Payload 5 (Unauthorized List Scraping)**: User `"attacker_uid_111"` attempts `list` on `/audits` without filtering `ownerId == request.auth.uid`. -> `PERMISSION_DENIED`
6. **Payload 6 (Resource / ID Poisoning)**: Document creation at `/audits/invalid$id!with*bad^chars` or ID > 128 characters. -> `PERMISSION_DENIED`
7. **Payload 7 (Value Poisoning on Update)**: Updating `performanceAfter` on `/audits/{auditId}` to `"9999"` (string) or `450` (out-of-bounds number). -> `PERMISSION_DENIED`
8. **Payload 8 (Immortal Field Mutation)**: Updating `createdAt` or `ownerId` on an existing `/audits/{auditId}` document. -> `PERMISSION_DENIED`
9. **Payload 9 (Temporal Integrity Bypass)**: Creating `/audits/{auditId}` with a forged past/future `createdAt` instead of `request.time`. -> `PERMISSION_DENIED`
10. **Payload 10 (Unbounded Array Exhaustion)**: Creating `/audits/{auditId}` with `commitTitles` containing 50 items (exceeding max 25). -> `PERMISSION_DENIED`
11. **Payload 11 (Orphaned Audit Record)**: Creating `/audits/{auditId}` when `/users/$(request.auth.uid)` does not exist in Firestore. -> `PERMISSION_DENIED`
12. **Payload 12 (Denial-of-Wallet String Bomb)**: Creating `/audits/{auditId}` with `summaryNotes` exceeding 1,000 characters. -> `PERMISSION_DENIED`
