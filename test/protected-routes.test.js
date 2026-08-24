import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv, mockFetchOrders, squarespaceOrder } from './helpers.js'

applyTestEnv()

// require (not import) app.js and auth.js: app.js pulls in auth.js via
// require internally, and under Vitest a static ESM import of auth.js
// resolves to a separate module instance, so mutating its `deps` export
// would silently not affect the middleware app.js actually uses.
const app = require('../app.js')
const { deps } = require('../auth.js')

const DATA_ROUTES = [
    '/api/orders',
    '/api/orders/order-1',
    '/api/customers/cust-1/orders',
    '/api/sales'
]

function allowSignedInUser() {
    deps.verifyIdToken = vi.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'staff@treeconservationcorps.org',
        email_verified: true
    })
    deps.isPinned = vi.fn().mockResolvedValue(true)
    deps.claim = vi.fn().mockResolvedValue(false)
}

describe('auth middleware on the data routes', () => {
    // Every test stubs fetch with a success response so that a 401 can only have
    // come from the middleware, never from a real call out to Squarespace.
    let fetchMock

    beforeEach(() => {
        applyTestEnv()
        fetchMock = mockFetchOrders()
        deps.verifyIdToken = vi.fn().mockRejectedValue(new Error('invalid'))
        deps.isPinned = vi.fn().mockResolvedValue(false)
        deps.claim = vi.fn().mockResolvedValue(false)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it.each(DATA_ROUTES)('401s on %s with no Authorization header', async (route) => {
        const res = await request(app).get(route)

        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: 'Unauthorized' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(DATA_ROUTES)('401s on %s with a rejected token', async (route) => {
        const res = await request(app).get(route).set('Authorization', 'Bearer not-a-firebase-token')

        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: 'Unauthorized' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(DATA_ROUTES)('403s on %s for a valid token with no allowlist match', async (route) => {
        deps.verifyIdToken = vi.fn().mockResolvedValue({
            uid: 'uid-9',
            email: 'stranger@example.com',
            email_verified: true
        })

        const res = await request(app).get(route).set('Authorization', 'Bearer valid-but-unlisted')

        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Forbidden' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('404s on /api/login (route deleted)', async () => {
        // authMiddleware runs for the whole /api prefix ahead of route matching,
        // so an unauthenticated request 401s before Express can 404 on the
        // missing route. Authenticate first to actually exercise the 404.
        allowSignedInUser()

        const res = await request(app).post('/api/login').set('Authorization', 'Bearer good').send({ credential: 'x' })

        expect(res.status).toBe(404)
    })

    it('serves /api/orders with a valid token', async () => {
        allowSignedInUser()
        mockFetchOrders()

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body).toEqual([
            {
                id: 'order-1',
                customerId: 'cust-1',
                customerName: 'Ada Lovelace',
                zipCode: '55401',
                city: 'Minneapolis',
                state: 'MN',
                date: '2026-03-01T12:00:00.000Z',
                status: 'PENDING',
                includesPlanting: true,
                hasDiscount: false,
                items: [
                    { name: 'Red Maple', quantity: 2, price: '45.00' },
                    { name: 'Planting Service', quantity: 1, price: '75.00' }
                ],
                totalQuantity: 3,
                total: '165.00'
            }
        ])
    })

    it('serves /api/customers/:customerId/orders with a valid token', async () => {
        allowSignedInUser()
        const fetchMock = mockFetchOrders()

        const res = await request(app)
            .get('/api/customers/cust-1/orders')
            .set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body[0].id).toBe('order-1')
        expect(fetchMock.mock.calls[0][0]).toContain('customerId=cust-1')
    })

    it('serves /api/sales with a valid token, excluding the planting service', async () => {
        allowSignedInUser()
        mockFetchOrders([squarespaceOrder(), squarespaceOrder({ id: 'order-2' })])

        const res = await request(app).get('/api/sales').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body.season).toBe('2025-2026')
        expect(res.body.treesSold).toBe(4)
        expect(res.body.byTree).toEqual([{ name: 'Red Maple', quantity: 4 }])
    })

    it('serves /api/orders/:id with a valid token', async () => {
        allowSignedInUser()
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, status: 200, json: async () => squarespaceOrder() }))
        )

        const res = await request(app)
            .get('/api/orders/order-1')
            .set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body.address).toBe('1 Oak St')
        expect(res.body.notes).toBe('No notes')
    })

    it('passes the Squarespace error status through for an authorized request', async () => {
        allowSignedInUser()
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
        )

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Squarespace is rate limiting requests. Wait a minute, then refresh.' })
    })

    it('passes the Squarespace error message through when the body has one', async () => {
        allowSignedInUser()
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: false,
                status: 429,
                json: async () => ({ type: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Retry in 30 seconds.' })
            }))
        )

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Rate limit exceeded. Retry in 30 seconds.' })
    })
})
