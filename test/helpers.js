import { vi } from 'vitest'

export const TEST_ENV = {
    SQUARESPACE_API_KEY: 'test-squarespace-key',
    FRONTEND_ORIGIN: 'https://tree-sale.example.com,http://localhost:5173'
}

export function applyTestEnv() {
    Object.assign(process.env, TEST_ENV)
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

// Serves one page of orders per fetch call, advertising a nextPageCursor
// until the last page, mirroring Squarespace's pagination envelope.
export function mockFetchOrderPages(pages) {
    let call = 0
    const fetchMock = vi.fn(async () => {
        const result = pages[call] ?? []
        const hasNextPage = call < pages.length - 1
        call += 1
        return {
            ok: true,
            status: 200,
            json: async () => ({
                result,
                pagination: hasNextPage
                    ? { hasNextPage: true, nextPageCursor: `cursor-${call}` }
                    : { hasNextPage: false }
            })
        }
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

export class FakeDb {
    // docs: { [email]: { email, uid, claimedAt } }
    constructor(docs = {}) {
        this.docs = docs
    }

    collection() {
        const docs = this.docs
        return {
            doc: (id) => ({ id }),
            where: (field, op, value) => ({
                limit: () => ({
                    get: async () => {
                        const matches = Object.values(docs).filter(d => d[field] === value)
                        return { empty: matches.length === 0 }
                    }
                })
            })
        }
    }

    async runTransaction(fn) {
        const docs = this.docs
        return fn({
            get: async (ref) => {
                const data = docs[ref.id]
                return { exists: data !== undefined, data: () => data }
            },
            update: (ref, patch) => {
                Object.assign(docs[ref.id], patch)
            }
        })
    }
}
