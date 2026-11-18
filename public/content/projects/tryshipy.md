# shipy

ship brokers do most of their deals over email, so the details end up buried in long threads and attachments. [shipy](https://tryshipy.com) is an ai operating system for brokers. it reads that email, turns it into deal records that point back to the exact source, and gives them one place to check the evidence and move deals forward. it's live and generating revenue.

## the core rules

- **evidence.** the original emails and files are encrypted, versioned and kept apart from the system's interpretation of them. every record links to the exact source versions behind it.
- **jobs.** postgres stores who's working on what, how far they got and whether it's done. queues only wake workers up with an id, and a repeated message lands on the same job instead of creating a new one.
- **publishing.** a worker can only publish while it still owns the job and is working on the latest version of the source. late work can't overwrite a newer email.
- **reconciliation.** retries handle a message that fails. a scheduled job finds work whose wake-up got lost, like a database write that succeeded followed by a queue message that didn't.

<figure class="diagram">
<svg viewBox="0 0 600 270" role="img" aria-label="evidence kept apart from interpretation, jobs in postgres woken by queue ids, publishing guarded, and a scheduled job that finds lost wake-ups">
<defs><marker id="shipy-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-store" x="10" y="10" width="200" height="50" rx="14"/><text class="d-t" x="110" y="32" text-anchor="middle">evidence</text><text class="d-s" x="110" y="49" text-anchor="middle">encrypted, versioned originals</text>
<rect class="d-box" x="390" y="10" width="200" height="50" rx="4"/><text class="d-t" x="490" y="32" text-anchor="middle">broker records</text><text class="d-s" x="490" y="49" text-anchor="middle">the system&#x27;s interpretation</text>
<line class="d-line d-dash" x1="388" y1="35" x2="212" y2="35" marker-end="url(#shipy-a2)"/>
<text class="d-s" x="300" y="28" text-anchor="middle">links to source versions</text>
<rect class="d-store" x="10" y="130" width="120" height="50" rx="14"/><text class="d-t" x="70" y="152" text-anchor="middle">queue</text><text class="d-s" x="70" y="169" text-anchor="middle">wakes with an id</text>
<rect class="d-box" x="180" y="130" width="120" height="50" rx="4"/><text class="d-t" x="240" y="152" text-anchor="middle">worker</text><text class="d-s" x="240" y="169" text-anchor="middle">owns the job</text>
<rect class="d-box" x="350" y="130" width="170" height="50" rx="4"/><text class="d-t" x="435" y="152" text-anchor="middle">publish</text><text class="d-s" x="435" y="169" text-anchor="middle">job owned, source latest</text>
<line class="d-line" x1="130" y1="155" x2="178" y2="155" marker-end="url(#shipy-a2)"/>
<line class="d-line" x1="300" y1="155" x2="348" y2="155" marker-end="url(#shipy-a2)"/>
<line class="d-line" x1="470" y1="130" x2="470" y2="62" marker-end="url(#shipy-a2)"/>
<rect class="d-store" x="180" y="210" width="120" height="50" rx="14"/><text class="d-t" x="240" y="232" text-anchor="middle">postgres</text><text class="d-s" x="240" y="249" text-anchor="middle">job state</text>
<line class="d-line" x1="240" y1="180" x2="240" y2="208" marker-end="url(#shipy-a2)"/>
<rect class="d-box" x="10" y="210" width="134" height="50" rx="4"/><text class="d-t" x="77" y="232" text-anchor="middle">scheduled job</text><text class="d-s" x="77" y="249" text-anchor="middle">finds lost wake-ups</text>
<line class="d-line d-dash" x1="70" y1="210" x2="70" y2="182" marker-end="url(#shipy-a2)"/>
</svg>
<figcaption>the four rules. evidence stays apart from its interpretation, queues carry only ids, postgres holds job state, publishing is guarded, and a scheduled job catches lost wake-ups.</figcaption>
</figure>

## what happens to an email

<figure class="diagram">
<svg viewBox="0 0 600 180" role="img" aria-label="email pipeline: gmail or imap, capture, attachments extracted, relevance check, structured extraction, knowledge version, broker records">
<defs><marker id="shipy-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="10" width="128" height="50" rx="4"/><text class="d-t" x="74" y="39.5" text-anchor="middle">gmail / imap</text>
<rect class="d-box" x="162" y="10" width="128" height="50" rx="4"/><text class="d-t" x="226" y="32" text-anchor="middle">capture</text><text class="d-s" x="226" y="49" text-anchor="middle">s3 + postgres</text>
<rect class="d-box" x="314" y="10" width="128" height="50" rx="4"/><text class="d-t" x="378" y="32" text-anchor="middle">attachments</text><text class="d-s" x="378" y="49" text-anchor="middle">extracted</text>
<rect class="d-box" x="466" y="10" width="128" height="50" rx="4"/><text class="d-t" x="530" y="32" text-anchor="middle">relevance check</text><text class="d-s" x="530" y="49" text-anchor="middle">clef, workers ai</text>
<line class="d-line" x1="138" y1="35" x2="160" y2="35" marker-end="url(#shipy-a1)"/>
<line class="d-line" x1="290" y1="35" x2="312" y2="35" marker-end="url(#shipy-a1)"/>
<line class="d-line" x1="442" y1="35" x2="464" y2="35" marker-end="url(#shipy-a1)"/>
<path class="d-line" d="M530,60 L530,90 L94,90 L94,116" fill="none" marker-end="url(#shipy-a1)"/>
<text class="d-s" x="312" y="84" text-anchor="middle">relevant mail only</text>
<rect class="d-box" x="6" y="118" width="176" height="50" rx="4"/><text class="d-t" x="94" y="140" text-anchor="middle">structured extraction</text><text class="d-s" x="94" y="157" text-anchor="middle">fireworks</text>
<rect class="d-box" x="212" y="118" width="176" height="50" rx="4"/><text class="d-t" x="300" y="140" text-anchor="middle">knowledge version</text><text class="d-s" x="300" y="157" text-anchor="middle">immutable</text>
<rect class="d-box" x="418" y="118" width="176" height="50" rx="4"/><text class="d-t" x="506" y="140" text-anchor="middle">broker records</text><text class="d-s" x="506" y="157" text-anchor="middle">built by plain code</text>
<line class="d-line" x1="182" y1="143" x2="210" y2="143" marker-end="url(#shipy-a1)"/>
<line class="d-line" x1="388" y1="143" x2="416" y2="143" marker-end="url(#shipy-a1)"/>
</svg>
<figcaption>what happens to an email, step by step. the relevance check runs first so unrelated mail stops before the expensive extraction step.</figcaption>
</figure>

shipy reads the whole thread, so a later reply updates how the conversation is understood.

the relevance check runs first so unrelated mail stops before the expensive step. [clef](https://developers.cloudflare.com/workers-ai/models/clef-flash/) returns how likely an email is to matter, and shipy records the decision. relevant mail goes to fireworks for extraction, where the output has to match a schema and point at sources the broker is allowed to see. plain code, not a model, then turns that into the records brokers work with.

queue messages carry ids, never email bodies or mailbox passwords. if an attachment fails to extract, that gap stays visible instead of disappearing.

when a broker starts a deal, the evidence behind it is frozen. a later email can suggest a new recap, but it can't rewrite what an earlier decision was based on.

## where it runs

the web app is next.js on cloudflare workers. sessions go through workos. database connections are pooled by hyperdrive and reach a private postgres on aws through a cloudflare tunnel, so the database has no public address.

<figure class="diagram">
<svg viewBox="0 0 600 175" role="img" aria-label="where the web app runs: browser to next.js on cloudflare workers, sessions through workos, hyperdrive and a cloudflare tunnel to a private postgres on aws">
<defs><marker id="shipy-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="10" width="120" height="50" rx="4"/><text class="d-t" x="70" y="39.5" text-anchor="middle">browser</text>
<rect class="d-box" x="180" y="10" width="170" height="50" rx="4"/><text class="d-t" x="265" y="32" text-anchor="middle">next.js</text><text class="d-s" x="265" y="49" text-anchor="middle">on cloudflare workers</text>
<rect class="d-box" x="405" y="10" width="150" height="50" rx="4"/><text class="d-t" x="480" y="32" text-anchor="middle">hyperdrive</text><text class="d-s" x="480" y="49" text-anchor="middle">pools connections</text>
<line class="d-line" x1="130" y1="35" x2="178" y2="35" marker-end="url(#shipy-a3)"/>
<line class="d-line" x1="350" y1="35" x2="403" y2="35" marker-end="url(#shipy-a3)"/>
<rect class="d-box" x="405" y="110" width="150" height="50" rx="4"/><text class="d-t" x="480" y="132" text-anchor="middle">cloudflare tunnel</text><text class="d-s" x="480" y="149" text-anchor="middle">no public address</text>
<line class="d-line" x1="480" y1="60" x2="480" y2="108" marker-end="url(#shipy-a3)"/>
<rect class="d-box" x="180" y="110" width="170" height="50" rx="4"/><text class="d-t" x="265" y="132" text-anchor="middle">private postgres</text><text class="d-s" x="265" y="149" text-anchor="middle">on aws</text>
<line class="d-line" x1="403" y1="135" x2="352" y2="135" marker-end="url(#shipy-a3)"/>
<rect class="d-box" x="10" y="110" width="120" height="50" rx="4"/><text class="d-t" x="70" y="132" text-anchor="middle">workos</text><text class="d-s" x="70" y="149" text-anchor="middle">sessions</text>
<line class="d-line d-dash" x1="200" y1="60" x2="90" y2="108" marker-end="url(#shipy-a3)"/>
</svg>
<figcaption>the web path. the database is never exposed: hyperdrive reaches it only through a cloudflare tunnel.</figcaption>
</figure>

processing runs on aws lambdas in private subnets. each stage has its own queue, with its own concurrency and retry settings, so a slow model provider builds up a backlog without blocking the web app or other stages. a shared controller (backed by dynamodb) hands out fireworks capacity, so workers wait their turn instead of all hitting the provider at once.

<figure class="diagram">
<svg viewBox="0 0 600 105" role="img" aria-label="processing on aws: a queue and a lambda for each stage, with a dynamodb controller handing out fireworks capacity">
<defs><marker id="shipy-a4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-store" x="10" y="10" width="115" height="50" rx="14"/><text class="d-t" x="67.5" y="32" text-anchor="middle">stage queue</text><text class="d-s" x="67.5" y="49" text-anchor="middle">ids only</text>
<rect class="d-box" x="165" y="10" width="115" height="50" rx="4"/><text class="d-t" x="222.5" y="32" text-anchor="middle">lambda</text><text class="d-s" x="222.5" y="49" text-anchor="middle">private subnet</text>
<rect class="d-box" x="320" y="10" width="115" height="50" rx="4"/><text class="d-t" x="377.5" y="32" text-anchor="middle">controller</text><text class="d-s" x="377.5" y="49" text-anchor="middle">dynamodb</text>
<rect class="d-box" x="475" y="10" width="115" height="50" rx="4"/><text class="d-t" x="532.5" y="32" text-anchor="middle">fireworks</text><text class="d-s" x="532.5" y="49" text-anchor="middle">model provider</text>
<line class="d-line" x1="125" y1="35" x2="163" y2="35" marker-end="url(#shipy-a4)"/>
<line class="d-line" x1="280" y1="35" x2="318" y2="35" marker-end="url(#shipy-a4)"/>
<line class="d-line" x1="435" y1="35" x2="473" y2="35" marker-end="url(#shipy-a4)"/>
<text class="d-s" x="300" y="88" text-anchor="middle">repeated for every stage, each with its own queue, concurrency and retries</text>
</svg>
<figcaption>the processing path. a slow model provider backs up its own queue, and workers wait their turn at the controller.</figcaption>
</figure>

uploads go straight from the browser to s3 through a short-lived signed form. a lambda then checks the stored file against what was approved and pins its exact version before any processing starts.

<figure class="diagram">
<svg viewBox="0 0 600 330" role="img" aria-label="upload flow: browser uploads to s3 with a short-lived signed form, a lambda checks the file against what was approved and pins its exact version, then processing starts">
<defs><marker id="shipy-a5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="180" y="10" width="240" height="50" rx="4"/><text class="d-t" x="300" y="39.5" text-anchor="middle">browser</text>
<rect class="d-store" x="180" y="96" width="240" height="50" rx="14"/><text class="d-t" x="300" y="118" text-anchor="middle">s3</text><text class="d-s" x="300" y="135" text-anchor="middle">file stored</text>
<rect class="d-box" x="180" y="182" width="240" height="50" rx="4"/><text class="d-t" x="300" y="204" text-anchor="middle">lambda</text><text class="d-s" x="300" y="221" text-anchor="middle">checks file against what was approved</text>
<rect class="d-box" x="180" y="268" width="240" height="50" rx="4"/><text class="d-t" x="300" y="290" text-anchor="middle">processing</text><text class="d-s" x="300" y="307" text-anchor="middle">starts after the version is pinned</text>
<line class="d-line" x1="300" y1="60" x2="300" y2="94" marker-end="url(#shipy-a5)"/>
<text class="d-s" x="312" y="82" text-anchor="start">short-lived signed form</text>
<line class="d-line" x1="300" y1="146" x2="300" y2="180" marker-end="url(#shipy-a5)"/>
<line class="d-line" x1="300" y1="232" x2="300" y2="266" marker-end="url(#shipy-a5)"/>
<text class="d-s" x="312" y="254" text-anchor="start">pins exact version</text>
</svg>
<figcaption>the upload path. the file goes straight to s3, and nothing is processed until the lambda has pinned an exact version.</figcaption>
</figure>

## privacy

access follows the person, not just their company. private mailboxes and uploads also need the owner's permission.

the "ask" feature runs in its own lambda with no access to the database, file storage or queues. it only receives records the server already authorised, and the model never writes sql. gmail access is read-only, and the broker makes every commercial decision and sends every email.

<figure class="diagram">
<svg viewBox="0 0 600 70" role="img" aria-label="ask feature: the server authorises records, the ask lambda has no database, file or queue access, and the model never writes sql">
<defs><marker id="shipy-a6" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="10" width="128" height="50" rx="4"/><text class="d-t" x="74" y="32" text-anchor="middle">server</text><text class="d-s" x="74" y="49" text-anchor="middle">authorises records</text>
<rect class="d-box" x="230" y="10" width="160" height="50" rx="4"/><text class="d-t" x="310" y="32" text-anchor="middle">ask lambda</text><text class="d-s" x="310" y="49" text-anchor="middle">no db, files or queues</text>
<rect class="d-box" x="460" y="10" width="130" height="50" rx="4"/><text class="d-t" x="525" y="32" text-anchor="middle">model</text><text class="d-s" x="525" y="49" text-anchor="middle">never writes sql</text>
<line class="d-line" x1="138" y1="35" x2="228" y2="35" marker-end="url(#shipy-a6)"/>
<line class="d-line" x1="390" y1="35" x2="458" y2="35" marker-end="url(#shipy-a6)"/>
</svg>
<figcaption>the ask feature is walled off. it only sees records the server already authorised.</figcaption>
</figure>

logs link the stages together by id and never record email content or credentials.
