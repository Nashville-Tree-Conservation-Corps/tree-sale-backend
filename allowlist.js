const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// Test seam: tests replace deps.db with a fake
const deps = {
    db: () => getFirestore()
}

// Doc ID = lowercased email, so claiming is a direct doc read: no
// composite index, and the uniqueness of the invite is structural.
async function isPinned(uid) {
    const snap = await deps.db().collection('allowlist').where('uid', '==', uid).limit(1).get()
    return !snap.empty
}

async function claim(email, uid) {
    const db = deps.db()
    const ref = db.collection('allowlist').doc(email)
    return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref)
        if (!doc.exists) {
            return false
        }
        const current = doc.data().uid
        if (current === uid) {
            return true
        }
        if (current !== null) {
            return false
        }
        tx.update(ref, { uid, claimedAt: FieldValue.serverTimestamp() })
        return true
    })
}

module.exports = { isPinned, claim, deps }
