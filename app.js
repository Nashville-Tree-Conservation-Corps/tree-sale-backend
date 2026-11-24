const express = require('express')
const cors = require('cors')
const { authMiddleware } = require('./auth')
const orderFlags = require('./orderFlags')

const app = express()

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

// Everything under /api requires a Firebase ID token from an allowlisted user
app.use('/api', authMiddleware)

// Squarespace returns shippingAddress: null on orders with nothing to ship
// (in-person pickup, digital goods); fall back to the billing address.
// customerName must stay a string: the frontend sorts and uppercases it.
function customerFields(order) {
    const address = order.shippingAddress ?? order.billingAddress
    return {
        customerName: address ? `${address.firstName} ${address.lastName}` : 'Unknown',
        address: address?.address1 ?? null,
        zipCode: address?.postalCode ?? null,
        city: address?.city ?? null,
        state: address?.state ?? null,
        // The shipping phone is sometimes blank while billing has one
        phone: order.shippingAddress?.phone || order.billingAddress?.phone || null
    }
}


// Line items are one of three kinds. Only trees count toward the tree sale
// totals; planting services and tree guards are tracked separately.
function itemKind(productName) {
    const name = productName.toLowerCase()
    if (name.includes('planting')) return 'planting'
    if (name.includes('guard')) return 'guard'
    return 'tree'
}

// Squarespace sends product options (e.g. Size: 3 inch) as variantOptions and
// any customer-typed text as customizations. Neither is part of productName, so
// without these two the app can't tell a 3" tree from a smaller one.
function itemVariant(item) {
    const options = (item.variantOptions ?? [])
        .filter(option => option.optionName && option.value)
        .map(option => `${option.optionName}: ${option.value}`)
    return options.length > 0 ? options.join(', ') : null
}

function itemCustomizations(item) {
    return (item.customizations ?? [])
        .filter(c => c.label && c.value)
        .map(c => `${c.label}: ${c.value}`)
}

// Name used to tell items apart when totaling, e.g. "White Oak (Size: 3 inch)"
function itemLabel(item) {
    const variant = itemVariant(item)
    return variant ? `${item.productName} (${variant})` : item.productName
}

function sumQuantity(order, kind) {
    return order.lineItems
        .filter(item => itemKind(item.productName) === kind)
        .reduce((sum, item) => sum + item.quantity, 0)
}

// Fields shared by every order response. `orderNumber` is the customer-facing
// number; `id` is Squarespace's long backend id and is only for routing.
function orderSummary(order, called811) {
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        date: order.createdOn,
        status: order.fulfillmentStatus,
        includesPlanting: order.lineItems.some(item => itemKind(item.productName) === 'planting'),
        hasDiscount: order.discountLines && order.discountLines.length > 0,
        called811,
        items: order.lineItems.map(item => ({
            name: item.productName,
            variant: itemVariant(item),
            customizations: itemCustomizations(item),
            kind: itemKind(item.productName),
            quantity: item.quantity,
            price: item.unitPricePaid.value
        })),
        totalQuantity: sumQuantity(order, 'tree'),
        plantingQuantity: sumQuantity(order, 'planting'),
        guardQuantity: sumQuantity(order, 'guard'),
        total: order.grandTotal.value
    }
}

// Get ALL orders (with optional status filter)
app.get('/api/orders', async (req, res) => {
    try {
        const { status } = req.query
        const { orders, errorStatus, errorMessage } = await fetchAllOrders(status ? `?fulfillmentStatus=${status}` : '')

        if (errorStatus) {
            return res.status(errorStatus).json({ error: errorMessage })
        }

        const called = await orderFlags.getCalled811Map()

        const simplified = orders.map(order => {
            const { customerName, zipCode, city, state, phone } = customerFields(order)
            return {
                ...orderSummary(order, called[order.id] === true),
                customerName,
                zipCode,
                city,
                state,
                phone
            }
        })

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching orders' })
    }
})

// Get ONE specific order by id
app.get('/api/orders/:id', async (req, res) => {
    try {
        const response = await fetch(`https://api.squarespace.com/1.0/commerce/orders/${req.params.id}`, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: await squarespaceErrorMessage(response) })
        }

        const order = await response.json()

        const simplified = {
            ...orderSummary(order, await orderFlags.getCalled811(order.id)),
            ...customerFields(order),
            notes: order.internalNotes?.map(n => n.content).join(", ") || "No notes"
        }

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching order' })
    }
})

// Mark whether 811 has been called for an order
app.put('/api/orders/:id/811', async (req, res) => {
    const { called } = req.body ?? {}

    if (typeof called !== 'boolean') {
        return res.status(400).json({ error: 'called must be true or false' })
    }

    try {
        await orderFlags.setCalled811(req.params.id, called, req.user?.uid)
        res.json({ id: req.params.id, called811: called })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error saving 811 status' })
    }
})

// Mark an order fulfilled in Squarespace. This is one-way: the Commerce API
// has no "unfulfill", so only PENDING orders are accepted and customers are
// not emailed (these are pickup/event orders; Squarespace's own email would
// otherwise claim the order shipped).
app.post('/api/orders/:id/fulfill', async (req, res) => {
    const headers = {
        'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
        'User-Agent': 'tree-sale-app'
    }
    const orderUrl = `https://api.squarespace.com/1.0/commerce/orders/${encodeURIComponent(req.params.id)}`

    try {
        const current = await fetch(orderUrl, { headers })

        if (!current.ok) {
            return res.status(current.status).json({ error: await squarespaceErrorMessage(current) })
        }

        const { fulfillmentStatus } = await current.json()

        if (fulfillmentStatus !== 'PENDING') {
            return res.status(409).json({ error: `Order is already ${fulfillmentStatus.toLowerCase()}` })
        }

        const response = await fetch(`${orderUrl}/fulfillments`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ shouldSendNotification: false, shipments: [] })
        })

        if (response.status === 401 || response.status === 403) {
            return res.status(502).json({
                error: 'Squarespace refused the update. The API key needs Orders read and write permission.'
            })
        }

        if (!response.ok) {
            return res.status(response.status).json({ error: await squarespaceErrorMessage(response) })
        }

        res.json({ id: req.params.id, status: 'FULFILLED' })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fulfilling order' })
    }
})

