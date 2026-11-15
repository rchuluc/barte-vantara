# Production tenant provisioning

Run **provision-tenant** from GitHub Actions on `main`. Fill in these individual
fields; the action generates the UUID and builds the JSON request automatically.

| Input | Description | Example |
| --- | --- | --- |
| `tenant_name` | Display name on login and workspace pages | `Acme Finance` |
| `tenant_slug` | Unique lowercase URL slug, starting with a letter | `acme` |
| `tenant_primary` | Brand color in `#RRGGBB` format | `#f0a500` |
| `tenant_domains` | Comma-separated hostnames, without protocol or paths | `acme.example.com, portal.acme.com` |
| `first_user_email` | Email to receive the first administrator's invitation | `admin@acme.com` |

Whitespace around fields and domains is trimmed; hostnames are lowercased.
Cognito generates and emails the temporary password. Neither the password nor
the tenant ID is an operator input. Slugs and exact domains must be unique.
The action creates a new Cognito account; an existing email returns a conflict.
Registering an existing unregistered database tenant is not supported by this
creation endpoint.

## Deployment setup

1. Deploy migration V7 before the new backend, then deploy the frontend.
2. Configure the GitHub environment **prod-tenants**, restrict deployment branches
   to `main`, and set its variable **APP_URL** to the HTTPS frontend origin
   (production: `https://vantara.wura.io`, without a path or query).
3. Set backend **PROVISIONING_GITHUB_REPOSITORY** to the repository segment of
   GitHub's OIDC subject: `owner/repository` for legacy subjects or
   `owner@owner-id/repository@repository-id` for immutable subjects. The subject
   retains those IDs; repository and workflow claims use the plain names.
   Terraform supplies `github_repository` and `${environment}-tenants`; production
   uses `environment = "prod"`. Blank repository disables provisioning.
4. Defaults are `PROVISIONING_GITHUB_ENVIRONMENT=prod-tenants`,
   `PROVISIONING_GITHUB_REF=refs/heads/main`, and
   `PROVISIONING_GITHUB_AUDIENCE=vantara-tenant-provisioning`. Keep these aligned
   with the workflow and script if customizing them.
5. Ensure production Cognito invitation email delivery is configured and permitted
   for the recipient. The current pool expires temporary passwords after one day.
   Configure DNS, TLS and ingress for each tenant domain separately.

No AWS credentials or long-lived backend token are required by this action.
GitHub grants a short-lived OIDC JWT. Backend validation requires GitHub's issuer,
signature, expiry, audience, repository, environment subject, main ref, manual
event, and `.github/workflows/provision-tenant.yml` workflow identity.
Customized GitHub OIDC subject templates must match this trust configuration.

## API and storage

- `POST /api/admin/tenants`: `{ "tenant": { ... }, "firstUserEmail": "..." }`;
  returns 201 with branding. Only GitHub provisioning identities are accepted.
- `GET /api/admin/tenants`: administrative listing with the same GitHub trust.
- `GET /api/tenants`: public, non-sensitive branding needed before login.
- The frontend forwards only the administrative POST to the private backend;
  browser session cookies do not authorize provisioning.

V7 adds `platform.tenant_registration` and `platform.tenant_domain`, both with
enabled and forced RLS. Runtime can read public branding but cannot directly
write either table. The restricted registration function creates the financial
tenant, branding, membership and admin role in one transaction. Authorization
for financial data still requires a verified tenant membership.

Provisioning is serialized at the database boundary. A failed registration rolls
back database changes and attempts to delete the newly invited Cognito account.
Cognito and PostgreSQL do not share a transaction: an invitation may already
have been emailed when a database failure occurs. After timeout or failure, check
registration and Cognito before retrying; cleanup failures require operator
reconciliation. Duplicate registrations return 409 rather than overwriting data.

Tenants are selected only by their registered hostname, never by a path slug.
The production Vantara login is `https://vantara.wura.io/login`.
The first administrator signs in at the tenant's `/login` page with the emailed
password and is prompted to replace it. The pending challenge is HttpOnly and
short-lived. A normal session is issued only after active membership verification.

## Development and verification

Every environment, including `npm run dev`, reads branding from the backend
database. There is no tenant JSON file or environment-variable fallback.
The local Compose seed inserts Vantara branding only if its registration does not
exist: ID `ce19c2fb-b199-4b58-a274-113cd07ce416`, slug `vantara`, name `Vantara`,
color `#175C4C`, domains `vantara.localhost` and `vantara.com.br`.
Existing branding and domain mappings are preserved when seeding again.

Build/start the updated local stack with `docker compose up -d --build`, then run
`npm run tenant:add` from the repository root for guided local creation, or:

```sh
npm run tenant:add -- --name "Acme Finance" --slug acme --primary '#112233' \
  --domains 'acme.localhost, portal.acme.test' --email admin@acme.test
```

This uses the repository's fixed Compose seed service, local Floci and database
owner credentials, with a newly generated tenant ID. It creates one administrator
with permanent development password `@Test123`; local email delivery is not
required. Use a distinct administrator email for each tenant. The seed can reset
the supplied local user's password. Duplicate slugs or domains fail rather than
overwrite existing registrations. Visit `http://acme.localhost:3000/login`, or
use your Next development server's port. Registration does not create business
units or bank accounts; admins configure those separately.

Backend tests use real PostgreSQL migrations/RLS plus local signed JWT fixtures
and mocked Cognito invitation/challenge requests. Frontend tests cover forwarding,
challenge cookies, replacement UI, routing and failed branding reads. Run
`npm run test:actions` for the provisioning script tests. Actual invitation email
delivery must be verified against the production Cognito email setup.
