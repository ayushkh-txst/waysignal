# Deploy G-One for HackRice

Use the `feature/login-page-ui` branch. `render.yaml` creates one Docker web
service and one PostgreSQL database. The React build and FastAPI routes share
the web service's HTTPS URL; PostgreSQL keeps records across app restarts.

## Render setup

1. Sign in at https://dashboard.render.com and connect GitHub.
2. Choose **New → Blueprint** and select
   `ayushkh-txst/jalrakshak-hackrice16`.
3. Set **Branch** to `feature/login-page-ui` and **Blueprint Path** to
   `render.yaml`. The configuration is on this branch, not `main`.
4. Enter two separate passwords of at least 12 characters when prompted:

   | Render variable | Login email |
   | --- | --- |
   | `DEMO_CITIZEN_PASSWORD` | `citizen@example.com` |
   | `DEMO_WORKER_PASSWORD` | `worker@example.com` |

   Choose new demo passwords and save them in your password manager. Do not
   paste passwords or API keys into GitHub or screenshots. These variables are
   named `DEMO_..._PASSWORD`, not `GONE_DEMO_..._PASS`.
5. Review the `g-one-app` web service and `g-one-db` database. Both are configured
   on the **Free** compute plan. Click **Deploy Blueprint**.
6. Wait for the database and web service to become available, then open the
   HTTPS URL shown on **g-one-app**. This is the app URL to share with judges.

Render generates the JWT signing secret and connects the database automatically.
No localhost URL, frontend API URL, or CORS origin needs to be pasted into Render.
The Docker build sets `VITE_API_BASE_URL=/api/v1` for the bundled frontend.

The configured login accounts are a hackathon demo setup, not public user registration.
Localhost password autofill remains available for your recording. The hosted
build uses the new passwords chosen in Render; you can save them in your browser.

## Additional demo logins

The original citizen/admin accounts keep their existing passwords. The Blueprint
adds three password variables with `generateValue: true`. Render generates a
private random password once for each missing variable and preserves existing
values on subsequent syncs.

For an existing deployment:

1. Open **Blueprints → g-one → Syncs** and wait for the latest sync. If it has not
   picked up the commit, use **Manual sync**.
2. Open **g-one-app → Deploys** and wait for the new deployment to show **Live**.
3. Open **g-one-app → Environment**, reveal/copy the Value for the matching key:

   | Login email | Dashboard | Password comes from this Render variable |
   | --- | --- | --- |
   | `citizen2@example.com` | Citizen | `DEMO_CITIZEN_2_PASSWORD` |
   | `citizen3@example.com` | Citizen | `DEMO_CITIZEN_3_PASSWORD` |
   | `worker2@example.com` | Admin | `DEMO_WORKER_2_PASSWORD` |

   On the G-One sign-in page, put the email in **Email address** and the copied
   Render Value in **Password**. Keep the generated value exactly as shown,
   including any trailing `=`. The variable name is not the password.
4. Sign in with each new account and submit clearly marked test requests from
   the two new citizens. Both admins should see all live requests; citizens
   should see only their own requests and response updates.

These are separate identities, not extra sessions of the original account.
There are now three citizens and two admins when all password variables are
configured. Additional accounts are disabled if their password is missing or
empty, so an app deploy arriving before the Blueprint sync retains the original
working logins. No additional service or paid plan is requested by this change.

For local use, configure the same three keys with separate passwords of 12–128
characters in `backend/.env` and restart the backend. There are no hardcoded
passwords or added role-selection buttons for these accounts.

## Verify the deployed demo

- Open `/health` on the app URL and check for `{"status":"ok"}`.
- Sign in as citizen in a normal window and as worker in Incognito.
- Submit a clearly marked test SOS, check the admin dispatch alert, then assign
  and resolve it. Confirm the stored request appears in Reports and CSV export.
- Refresh `/citizen` and `/responder`: the login page should appear, rather than
  a host 404. Sessions currently stay in memory, so refresh requires sign-in.
- Keep test notes free of real personal or medical information. This deployment
  starts with its own database; local SOS history is not automatically uploaded.

If you want optional AI note analysis, add `OPENAI_API_KEY` and `DISPATCH_AI_MODEL`
to **g-one-app → Environment**, using the model already tested locally, then
redeploy. Dispatch notifications and the contact directory work without AI.

## Local commands after pulling these changes

Frontend terminal:

```bash
cd ~/Desktop/jalrakshak-hackrice16/frontend
npm run dev
```

Restart the backend from this repository's `backend` directory using the
existing Python environment and usual Uvicorn command. Both sides must have
the updated code: emergency requests now send and require the login token.

## Free-plan limits and troubleshooting

- Render free web services sleep after 15 minutes without inbound traffic;
  waking takes about one minute. Open the app before judging and retain your
  local recording as a backup.
- Free PostgreSQL expires after 30 days. Export needed demo records before
  expiration or explicitly choose a paid database for ongoing hosting.
- No local SQLite fallback is used in production. A database error must be fixed
  in Render; it must not silently switch to storage that disappears on restart.
- If a build fails, inspect **g-one-app → Logs**. If login fails, check the matching
  `DEMO_..._PASSWORD` value. If the database fails, verify both resources are
  in the same region and the database is available.

References: https://render.com/docs/blueprint-spec,
https://render.com/docs/free, https://render.com/docs/docker.

## Checks before deploying

The frontend build, backend access/reporting tests, and production frontend
served by FastAPI can be checked locally. Container building and the real hosted
PostgreSQL connection must also succeed in Render before the deployment is ready.
The optional browser check uses SQLite and external weather/geocoder/AI fixtures:

```bash
cd frontend
VITE_API_BASE_URL=/api/v1 npm run build
TEST_SERVE_BUILT=1 TEST_PYTHON=/path/to/venv/bin/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/dispatch.browser.mjs
```


## Five-account functional check

```bash
cd frontend
VITE_API_BASE_URL=/api/v1 npm run build
TEST_PYTHON=/path/to/venv/bin/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/multiuser.browser.mjs
```

This runs five isolated browser sessions against the production frontend and a
local FastAPI/SQLite database, with weather/geocoder fixtures. It checks the
three citizens' separate requests, both admins' queue access, assignment and
status updates, responder preservation, and Reports totals. It does not submit
requests to the hosted service, dial emergency contacts, or measure 100-user
capacity. See `backend/tests/test_demo_accounts.py` for API ownership and
per-admin dispatch-review checks using actual password logins.
