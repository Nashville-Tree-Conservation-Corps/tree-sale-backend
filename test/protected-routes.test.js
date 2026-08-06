import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { TEST_ENV, applyTestEnv, mockFetchOrders, squarespaceOrder } from './helpers.js'

applyTestEnv()

const app = (await import('../app.js')).default

const DATA_ROUTES = [
    '/api/orders',
    '/api/orders/order-1',
    '/api/customers/cust-1/orders',
    '/api/sales'
]

function validToken(email = 'staff@treeconservationcorps.org') {
    return jwt.sign({ email }, TEST_ENV.JWT_SECRET, { expiresIn: '12h' })
}

describe('auth middleware on the data routes', () => {
    // Every test stubs fetch with a success response so that a 401 can only have
    // come from the middleware, never from a real call out to Squarespace.
    let fetchMock

    beforeEach(() => {
        applyTestEnv()
        fetchMock = mockFetchOrders()
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

    it.each(DATA_ROUTES)('401s on %s with a garbage bearer token', async (route) => {
        const res = await request(app).get(route).set('Authorization', 'Bearer not-a-jwt')

        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: 'Unauthorized' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('401s on an expired token', async () => {
        const expired = jwt.sign({ email: 'staff@treeconservationcorps.org' }, TEST_ENV.JWT_SECRET, {
            expiresIn: '-1h'
        })

        const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${expired}`)

        expect(res.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('401s on a token signed with the wrong secret', async () => {
        const forged = jwt.sign({ email: 'staff@treeconservationcorps.org' }, 'wrong-secret')

        const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${forged}`)

        expect(res.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('401s when the Authorization header is missing the Bearer scheme', async () => {
        const res = await request(app).get('/api/orders').set('Authorization', validToken())

        expect(res.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('401s when the Authorization header uses a non-Bearer scheme', async () => {
        const res = await request(app).get('/api/orders').set('Authorization', `Basic ${validToken()}`)

        expect(res.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('serves /api/orders with a valid token', async () => {
        mockFetchOrders()

        const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${validToken()}`)

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
        const fetchMock = mockFetchOrders()

        const res = await request(app)
            .get('/api/customers/cust-1/orders')
            .set('Authorization', `Bearer ${validToken()}`)

        expect(res.status).toBe(200)
        expect(res.body[0].id).toBe('order-1')
        expect(fetchMock.mock.calls[0][0]).toContain('customerId=cust-1')
    })

    it('serves /api/sales with a valid token, excluding the planting service', async () => {
        mockFetchOrders([squarespaceOrder(), squarespaceOrder({ id: 'order-2' })])

        const res = await request(app).get('/api/sales').set('Authorization', `Bearer ${validToken()}`)

        expect(res.status).toBe(200)
        expect(res.body).toEqual([{ name: 'Red Maple', quantity: 4 }])
    })

    it('serves /api/orders/:id with a valid token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, status: 200, json: async () => squarespaceOrder() }))
        )

        const res = await request(app)
            .get('/api/orders/order-1')
            .set('Authorization', `Bearer ${validToken()}`)

        expect(res.status).toBe(200)
        expect(res.body.address).toBe('1 Oak St')
        expect(res.body.notes).toBe('No notes')
    })

    it('passes the Squarespace error status through for an authorized request', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
        )

        const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${validToken()}`)

        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Squarespace API error' })
    })
})
