# AI Edge Briefing on Resend (replaces Brevo)

**Owner decision, 2026-09-25:** AI Edge Briefing sends through **Resend**. **Brevo is dropped entirely.** It was never
finished, so there's nothing to keep. This file is the handoff for whoever does the move (a Claude session or a person).

## 1. What's already done (don't redo)
| Item | State |
|---|---|
| Resend account | Pro plan, owned by the owner. Also hosts the other Epilogue products (miltastic.com, signalprep.ca, ofrecord.ca, usecria.ai, parleh.ai, …). |
| `aiedgebriefing.com` in Resend | ✅ **Verified.** DKIM (`resend._domainkey`), return-path/SPF (`send.`/`rsend.` CNAMEs) and the bounce records are in Cloudflare DNS. |
| DMARC | `_dmarc.aiedgebriefing.com` = `v=DMARC1; p=none; rua=mailto:dmarc@epiloguelabs.com; fo=1` (repointed from Brevo's `rua@dmarc.brevo.com`) |
| Prior work | Branch `feat/resend` (5f7bdae) has a first Resend broadcast path in `scripts/mail.js`: `MAIL_PROVIDER=resend`, `segment_id`, and the unsubscribe placeholder swap, tested with stubs. It predates the daily/weekly split (commit 144dbce on `staging`). Reuse it, rebased; don't merge it as it is. |

**Still in DNS from Brevo:** a TXT `brevo-code:c1f9fc96f64dba075b05a21fcf0f3761` on the apex, and possibly `brevo._domainkey`. Remove both
once the move is live. The Cloudflare zone is `aiedgebriefing.com`; the owner has a DNS-edit token, or can use the dashboard.

## 2. Addresses (rules for every Epilogue product)
- **From:** `AI Edge Briefing <briefing@aiedgebriefing.com>`
- **Reply-To:** `ventures+aiedge@epiloguelabs.com`. This is plus-addressing into the owner's `ventures@` mailbox, and a Gmail filter
  files it. **Not** `aiedge@` or `briefing@epiloguelabs.com`.
- Automated mail **never** sends *from* `@epiloguelabs.com`.

## 3. The model in Resend: one segment, two topics
Resend replaced "audiences" with **Contacts**, grouped into **Segments**, with **Topics** for subscription preferences.
Use them like this:

| Resend object | Name | What it is |
|---|---|---|
| **Segment** | `AI Edge Briefing` | Everyone who has confirmed a subscription. Broadcasts target this. |
| **Topic** | `Daily briefing` | The morning edition. `default_subscription: opt_out`, `visibility: public` |
| **Topic** | `Weekly review` | The Monday review. `default_subscription: opt_out`, `visibility: public` |

- `default_subscription` **can't be changed later**. `opt_out` means nobody gets a topic unless they chose it (the
  daily/weekly checkboxes), which is what Canada's anti-spam law (CASL) expects.
- `visibility: public` means both topics show on Resend's **preference page**, so a reader can switch daily or weekly on
  or off, or unsubscribe from everything. That page is what `{{{RESEND_UNSUBSCRIBE_URL}}}` opens.

### Creating them (one time, with a full-access key)
```bash
curl -X POST https://api.resend.com/segments -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"AI Edge Briefing"}'
curl -X POST https://api.resend.com/topics -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Daily briefing","default_subscription":"opt_out","visibility":"public","description":"The morning AI Edge Briefing, every day."}'
curl -X POST https://api.resend.com/topics -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Weekly review","default_subscription":"opt_out","visibility":"public","description":"The Monday review of the week."}'
```
Keep the three IDs that come back. They become `RESEND_SEGMENT_ID`, `RESEND_TOPIC_DAILY` and `RESEND_TOPIC_WEEKLY`.
The dashboard works too (Audience → Segments / Topics).

## 4. Sign-up: double opt-in, through a small Cloudflare Worker
The site is static (GitHub Pages), so it can't accept a form by itself. Add a Worker. The zone is on Cloudflare, e.g.
at `subscribe.aiedgebriefing.com` (custom domain) or on a route.

1. **`POST /subscribe`** takes `{email, daily: bool, weekly: bool, website: ""}`. `website` is a hidden honeypot: if it's
   filled in, reply 200 and do nothing. Validate the email, require at least one topic, and rate-limit per IP.
2. **Send a confirmation email** (Resend `POST /emails`, from `briefing@aiedgebriefing.com`) with a link:
   `https://subscribe.aiedgebriefing.com/confirm?t=<token>`. The token is an HMAC-signed `{email, daily, weekly, exp}`
   using a Worker secret, valid 48 h. **Nothing is stored before confirmation.**
3. **`GET /confirm?t=`**: verify the signature and expiry, then:
   - `POST /contacts` with `{"email", "unsubscribed": false, "segments": ["<SEGMENT_ID>"], "topics": [{"id": "<DAILY>", "subscription": "opt_in"}, …]}`
     (only the topics they ticked). If the contact already exists, use `PATCH /contacts/{email}/topics` with
     `[{"id":"<topic>","subscription":"opt_in"}]`, and make sure they're in the segment.
   - Redirect to a "You're subscribed" page on the site.
