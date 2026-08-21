const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const emails = process.argv.slice(2).map(e => e.trim().toLowerCase()).filter(Boolean)

if (emails.length === 0) {
    console.error('usage: node scripts/seed-allowlist.js email1 [email2 ...]')
    process.exit(1)
}

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'tree-sale' })
const db = getFirestore()

async function seed() {
    for (const email of emails) {
        const ref = db.collection('allowlist').doc(email)
        const existing = await ref.get()
        if (existing.exists) {
            console.log(`skip (exists): ${email}`)
            continue
        }
        await ref.set({ email, uid: null, claimedAt: null })
        console.log(`created: ${email}`)
    }
}

seed().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
