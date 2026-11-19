# tree-sale-backend

Express API for the NTCC tree sale staff app. It reads orders from Squarespace and runs as the 2nd-gen Cloud Function `api` (`us-central1`, Node 22) in the GCP project `tree-sale`. The frontend is [tree-sale](https://github.com/Nashville-Tree-Conservation-Corps/tree-sale), whose Hosting config rewrites `/api/**` to this function.

## Routes

All routes sit under `/api` and require a signed-in, allowlisted user.

- `GET /api/orders`
- `GET /api/orders/:id`
- `GET /api/customers/:customerId/orders`
- `GET /api/sales`

## Who can call the API

`auth.js` runs on every `/api` request:

1. The request must carry `Authorization: Bearer <Firebase ID token>`; the Admin SDK verifies it. Failure returns 401.
2. If a Firestore `allowlist` document already holds the token's `uid`, the request passes.
3. Otherwise, if the token's email is verified and an `allowlist` document exists with that lowercased email as its ID and `uid: null`, the request claims it by writing the `uid`, then passes. That first sign-in pins the account.
4. Anything else returns 403.

Add people with `node scripts/seed-allowlist.js alice@example.org bob@example.org`. It creates unclaimed entries and skips existing ones. It uses the same local credentials as the server (below). A person whose sign-in returns 403 because their email is unverified can be sent a link from the `verify-link` mise task.

`firestore.rules` denies all client reads and writes. Only the Admin SDK, which bypasses rules, touches Firestore.

## Runtime credentials

- **In Cloud Functions:** the Admin SDK uses the function's runtime service account through Application Default Credentials (ADC); no key is deployed.
- **Squarespace:** `SQUARESPACE_API_KEY` is a Secret Manager secret bound in `index.js` with `defineSecret`. The default compute and App Engine service accounts hold `roles/secretmanager.secretAccessor` on it.
- **CORS:** production calls arrive same-origin through the Hosting rewrite, so `FRONTEND_ORIGIN` only matters locally. `index.js` defaults it to `http://localhost:5173`.

## Local development

[mise](https://mise.jdx.dev) pins Node 22 and loads `.env.local` into the shell through `mise.toml`. Install it with `brew install mise` (or see the [install docs](https://mise.jdx.dev/getting-started.html)), add `eval "$(mise activate zsh)"` to your shell profile, then from the repo root:

```sh
mise trust
mise install
npm ci
cp env.example .env.local
npm start
npm test
```

`server.js` loads `.env.local`, then `.env`, and exits if `SQUARESPACE_API_KEY` or `GOOGLE_CLOUD_PROJECT` is missing. It listens on `PORT` (default 3000).

For Firebase access, set `GOOGLE_APPLICATION_CREDENTIALS` in `.env.local` to a Firebase Admin SDK key from Firebase console > Project settings > Service accounts. Files matching `*-firebase-adminsdk-*.json` are gitignored. Without it, the Admin SDK falls back to your `gcloud auth application-default login` user credentials, which work only if that account has access to the `tree-sale` project.

The scripts in `scripts/` do not read `.env.local` themselves; run them with mise active so they pick up the same credentials.

### mise tasks

| Task | What it does |
|---|---|
| `mise run verify-link -- alice@example.org [...]` | Prints a Firebase email verification link for each address. The account must already exist in Firebase Auth, so the person has to attempt a sign-in first. Use it when the allowlist claim fails because the account's email is unverified. |

## Deployment

A push to `main` runs `.github/workflows/deploy.yml` (`deploy-api`), which runs `npm test`, then `firebase deploy --only functions,firestore --force`. `--force` skips the interactive prompts, including the one that confirms deleting functions no longer in the source.

`firebase.json` sets a custom `functions.ignore`, which replaces the Firebase defaults rather than extending them, so `node_modules` is listed explicitly to keep it out of the upload.

Both the NTCC org repo and the `enlore/tree-sale-backend` fork are trusted to deploy, and both deploy to the same production function. Whichever `main` was pushed last is what is live, so push to the fork only when its `main` matches the org repo's.

### How CI authenticates to GCP

GitHub stores no service account keys. The job requests a GitHub OIDC token (`permissions: id-token: write`), and `google-github-actions/auth` exchanges it through Workload Identity Federation for short-lived credentials as the deployer service account.

GitHub side, set on both `Nashville-Tree-Conservation-Corps/tree-sale-backend` and `enlore/tree-sale-backend`:

| Repository variable | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `projects/15912314705/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOYER_SA` | `firebase-deployer@tree-sale.iam.gserviceaccount.com` |

These are Actions variables, not secrets. The job also declares `environment: production`, and the GCP binding below depends on that environment name.

GCP side, project `tree-sale` (number `15912314705`):

- **Pool and provider:** `github-pool` / `github-provider`, issuer `https://token.actions.githubusercontent.com`.
- **Attribute condition:** only tokens from `enlore/tree-sale`, `enlore/tree-sale-backend`, `Nashville-Tree-Conservation-Corps/tree-sale`, and `Nashville-Tree-Conservation-Corps/tree-sale-backend` are accepted.
- **Attribute mapping:** `attribute.repo_env` is `<owner>/<repo>:<environment>`.
- **Impersonation:** `firebase-deployer` grants `roles/iam.workloadIdentityUser` to `principalSet://iam.googleapis.com/projects/15912314705/locations/global/workloadIdentityPools/github-pool/attribute.repo_env/<owner>/<repo>:production` for each of the four repos.
- **Deployer permissions:** `roles/firebase.admin` and `roles/cloudfunctions.admin` on the project, `roles/iam.serviceAccountUser` on the default compute and App Engine service accounts, and `roles/secretmanager.viewer` on the `SQUARESPACE_API_KEY` secret.

The binding uses the mapped `repo_env` attribute rather than the token's `sub` claim, because GitHub now embeds numeric owner and repo IDs in `sub`, and a name-based subject binding never matches. The failure shows up as a 403 on `iam.serviceAccounts.getAccessToken`, which `firebase-tools` reports as "have you run firebase login?".

A new GCP project also needs the Eventarc, Firebase Extensions, and Cloud Billing APIs enabled before the first functions deploy.

### Giving another repo deploy access

```sh
gcloud iam workload-identity-pools providers update-oidc github-provider --project=tree-sale --location=global --workload-identity-pool=github-pool --attribute-condition="assertion.repository in ['<owner>/<repo>', ...existing repos]"
gcloud iam service-accounts add-iam-policy-binding firebase-deployer@tree-sale.iam.gserviceaccount.com --project=tree-sale --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/15912314705/locations/global/workloadIdentityPools/github-pool/attribute.repo_env/<owner>/<repo>:production"
```

Then set the two repository variables on the new repo and create its `production` environment. `update-oidc` replaces the whole condition, so list every repo that should keep access.