4. The Worker's secrets are `RESEND_API_KEY` (**full access**, since contacts need it) and `SUBSCRIBE_SIGNING_SECRET`.
   Allow the site's origin in CORS.

**`build.js`:** replace the Brevo form with a form that posts JSON to the Worker (`fetch`), keeping the existing
daily/weekly checkboxes (`SUBSCRIBE_PICK`) and showing "Check your email to confirm". Remove every Brevo form variable.

## 5. Sending: `scripts/mail.js`
For each new edition (the once-only R2 markers stay exactly as they are):
```js
POST https://api.resend.com/broadcasts
{
  "segment_id": RESEND_SEGMENT_ID,
  "topic_id":   weekly ? RESEND_TOPIC_WEEKLY : RESEND_TOPIC_DAILY,   // only people who opted in to that topic
  "from":       "AI Edge Briefing <briefing@aiedgebriefing.com>",
  "reply_to":   "ventures+aiedge@epiloguelabs.com",
  "subject":    <reader subject>,
  "html":       <reader html, with Brevo's {{ unsubscribe }} replaced by {{{RESEND_UNSUBSCRIBE_URL}}}>,
  "text":       <reader text, if built>,
  "name":       "AI Edge Briefing <DATE or DATE.week>",
  "send":       true
}
```
- `topic_id` is what makes the daily/weekly choice work. Leaving it out would send to everyone in the segment.
- **The HTML must contain `{{{RESEND_UNSUBSCRIBE_URL}}}`** (the footer link). Resend fills it with the preference page.
- Keep "only today's edition is sent; older ones are marked, not sent", so a first run never blasts the archive.
- Broadcasts and contacts need a **full-access** key. Store it as the GitHub Actions secret `RESEND_API_KEY`.

## 6. Configuration (GitHub Actions `deploy.yml`)
| Name | Kind | Value |
|---|---|---|
| `RESEND_API_KEY` | secret | full-access Resend key (create one named "aiedge-actions") |
| `RESEND_SEGMENT_ID` | variable | from step 3 |
| `RESEND_TOPIC_DAILY` / `RESEND_TOPIC_WEEKLY` | variables | from step 3 |
| `MAIL_FROM` | variable | `AI Edge Briefing <briefing@aiedgebriefing.com>` |
| `MAIL_REPLY_TO` | variable | `ventures+aiedge@epiloguelabs.com` |
| `SUBSCRIBE_URL` | variable | the Worker's `/subscribe` URL, for the form |

**Remove:** `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_DAILY_LIST_ID`, `BREVO_WEEKLY_LIST_ID`, `BREVO_SENDER_*`,
`SUBSCRIBE_FORM_URL`, `SUBSCRIBE_LIST_FIELD`, `SUBSCRIBE_DAILY_LIST`, `SUBSCRIBE_WEEKLY_LIST`, plus any code paths reading them.

## 7. Existing subscribers
There are about 3. If any are in Brevo, export them and add each one as a contact **in the segment, opted in to the
topics they had** (they already consented; no second confirmation needed). If Brevo holds nobody, skip this.

## 8. Compliance (CASL, Canada)
Every broadcast footer needs:
- **who sent it** (AI Edge Briefing / Epilogue Labs)
- **a postal mailing address**. The owner hasn't chosen one yet: add a clearly marked placeholder
  and **don't send to real subscribers until it's set**.
- **the unsubscribe/preferences link** (`{{{RESEND_UNSUBSCRIBE_URL}}}`)

Double opt-in (section 4) is the consent record. Keep the confirmation timestamp as a contact property if convenient.

## 9. Testing before going live
1. Create a test contact (the owner's own address) in the segment, opted in to both topics.
2. Run `mail.js` against a test segment, or add `scheduled_at` far in the future to inspect it in the dashboard. Check:
   the From/Reply-To, that the unsubscribe link opens the preference page with both topics, and that switching one off
   stops that broadcast.
3. Confirm the Worker: subscribe → confirmation email arrives → click → contact shows in the segment with the right topics.
4. Check the headers of a received email: `dkim=pass` and `dmarc=pass` for aiedgebriefing.com.

## 10. Order
Feature branch → PR into `staging` → then `staging` → `main` (the site deploys from `main`). Suggested sequence:
1. Resend objects (section 3).
2. The Worker (section 4), with the form hidden behind `SUBSCRIBE_URL` being unset.
3. `mail.js` (section 5).
4. Set the variables and do a test.
5. Remove Brevo: variables, code, DNS records.

## Useful Resend docs
- Contacts: `POST /contacts`, `PATCH /contacts/{id|email}/topics`
- Segments: `POST /segments` · Topics: `POST /topics` (`default_subscription` can't be changed)
- Broadcasts: `POST /broadcasts` with `segment_id`, optional `topic_id`, `send: true`
- The template variable for the preference page is `{{{RESEND_UNSUBSCRIBE_URL}}}`
- https://resend.com/docs/llms.txt is the full docs index
