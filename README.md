# Contract Renewal Bot — Next.js (Vercel-ready)

A full rewrite of the original Python (Flask + MySQL + a long-running
scheduler process) into a single Next.js app you can deploy on Vercel. Every
functional flow from the original is preserved — see the mapping table below.

**Database and storage are kept separate, as requested:**
- **MySQL** — same as the original, used for `contracts` / `conversations` /
  `escalations` / the new `imap_cursor` table. Any MySQL host works (managed
  service like PlanetScale/Aiven/RDS, or your own server) — just needs to be
  reachable from Vercel over the internet.
- **Supabase** — used only for **file storage** (contract templates, email
  attachments, generated escalation PDFs), via `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY`. Not used as a database.

## What changed, and why

| Original | Here | Why |
|---|---|---|
| Flask dashboard (`dashboard/app.py` + Jinja templates) | Next.js App Router pages (React) + API routes | You asked for React; Next.js is React + a backend in one deployable unit |
| MySQL (`db.py`, raw `mysql.connector`) | MySQL (`lib/db.ts`, `mysql2/promise`, pooled) | Same database — just a Node driver instead of a Python one |
| Local folders `attachments/`, `exports/`, `contract_templates/` | Supabase Storage buckets | Vercel's filesystem is read-only/ephemeral, and you asked for Supabase storage specifically |
| `scheduler.py` `run_forever()` infinite loop (IMAP poll every 60s + daily scan) | Two Vercel Cron Jobs hitting short-lived API routes (`/api/cron/expiry-scan`, `/api/cron/poll-replies`) | **This is the fix for your 5-minute limit issue.** Vercel functions can't run forever; an infinite loop would just get killed. Cron jobs instead trigger a bounded function that does one pass and exits. |
| IMAP "mark as read" to avoid reprocessing | A `imap_cursor` table tracking the last processed UID | More reliable across serverless invocations, which can't hold long-lived state in memory |
| `run_all.py` (scheduler + dashboard in one process) | Not needed — cron handles the background work, Next.js serves the dashboard | Serverless has no "background process" |

Everything else — the AI triage logic, signature heuristic, template-match
comparison, escalation workflow, PDF generation, dashboard actions (edit
contract, toggle AI, resolve escalation, create contract) — is a direct
port, file for file:

| Original file | Ported to |
|---|---|
| `config.py` | `lib/config.ts` |
| `db.py` | `lib/db.ts` (MySQL, via `lib/mysql.ts` for the connection pool) |
| `schema.sql` | `mysql/schema.sql` (same tables + sample data, plus `imap_cursor`) |
| `ai_engine.py` | `lib/aiEngine.ts` |
| `pdf_signature.py` | `lib/pdfSignature.ts` |
| `pdf_compare.py` | `lib/pdfCompare.ts` |
| `pdf_export.py` | `lib/pdfExport.ts` (now uploads the PDF to Supabase Storage) |
| `email_client.py` | `lib/emailClient.ts` |
| `reply_processor.py` | `lib/replyProcessor.ts` |
| `scheduler.py` | `lib/scheduler.ts` + `app/api/cron/*/route.ts` |
| `dashboard/app.py` + templates | `app/*/page.tsx` + `app/api/**/route.ts` |
| (new) local file storage | `lib/storage.ts` — Supabase Storage helpers |

## One real limitation to know about

The original `pdf_signature.py` falls back to "an embedded image on the last
page = signed" using `pdfplumber`'s per-page image list. The Node PDF library
used here (`pdf-parse`) only gives whole-document text, not per-page image
data, so that specific fallback isn't reproduced — everything else (the text
marker checks) is identical. If you rely on that image fallback, swap
`pdf-parse` for `pdfjs-dist` in `lib/pdfSignature.ts` for page-level rendering.

## Setup

### 1. MySQL (the database)

Point it at any reachable MySQL server, then run the schema:

```bash
mysql -u youruser -p -h your-host < mysql/schema.sql
```

This creates the database, all four tables, and (same as the original)
seeds 5 sample contracts for testing. If you don't want the sample data,
strip the `INSERT INTO contracts ...` block at the bottom of the file first.

### 2. Supabase (storage only)

1. Create a project at supabase.com.
2. In Storage, create three **private** buckets (names must match your env
   vars): `contract-templates`, `attachments`, `exports`. Private is fine —
   the app only ever accesses them server-side with the service role key.
3. Grab your Project URL and `service_role` key (Settings → API) for
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
4. A sample blank contract template (`supabase/sample-assets/sample_contract_company_a.pdf`,
   carried over from the original project) is included — upload it to your
   `contract-templates` bucket to test the compare/signature flow end to end.

### 3. Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same values
in Vercel → Project Settings → Environment Variables for production.

```bash
cp .env.example .env.local
```

Fill in: MySQL host/user/password/database, Supabase URL/key,
`NVIDIA_API_KEY`, `EMAIL_ADDRESS` / `EMAIL_PASSWORD` (Gmail app password,
same as before), `EMPLOYEE_EMAILS`, and a random `CRON_SECRET` (lets you
trigger the cron routes by hand for testing).

### 4. Install & run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

Trigger a scan/poll cycle manually while developing (mirrors `python
scheduler.py --once`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expiry-scan
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll-replies
```

### 5. Deploy to Vercel

```bash
vercel deploy --prod
```

Set the same environment variables in the Vercel dashboard first. `vercel.json`
already defines the cron schedules and `maxDuration: 300` (5 minutes) on the
functions that need it.

**Important Vercel plan note:** frequent cron (every 5 minutes, as configured
for `poll-replies`) and function durations above 60s require a **Pro** plan.
On the free Hobby plan, cron jobs are limited to once per day and functions
cap out around 60s — if you're on Hobby, either upgrade or reduce
`poll-replies` to run less often (edit the schedule in `vercel.json`) and
accept slower reply turnaround.

**Important MySQL note for serverless:** `lib/mysql.ts` uses a small
connection pool (`connectionLimit: 5`) cached across warm invocations to
avoid exhausting your MySQL server's max connections when many Vercel
function instances run concurrently. If you're on a managed MySQL host with
a low connection cap (common on free tiers), consider fronting it with
PlanetScale (built for serverless) or a connection pooler like ProxySQL.

## Known limitations (carried over from the original README)

- Signature detection is a heuristic — for DocuSign/Adobe Sign/HelloSign,
  call their API instead of parsing the PDF.
- Contract-to-client matching is by sender email address only.
- No retry/backoff on email or AI API failures beyond the per-run cron
  retry (a failed message is just picked up again on the next cron tick).
- `poll-replies` processes at most 15 messages per invocation
  (`MAX_MESSAGES_PER_RUN` in `lib/emailClient.ts`) to stay well inside the
  function timeout under backlog; remaining messages are picked up on the
  next cron run a few minutes later.
