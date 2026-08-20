import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { authMiddleware, deps } from '../auth.js'

function makeApp() {
    const app = express()
    app.use('/api', authMiddleware)
    app.get('/api/data', (req, res) => res.json({ user: req.user.uid }))
    return app
}

function decodedToken(overrides = {}) {
    return {
        uid: 'uid-1',
        email: 'Staff@treeconservationcorps.org',
        email_verified: true,
        ...overrides
    }
}

describe('authMiddleware', () => {
    beforeEach(() => {
        deps.verifyIdToken = vi.fn().mockResolvedValue(decodedToken())
        deps.isPinned = vi.fn().mockResolvedValue(false)
        deps.claim = vi.fn().mockResolvedValue(false)
    })

    it('401s with no Authorization header', async () => {
        const res = await request(makeApp()).get('/api/data')
        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: 'Unauthorized' })
        expect(deps.verifyIdToken).not.toHaveBeenCalled()
    })

    it('401s with a non-Bearer scheme', async () => {
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Basic abc')
        expect(res.status).toBe(401)
    })

    it('401s when token verification rejects', async () => {
        deps.verifyIdToken = vi.fn().mockRejectedValue(new Error('bad token'))
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer bad')
        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: 'Unauthorized' })
    })

    it('200s for a pinned uid without attempting a claim', async () => {
        deps.isPinned = vi.fn().mockResolvedValue(true)
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ user: 'uid-1' })
        expect(deps.claim).not.toHaveBeenCalled()
    })

    it('claims with the lowercased email for a verified unpinned user and 200s', async () => {
        deps.claim = vi.fn().mockResolvedValue(true)
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(200)
        expect(deps.claim).toHaveBeenCalledWith('staff@treeconservationcorps.org', 'uid-1')
    })

    it('403s without claiming when email is unverified', async () => {
        deps.verifyIdToken = vi.fn().mockResolvedValue(decodedToken({ email_verified: false }))
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Forbidden' })
        expect(deps.claim).not.toHaveBeenCalled()
    })

    it('403s without claiming when the token has no email', async () => {
        deps.verifyIdToken = vi.fn().mockResolvedValue(decodedToken({ email: undefined }))
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(403)
        expect(deps.claim).not.toHaveBeenCalled()
    })

    it('403s when verified but the claim finds no unclaimed doc', async () => {
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Forbidden' })
    })

    it('500s when the allowlist lookup throws', async () => {
        deps.isPinned = vi.fn().mockRejectedValue(new Error('firestore down'))
        const res = await request(makeApp()).get('/api/data').set('Authorization', 'Bearer good')
        expect(res.status).toBe(500)
        expect(res.body).toEqual({ error: 'Server error' })
    })
})