// Get all orders for a specific customer
app.get('/api/customers/:customerId/orders', async (req, res) => {
    try {
        const { orders, errorStatus, errorMessage } = await fetchAllOrders(`?customerId=${req.params.customerId}`)

        if (errorStatus) {
            return res.status(errorStatus).json({ error: errorMessage })
        }

        const called = await orderFlags.getCalled811Map()

        const simplified = orders.map(order => {
            const { customerName, zipCode, city, state, phone } = customerFields(order)
            return {
                ...orderSummary(order, called[order.id] === true),
                customerName,
                zipCode,
                city,
                state,
                phone
            }
        })

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching customer orders' })
    }
})

// A sale season runs July 1 through June 30 and is named "2026-2027"
function seasonOf(createdOn) {
    const date = new Date(createdOn)
    const year = date.getUTCFullYear()
    return date.getUTCMonth() >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

function isValidSeason(value) {
    const match = /^(\d{4})-(\d{4})$/.exec(value)
    return match !== null && Number(match[2]) === Number(match[1]) + 1
}

// Squarespace error bodies carry a human-readable `message` field
// ({ type, subtype, message, details }); pass it through when present.
// Their rate limit cooldown is documented as one minute.
async function squarespaceErrorMessage(response) {
    const body = await response.json().catch(() => null)
    if (body?.message) return body.message
    if (response.status === 429) return 'Squarespace is rate limiting requests. Wait a minute, then refresh.'
    return `Squarespace API error (status ${response.status})`
}

// Follows Squarespace's cursor pagination. `query` applies to the first
// request only: the cursor encodes the original filter, and Squarespace
// rejects cursors combined with other parameters.
async function fetchAllOrders(query = '') {
    const orders = []
    let cursor = null

    do {
        const url = cursor
            ? `https://api.squarespace.com/1.0/commerce/orders?cursor=${cursor}`
            : `https://api.squarespace.com/1.0/commerce/orders${query}`

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return { errorStatus: response.status, errorMessage: await squarespaceErrorMessage(response) }
        }

        const data = await response.json()
        orders.push(...data.result)
        cursor = data.pagination?.hasNextPage ? data.pagination.nextPageCursor : null
    } while (cursor)

    return { orders }
}

// Per-season sales stats plus a per-product breakdown, ranked most to least sold
app.get('/api/sales', async (req, res) => {
    const requestedSeason = req.query.season

    if (requestedSeason !== undefined && !isValidSeason(requestedSeason)) {
        return res.status(400).json({ error: 'Invalid season' })
    }

    try {
        const { orders, errorStatus, errorMessage } = await fetchAllOrders()

        if (errorStatus) {
            return res.status(errorStatus).json({ error: errorMessage })
        }

        const bySeason = {}

        for (const order of orders) {
            const season = seasonOf(order.createdOn)
            bySeason[season] ??= {
                totalOrders: 0,
                fulfilledOrders: 0,
                unfulfilledOrders: 0,
                canceledOrders: 0,
                treesSold: 0,
                plantings: 0,
                guards: 0,
                treeTotals: {}
            }
            const stats = bySeason[season]

            if (order.fulfillmentStatus === 'CANCELED') {
                stats.canceledOrders += 1
                continue
            }

            stats.totalOrders += 1
            if (order.fulfillmentStatus === 'FULFILLED') {
                stats.fulfilledOrders += 1
            } else {
                stats.unfulfilledOrders += 1
            }

            for (const item of order.lineItems) {
                const kind = itemKind(item.productName)
                if (kind === 'planting') {
                    stats.plantings += item.quantity
                    continue
                }
                if (kind === 'guard') {
                    stats.guards += item.quantity
                    continue
                }
                const label = itemLabel(item)
                stats.treeTotals[label] = (stats.treeTotals[label] || 0) + item.quantity
                stats.treesSold += item.quantity
            }
        }

        const seasons = Object.keys(bySeason).sort().reverse()
        const season = requestedSeason ?? (seasons[0] || seasonOf(new Date().toISOString()))
        const stats = bySeason[season] ?? {
            totalOrders: 0,
            fulfilledOrders: 0,
            unfulfilledOrders: 0,
            canceledOrders: 0,
            treesSold: 0,
            plantings: 0,
            guards: 0,
            treeTotals: {}
        }

        const byTree = Object.entries(stats.treeTotals)
            .map(([name, quantity]) => ({ name, quantity }))
            .sort((a, b) => b.quantity - a.quantity)

        res.json({
            season,
            seasons,
            totalOrders: stats.totalOrders,
            fulfilledOrders: stats.fulfilledOrders,
            unfulfilledOrders: stats.unfulfilledOrders,
            canceledOrders: stats.canceledOrders,
            treesSold: stats.treesSold,
            plantings: stats.plantings,
            guards: stats.guards,
            byTree
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching sales data' })
    }
})

module.exports = app
