This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database roles (audit log protection)

`AuditLog` is append-only and hash-chained by database triggers. Those triggers stop the app, but the
table's **owner** can still disable them. To close that gap, the app runs as a restricted role that
does not own any table:

| Env var | Role | Used for |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | owner (existing credentials) | `prisma migrate deploy` during the Vercel build |
| `DATABASE_URL` | `supportify_app` | the running app: plain reads/writes; `AuditLog` insert + read only |

One-time rollout (and re-run `setup` any time; it is idempotent):

1. Deploy the migrations first, still on the old credentials.
2. Create the role as the owner, with a new random 24+ character password:
   `DIRECT_DATABASE_URL=<owner url> APP_DB_PASSWORD=<password> node scripts/db/setup-app-role.mjs setup`
3. Check it, logging in as the new role: every line must say PASS.
   `APP_DATABASE_URL=<same host/db, user supportify_app> node scripts/db/setup-app-role.mjs check`
4. In Vercel, set `DIRECT_DATABASE_URL` to the owner URL (if not already) and `DATABASE_URL` to the
   `supportify_app` URL, then redeploy. Settings → System → Database should show
   **Audit log protection: Restricted app role**.

Rollback: point `DATABASE_URL` back at the owner URL and redeploy. The triggers keep the log
append-only either way.
