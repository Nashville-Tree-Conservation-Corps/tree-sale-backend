import { vi } from 'vitest'
import { OAuth2Client } from 'google-auth-library'

export const TEST_ENV = {
    JWT_SECRET: 'test-jwt-secret',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_WORKSPACE_DOMAIN: 'treeconservationcorps.org',
    SQUARESPACE_API_KEY: 'test-squarespace-key',
    FRONTEND_ORIGIN: 'https://tree-sale.example.com,http://localhost:5173'
}

export function applyTestEnv() {
    Object.assign(process.env, TEST_ENV)
    delete process.env.ALLOWED_EMAILS
}

export function googlePayload(overrides = {}) {
    return {
        email: 'staff@treeconservationcorps.org',
        email_verified: true,
        hd: 'treeconservationcorps.org',
        ...overrides
    }
}

export function mockVerifyResolves(payload) {
    return vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
        getPayload: () => payload
    })
}

export function mockVerifyRejects(message = 'Invalid token signature') {
    return vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(new Error(message))
}

export function squarespaceOrder(overrides = {}) {
    return {
        id: 'order-1',
        customerId: 'cust-1',
        createdOn: '2026-03-01T12:00:00.000Z',
        fulfillmentStatus: 'PENDING',
        shippingAddress: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            address1: '1 Oak St',
            postalCode: '55401',
            city: 'Minneapolis',
            state: 'MN'
        },
        lineItems: [
            { productName: 'Red Maple', quantity: 2, unitPricePaid: { value: '45.00' } },
            { productName: 'Planting Service', quantity: 1, unitPricePaid: { value: '75.00' } }
        ],
        discountLines: [],
        grandTotal: { value: '165.00' },
        ...overrides
    }
}

export function mockFetchOrders(orders = [squarespaceOrder()]) {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: orders })
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}
