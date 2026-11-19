const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const emails = process.argv.slice(2).map(e => e.trim().toLowerCase()).filter(Boolean)

if (emails.length === 0) {
    console.error('usage: node scripts/generate-verification-link.js email1 [email2 ...]')
    process.exit(1)
}

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'tree-sale' })
const auth = getAuth()

// The user must already exist in Firebase Auth (i.e. has signed in at
// least once); the link verifies the address on that account.
async function generate() {
    let failed = false
    for (const email of emails) {
        try {
            const link = await auth.generateEmailVerificationLink(email)
            console.log(`${email}\n${link}\n`)
        } catch (error) {
            failed = true
            if (error.code === 'auth/user-not-found') {
                console.error(`${email}: no Firebase Auth user; they must attempt a sign-in first`)
            } else {
                console.error(`${email}: ${error.message}`)
            }
        }
    }
    return failed
}

generate().then((failed) => process.exit(failed ? 1 : 0)).catch((error) => { console.error(error); process.exit(1) })
