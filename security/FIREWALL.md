# Paid API request limit — not active

On 2026-10-24 the connected Vercel Firewall API returned `404 Seawall Config not found`
for reads and rule/config creation attempts. No distributed limiter was created or verified.
The source patch bounds one request but cannot cap cumulative spend or stop direct callers.
The public browser flow currently has no authentication; a secret embedded in the frontend
would not fix that. Shared-IP limits can affect classrooms and venue networks.

Target: team `miros-projects-2a08ca58`, project `mabc-final`
(`prj_59GB2ZUjfC39s6M3NPSy5EojNG95`). Verify this target in the Vercel dashboard or
`vercel project inspect --non-interactive` before any firewall mutation.

`firewall-rules.log.json` is a reviewable, nonblocking rule, not a deployed config.
It matches only POST requests to both public function paths. Review other project
rules and aliases before applying it. The CLI supports the equivalent draft:

```bash
vercel firewall rules add "Observe paid component card API" \
  --condition '{"type":"path","op":"inc","value":["/api/card","/api/card.js"]}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action log --yes
vercel firewall diff
```

After log review, stage a generous per-IP counter (60 requests / 60 seconds) with
`--rate-limit-action log` first. A proposed enforcement target is 10 requests /
60 seconds / IP, adjusted against observed shared-network traffic. CLI parameters:

```bash
vercel firewall rules add "Rate limit paid component card API" \
  --condition '{"type":"path","op":"inc","value":["/api/card","/api/card.js"]}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 60 \
  --rate-limit-keys ip --rate-limit-action log --yes
vercel firewall diff
```

Draft creation does not activate protection. The project owner should publish reviewed
drafts, inspect matched traffic, enforce on preview first, then change the threshold
and action to `rate_limit` (429) after reviewing legitimate production traffic. An
unconditional log rule may short-circuit later custom rules; remove/replace the
observation rule when moving to the counter stage. Counters are per region, so this
is not a global budget. Keep an upstream spending limit as an independent cap.

Read back active rules and check live request behavior before calling this protected.
Do not generate paid model calls to test the threshold; use invalid JSON bodies
(which this source patch rejects before the provider) and verify WAF counters instead.
