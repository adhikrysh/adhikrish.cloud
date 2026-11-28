# access: who gets in

every private `*.adhikrish.cloud` name sits behind cloudflare access. this doc explains how access decides who gets in, why the setup has the shape it has, and the traps that have already confused us once.

**the short answer.** for each request, access finds the **one** app whose hostname matches most specifically, and checks only that app's policies. if any policy lets the visitor in, the request goes through with a signed pass attached. if none does, the visitor gets a login page. nothing is inherited from other apps.

## the three objects

access has three kinds of things. they stack: a token is used by a policy, and a policy is attached to an app.

- **app.** a guarded hostname. "whoever asks for this name must pass access first." an app can name one host (`<app>.adhikrish.cloud`) or a wildcard (`*.adhikrish.cloud`).
- **policy.** one rule about who passes. it has an action and a condition:
  - `allow`: let in a **person** who logs in and matches, for example a specific email address.
  - `service auth` (cloudflare's api calls it `non_identity`): let in a **machine** that presents a specific service token. no login page is involved.
  - `bypass`: let in **everyone**, with no check at all.
- **service token.** a password for a machine. a program can't click "log in with google", so it sends two headers on every request instead: `CF-Access-Client-Id` and `CF-Access-Client-Secret`. the token is a pair of values, created in cloudflare and stored in 1password.

policies are reusable. one policy object can be attached to many apps, so changing it once changes every app it's attached to. adding an app means attaching existing policies, not writing them again.

## how one request is decided

take a concrete case: a program on some server calls `https://<app>.adhikrish.cloud/api/items` with a service token.

```text
request for <app>.adhikrish.cloud
    │
    ▼
1. pick the app. two apps match:
     *.adhikrish.cloud        the wildcard
     <app>.adhikrish.cloud    an exact name     ← wins: more specific
   only the winner is used from here on.
    │
    ▼
2. check the winner's policies, one by one:
     allow: the owner's email?           no login cookie → no
     service auth: the prober token?     headers don't match → no
     service auth: this program's token? headers match → yes
    │
    ▼
3. let it through. access attaches a signed pass (a jwt, see below)
   and forwards the request toward the app.
    │
    ▼
4. the app may check the pass itself before it answers.
```

if step 2 finds no match, a browser is redirected to the login page (a `302` to `<team>.cloudflareaccess.com`). a program that sends a wrong or missing token gets that same redirect, which is why a script that suddenly receives an html login page should read it as "my token was refused", not as "the site is broken".

## the trap: specific apps don't inherit the wildcard

**wrong model:** the wildcard app protects everything, so a specific app only needs to add the one extra visitor it exists for.

**why it fails:** access never combines apps. once an exact-name app exists, the wildcard is not consulted for that name. if the exact app only lists the extra visitor's token, the owner's own browser login is refused on that hostname, even though the wildcard allows the owner everywhere else.

**replacement model:** every app carries its **complete** guest list. a specific app repeats the policies everyone needs (the owner, the uptime prober) and adds the extra visitor on top.

cloudflare does it this way on purpose. if apps were merged, you could never make one hostname *stricter* than the wildcard, and you'd have to merge rules in your head to know who can reach a name. with "one app wins", the full list for a hostname is always in one place.

## the shape of this setup

the layout follows from the trap above: lock everything by default, then make one exception per extra visitor.

| app | who it lets in | why it exists |
|---|---|---|
| the wildcard, `*.adhikrish.cloud` | the owner, the uptime prober | the default lock. any private name without its own app lands here, so a new service is guarded the moment it gets a hostname |
| one app per extra visitor | the owner, the uptime prober, **plus that visitor** | a device, a family member or an agent needs into exactly one service and nothing else. giving them the wildcard would open every service |
| one bypass app per public page | everyone | some names under the wildcard must stay public (`www.`, the uptime page). without a bypass, the wildcard puts a login in front of them |
| the app launcher | the owner | cloudflare's built-in page listing your apps. it comes with the account |

the naming convention is that a policy is named after **who** it lets in (`owner_policy`, `uptime-prober_policy`, `<service>-<visitor>_policy`), and a token after the machine that carries it.

## predicting what happens

each case below follows from the rules above. try to answer each one before reading the answer.

1. **you open a private service in a browser.** its name has no app of its own, so the wildcard wins. the owner policy asks you to log in, then face id (see [the second step](#the-second-step-face-id)), and the session cookie covers the app for an hour. you see the service.
2. **someone else opens the same service.** the wildcard wins, no policy matches their login, and they get the login page and stop there. the request never leaves cloudflare, so the server never sees it.
3. **you add an exact-name app for a phone app's token and attach only the token's policy.** the phone works. your browser is now refused on that hostname, because the wildcard's owner policy no longer applies there. fix: attach the owner and prober policies too.
4. **a visitor opens `www.adhikrish.cloud`.** the bypass app is more specific than the wildcard, so it wins, and "everyone" matches. no login. now delete the bypass app: the wildcard wins instead, and the public site suddenly demands a login. the bare `adhikrish.cloud` is unaffected either way, because `*.adhikrish.cloud` matches subdomains, not the bare name.
5. **the box is switched off.** access still runs, because it lives at cloudflare's edge, not on the box. a valid token or login still passes access, and the request then fails at the tunnel (cloudflare answers `530`). this is why a token's "last seen" time can be recent while the box is dead.

## the signed pass, and why apps check it

when access lets a request through, it adds a header, `Cf-Access-Jwt-Assertion`. its value is a jwt (json web token): a small json document saying who passed (an email for a person, the token's client id for a machine) and which app let them through (the app's **audience tag**, `aud`), signed with a key only cloudflare holds.

an app behind access can verify that signature against cloudflare's public keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`). senior intern does this in [`private/snrintern/src/auth.ts`](../private/snrintern/src/auth.ts). two reasons:

- **access only guards the road through cloudflare.** anything that reaches the app another way, such as a device on the home network hitting a port the server publishes, skips access entirely. a missing or forged pass then gets nothing.
- **it tells the app who is calling.** senior intern records the caller on every change it logs.

the audience tag belongs to the app, not to the hostname. renaming an app's hostname keeps its tag, so the code that checks the tag doesn't change. deleting and recreating the app makes a new tag, and every check against the old one fails. so rename apps in place, never delete and recreate them.

a bypass app attaches no pass, because nobody was checked. anything that relies on the pass can't sit behind a bypass.

a public page that does work on every visit can be used to make *you* do work. the uptime page used to probe every service on each load, about one request per service through the tunnel, so anyone reloading it in a loop could push traffic into the box. it went public only after it switched to reading what its 5-minute timer stored. before you bypass a page, check what a single visit costs.

## the second step: face id

a person who passes a policy still has one more step. access asks for a biometric check (face id or touch id) before it sets the session cookie. cloudflare calls this **independent mfa**: it runs in access itself, after the login and the policy, whatever the identity provider did.

```text
browser opens a private name, no cookie
    │
    ▼
1. log in with google
    │
    ▼
2. the app's policies: does this person match?  no → stop
    │ yes
    ▼
3. face id / touch id on this device             fails → stop
    │
    ▼
4. session cookie for 1 hour. every request in that hour goes
   straight through: no login, no face id
    │
    ▼
5. the hour ends → back to step 1
```

three settings make it, all in zero trust's access settings, made with `cf`:

- **mfa for every app by default**, with biometrics as the only method. a new app gets it without anyone remembering to switch it on.
- **an mfa duration of 0.** face id is asked on every login, never skipped because an earlier approval is still fresh.
- **a session of 1 hour on every app** (it was 24 hours, and 6 for some). the session is a fixed clock from the login, not an idle timer: cloudflare has no "lock after x minutes idle" for these apps.

**wrong model:** a short session only makes you log in more often. **why it fails:** the cookie, not the login, is what lets someone in. while a cookie is alive, anyone holding the unlocked device gets in, mfa or not. **replacement model:** the session length is the window a borrowed device stays open. it trades that window against how often a long stretch of use gets interrupted. an hour keeps both small, and an interruption costs one click (google remembers you) plus face id.

**enrolling.** the first login after mfa is on asks you to register a device, and its face id or touch id becomes your second factor. enroll more than one device (a laptop and a phone), so losing one doesn't lock you out. if every device is lost, turn mfa off in the cloudflare dashboard. that needs your cloudflare account login, not access, so a lockout of access never locks you out of the fix.

**who skips it.**

- **machines.** service tokens never meet mfa: there's no person and no device to check. the agents and the uptime prober carry on unchanged.
- **one visitor's policy turns mfa off** (`mfa_disabled` on the policy). it's for a family member whose device may not do biometrics. it only reaches the one app that policy is attached to, and that policy keeps its own 24-hour session.

predict it: you sign in at 9:00 and use a service until 9:40. you come back at 9:50: the cookie is still good, so no prompt. at 10:05 the next request finds the cookie expired, and you go through google and face id again, mid-use if you happen to be on the page.

## invariants

- every private hostname is covered by exactly one winning app, and that app's list includes the owner and the uptime prober. if the prober is missing, the uptime page shows the service as refused, not down.
- access protects requests that come through cloudflare. it doesn't protect ports the server publishes on its own networks. those need their own firewall rules.
- service tokens are created with a duration. ours are set far into the future, so they don't silently expire. revoke a leaked one in zero trust → access → service auth. that takes effect at once, and the program carrying it gets the login redirect from then on.
- token secrets live in 1password, never in git. the repo may name a 1password item, but never contain its value.

## changing access safely

- **a new private service:** do nothing. the wildcard already guards it. see [the add-a-service runbook](add-a-service.md).
- **a new visitor for one service:** create a token (for a machine) or an allow policy (for a person), then an exact-name app with the owner policy, the prober policy and the new policy.
- **moving a service to a new hostname:** change the existing app's hostname first, then deploy the service on the new name. that way the new name is never reachable without a login.
- **cloudflare changes are made with the `cf` cli**, and always asked about first (see the root `AGENTS.md`).

## open questions

- the app launcher is enabled but unused. turning it off is harmless as far as we know. this hasn't been verified.
