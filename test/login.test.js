import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import {
    TEST_ENV,
    applyTestEnv,
    googlePayload,
    mockVerifyResolves,
    mockVerifyRejects,
    mockFetchOrders
} from './helpers.js'

applyTestEnv()

const app = (await import('../app.js')).default

describe('POST /api/login', () => {
    beforeEach(() => {
        applyTestEnv()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('401s when no credential is supplied', async () => {
        const res = await request(app).post('/api/login').send({})

        expect(res.status).toBe(401)
    })

    it('401s when the Google token fails verification', async () => {
        mockVerifyRejects()

        const res = await request(app).post('/api/login').send({ credential: 'bad-token' })

        expect(res.status).toBe(401)
    })

    it('passes the credential and client id to verifyIdToken', async () => {
        const verify = mockVerifyResolves(googlePayload())
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(verify).toHaveBeenCalledWith({
            idToken: 'google-id-token',
            audience: TEST_ENV.GOOGLE_CLIENT_ID
        })
    })

    it('403s when the Google email is unverified', async () => {
        mockVerifyResolves(googlePayload({ email_verified: false }))
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('403s when the email_verified claim is absent', async () => {
        mockVerifyResolves(googlePayload({ email_verified: undefined }))
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('issues a token for an allowlisted email on another Workspace domain', async () => {
        mockVerifyResolves(googlePayload({ email: 'bryan@tennesseetreeandshrub.com', hd: 'tennesseetreeandshrub.com' }))
        process.env.ALLOWED_EMAILS = 'bryan@tennesseetreeandshrub.com'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(200)
        expect(typeof res.body.token).toBe('string')
    })

    it('issues a token for an allowlisted consumer account with no hosted domain claim', async () => {
        mockVerifyResolves(googlePayload({ email: 'volunteer@gmail.com', hd: undefined }))
        process.env.ALLOWED_EMAILS = 'volunteer@gmail.com'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(200)
        expect(typeof res.body.token).toBe('string')
    })

    it('403s for a non-allowlisted email even on the NTCC domain', async () => {
        mockVerifyResolves(googlePayload({ email: 'intruder@treeconservationcorps.org', hd: 'treeconservationcorps.org' }))
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('403s when the email is not on the allowlist', async () => {
        mockVerifyResolves(googlePayload({ email: 'intruder@treeconservationcorps.org' }))
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('403s for everyone when ALLOWED_EMAILS is unset', async () => {
        mockVerifyResolves(googlePayload())
        delete process.env.ALLOWED_EMAILS

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('403s for everyone when ALLOWED_EMAILS is empty', async () => {
        mockVerifyResolves(googlePayload())
        process.env.ALLOWED_EMAILS = '   '

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(403)
    })

    it('issues a 12 hour app JWT for an allowlisted user', async () => {
        mockVerifyResolves(googlePayload())
        process.env.ALLOWED_EMAILS = 'other@treeconservationcorps.org,staff@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(200)
        expect(typeof res.body.token).toBe('string')

        const claims = jwt.verify(res.body.token, TEST_ENV.JWT_SECRET)
        expect(claims.email).toBe('staff@treeconservationcorps.org')
        expect(claims.exp - claims.iat).toBe(12 * 60 * 60)
    })

    it('matches the allowlist case-insensitively', async () => {
        mockVerifyResolves(googlePayload({ email: 'Staff@TreeConservationCorps.org' }))
        process.env.ALLOWED_EMAILS = 'STAFF@treeconservationcorps.org'

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(200)
    })

    it('tolerates whitespace around allowlist entries', async () => {
        mockVerifyResolves(googlePayload())
        process.env.ALLOWED_EMAILS = ' other@treeconservationcorps.org ,  staff@treeconservationcorps.org  '

        const res = await request(app).post('/api/login').send({ credential: 'google-id-token' })

        expect(res.status).toBe(200)
    })

    it('returns a token that is accepted by the data routes', async () => {
        mockVerifyResolves(googlePayload())
        process.env.ALLOWED_EMAILS = 'staff@treeconservationcorps.org'

        const login = await request(app).post('/api/login').send({ credential: 'google-id-token' })
        expect(login.status).toBe(200)

        mockFetchOrders()

        const orders = await request(app)
            .get('/api/orders')
            .set('Authorization', `Bearer ${login.body.token}`)

        expect(orders.status).toBe(200)
        expect(orders.body).toHaveLength(1)
        expect(orders.body[0].customerName).toBe('Ada Lovelace')
    })
})
