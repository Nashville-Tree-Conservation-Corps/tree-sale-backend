const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// Test seam: tests replace deps.db with a fake
const deps = {
    db: () => getFirestore()
}

// Squarespace is read-only for us, so the "811 called" check lives here.
// Doc ID = Squarespace order id.
const COLLECTION = 'orderFlags'

// Returns { [orderId]: true } for every order with 811 called.
// Fails soft: if Firestore is unreachable the orders still load, just unchecked.
async function getCalled811Map() {
    try {
        const snap = await deps.db().collection(COLLECTION).where('called811', '==', true).get()
        const map = {}
        snap.forEach(doc => { map[doc.id] = true })
        return map
    } catch (error) {
        console.error('Could not read 811 flags', error)
        return {}
    }
}

async function getCalled811(orderId) {
    try {
        const doc = await deps.db().collection(COLLECTION).doc(orderId).get()
        return doc.exists && doc.data().called811 === true
    } catch (error) {
        console.error('Could not read 811 flag', error)
        return false
    }
}

async function setCalled811(orderId, called, uid) {
    await deps.db().collection(COLLECTION).doc(orderId).set({
        called811: called,
        updatedBy: uid ?? null,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
}

module.exports = { getCalled811Map, getCalled811, setCalled811, deps }
