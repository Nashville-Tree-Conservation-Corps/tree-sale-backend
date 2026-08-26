import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv, mockFetchOrders, mockFetchOrderPages, squarespaceOrder } from './helpers.js'

applyTestEnv()

// require (not import): see the module-identity note in protected-routes.test.js
const app = require('../app.js')
const { deps } = require('../auth.js')

function allowSignedInUser() {
    deps.verifyIdToken = vi.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'staff@treeconservationcorps.org',
        email_verified: true
    })
    deps.isPinned = vi.fn().mockResolvedValue(true)
    deps.claim = vi.fn().mockResolvedValue(false)
}

function orderIn(createdOn, overrides = {}) {
    return squarespaceOrder({ id: `order-${createdOn}-${Math.random().toString(36).slice(2, 7)}`, createdOn, ...overrides })
}

const getSales = (query = '') => request(app).get(`/api/sales${query}`).set('Authorization', 'Bearer good')

describe('/api/sales seasons', () => {
    beforeEach(() => {
        applyTestEnv()
        allowSignedInUser()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('defaults to the newest season and lists all seasons newest first', async () => {
        mockFetchOrders([
            orderIn('2025-10-01T12:00:00.000Z'),
            orderIn('2026-09-15T12:00:00.000Z'),
            orderIn('2026-03-01T12:00:00.000Z')
        ])

        const res = await getSales()

        expect(res.status).toBe(200)
        expect(res.body.season).toBe('2026-2027')
        expect(res.body.seasons).toEqual(['2026-2027', '2025-2026'])
    })

    it('defaults to the newest season with orders, not the calendar season', async () => {
        vi.useFakeTimers({ now: new Date('2027-07-15T12:00:00.000Z'), toFake: ['Date'] })
        mockFetchOrders([orderIn('2026-09-15T12:00:00.000Z')])

        const res = await getSales()

        expect(res.status).toBe(200)
        expect(res.body.season).toBe('2026-2027')
        expect(res.body.totalOrders).toBe(1)
        expect(res.body.seasons).toEqual(['2026-2027'])
    })

    it('buckets June and July orders across the season boundary', async () => {
        mockFetchOrders([
            orderIn('2026-06-30T23:59:59.000Z'),
            orderIn('2026-07-01T00:00:00.000Z')
        ])

        const res = await getSales('?season=2025-2026')

        expect(res.status).toBe(200)
        expect(res.body.totalOrders).toBe(1)
        expect(res.body.seasons).toEqual(['2026-2027', '2025-2026'])
    })

    it('reports the requested season: counts, canceled exclusion, planting exclusion, ranked byTree', async () => {
        mockFetchOrders([
            orderIn('2025-10-01T12:00:00.000Z', {
                fulfillmentStatus: 'PENDING',
                lineItems: [
                    { productName: 'Red Maple', quantity: 2, unitPricePaid: { value: '45.00' } },
                    { productName: 'Planting Service', quantity: 1, unitPricePaid: { value: '75.00' } }
                ]
            }),
            orderIn('2025-11-05T12:00:00.000Z', {
                fulfillmentStatus: 'FULFILLED',
                lineItems: [
                    { productName: 'Red Maple', quantity: 2, unitPricePaid: { value: '45.00' } },
                    { productName: 'Dogwood', quantity: 3, unitPricePaid: { value: '40.00' } }
                ]
            }),
            orderIn('2025-12-01T12:00:00.000Z', {
                fulfillmentStatus: 'CANCELED',
                lineItems: [
                    { productName: 'Red Maple', quantity: 5, unitPricePaid: { value: '45.00' } }
                ]
            })
        ])

        const res = await getSales('?season=2025-2026')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            season: '2025-2026',
            seasons: ['2025-2026'],
            totalOrders: 2,
            fulfilledOrders: 1,
            unfulfilledOrders: 1,
            canceledOrders: 1,
            treesSold: 7,
            byTree: [
                { name: 'Red Maple', quantity: 4 },
                { name: 'Dogwood', quantity: 3 }
            ]
        })
    })

    it('follows pagination cursors until all pages are read', async () => {
        const fetchMock = mockFetchOrderPages([
            [orderIn('2026-09-01T12:00:00.000Z')],
            [orderIn('2026-10-01T12:00:00.000Z')]
        ])

        const res = await getSales('?season=2026-2027')

        expect(res.status).toBe(200)
        expect(res.body.totalOrders).toBe(2)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1')
    })

    it('400s on a malformed season', async () => {
        mockFetchOrders([])

        for (const bad of ['?season=2026', '?season=2026-2028', '?season=abcd-efgh']) {
            const res = await getSales(bad)
            expect(res.status).toBe(400)
            expect(res.body).toEqual({ error: 'Invalid season' })
        }
    })

    it('returns zero counts for a valid season with no orders', async () => {
        mockFetchOrders([orderIn('2026-09-15T12:00:00.000Z')])

        const res = await getSales('?season=2024-2025')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            season: '2024-2025',
            seasons: ['2026-2027'],
            totalOrders: 0,
            fulfilledOrders: 0,
            unfulfilledOrders: 0,
            canceledOrders: 0,
            treesSold: 0,
            byTree: []
        })
    })
})
