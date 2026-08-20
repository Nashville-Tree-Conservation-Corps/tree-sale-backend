const { initializeApp, getApps } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const allowlist = require('./allowlist')

// ADC everywhere: Cloud Functions provides credentials and project id;
// local dev uses gcloud application-default login + GOOGLE_CLOUD_PROJECT.
if (getApps().length === 0) {
    initializeApp()
}

// Test seam: tests replace these
const deps = {
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
    isPinned: allowlist.isPinned,
    claim: allowlist.claim
}

async function authMiddleware(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ')

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    let decoded
    try {
        decoded = await deps.verifyIdToken(token)
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        if (await deps.isPinned(decoded.uid)) {
            req.user = decoded
            return next()
        }

        const email = (decoded.email || '').toLowerCase()

        if (decoded.email_verified === true && email && await deps.claim(email, decoded.uid)) {
            req.user = decoded
            return next()
        }

        return res.status(403).json({ error: 'Forbidden' })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ error: 'Server error' })
    }
}

module.exports = { authMiddleware, deps }
