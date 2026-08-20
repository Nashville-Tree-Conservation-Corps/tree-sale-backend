import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDb } from './helpers.js'
import allowlist from '../allowlist.js'

function seededDb(overrides = {}) {
    return new FakeDb({
        'staff@treeconservationcorps.org': {
            email: 'staff@treeconservationcorps.org',
            uid: null,
            claimedAt: null,
            ...overrides
        }
    })
}

describe('allowlist', () => {
    let db

    beforeEach(() => {
        db = seededDb()
        allowlist.deps.db = () => db
    })

    it('isPinned is false for a uid on no doc', async () => {
        expect(await allowlist.isPinned('uid-1')).toBe(false)
    })

    it('isPinned is true after a doc carries that uid', async () => {
        db = seededDb({ uid: 'uid-1' })
        allowlist.deps.db = () => db
        expect(await allowlist.isPinned('uid-1')).toBe(true)
    })

    it('claim pins the uid on an unclaimed doc and returns true', async () => {
        const claimed = await allowlist.claim('staff@treeconservationcorps.org', 'uid-1')
        expect(claimed).toBe(true)
        expect(db.docs['staff@treeconservationcorps.org'].uid).toBe('uid-1')
        expect(db.docs['staff@treeconservationcorps.org'].claimedAt).not.toBeNull()
    })

    it('claim returns false when no doc exists for the email', async () => {
        expect(await allowlist.claim('intruder@example.com', 'uid-9')).toBe(false)
    })

    it('claim returns false when the doc is already claimed by another uid', async () => {
        db = seededDb({ uid: 'uid-1' })
        allowlist.deps.db = () => db
        expect(await allowlist.claim('staff@treeconservationcorps.org', 'uid-2')).toBe(false)
        expect(db.docs['staff@treeconservationcorps.org'].uid).toBe('uid-1')
    })
})
