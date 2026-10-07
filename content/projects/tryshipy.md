# shipy (revenue generating)

[shipy](https://tryshipy.com) brings a ship broker's private emails and documents into a workspace for vessels, buyer requirements, seller offers, and deals. its architecture separates the interactive app, background processing, and the evidence each result depends on.

the web app runs on cloudflare. aws runs the processing and storage. cloudflare workers ai handles classification; fireworks handles deeper interpretation. postgres connects these parts through durable state, rather than leaving workflow progress inside a queue or a model call.

## the app and the private backend

next.js runs on cloudflare workers through opennext. the worker serves the app, checks the workos session and organization membership, and authorizes each product request. ordinary reads and writes use hyperdrive's postgres connection pool.

```text
browser
   |
   v
cloudflare worker
(next.js + opennext)
   |
   +--> workos: sessions
   |
   +--> hyperdrive: pooled sql
   |       |
   |       v
   |    cloudflare tunnel
   |    (ecs fargate connector)
   |       |
   |       v
   |    private rds / postgres
   |
   +--> iam-authorized lambdas
   |    uploads, sources, ask
   |
   +--> sqs: id-only work
```

the tunnel connector runs inside the aws private network. rds accepts connections from that connector and the backend lambdas; the database has no public endpoint. hyperdrive pools database connections so short-lived web requests can reuse them.

private source reads, upload controls, and the ask interface use iam-signed lambda calls. mailbox imports, document extraction, and long analysis run outside the web request. the public demo form uses a separate d1 database; product and workflow data live in postgres.

## an email through the processing system

gmail and imap have separate synchronization adapters but feed a shared whole-thread processing path. a thread is the unit of interpretation, so a later reply can update the same conversation rather than becoming an unrelated record.

```text
gmail / imap
      |
      v
discovery + capture lambdas
      |
      +--> s3: original evidence
      +--> postgres: job state
      |
      v
attachment extraction lambdas
      |
      v
relevance lambda
      |
      +--> cf worker gateway
      |       |
      |       v
      |    clef / workers ai
      |
      v
knowledge extraction lambda
      |
      +--> fireworks: inference
      |
      v
knowledge artifacts in s3
      + versions in postgres
      |
      v
deterministic record projection
      |
      v
broker workspace
```

separate sqs queues connect the email-processing stages. messages carry identifiers and correlation metadata. workers retrieve the authorized source content from storage; the queue carries neither email bodies nor mailbox credentials.

for one incoming email, the capture worker preserves the original message and records its thread revision. attachment workers extract the associated files. the next stage waits until capture is complete and each attachment has either a usable result or an explicit failure. a failed attachment remains a visible evidence gap.

the relevance lambda calls [clef](https://developers.cloudflare.com/workers-ai/models/clef-flash/) through an authenticated cloudflare worker gateway. clef returns class probabilities; shipy records the relevance decision. unrelated mail can stop before the more expensive extraction stage. the gateway exposes only the permitted models; the backend does not need a cloudflare account api token.

relevant evidence goes to structured extraction through fireworks. the output must satisfy a schema and refer to the authorized sources. the system publishes an immutable knowledge version, then deterministic code projects its contents into broker-facing records. model output proposes an interpretation; code owns validation, publication, and product state.

## storage has two different jobs

**s3 preserves evidence and artifacts.** original emails, attachments, and uploads live in private, versioned buckets encrypted with aws key management service (kms). derived knowledge uses separate storage. records pin object versions and checksums, so an update cannot silently replace the bytes behind an earlier conclusion.

**rds postgres owns state and relationships.** it records organizations, private mailbox and upload ownership, source revisions, processing jobs, claims, published versions, and deals. transactions keep a published version and its current pointer consistent. a worker may publish only while it still owns the claim and its source revision remains current.

when a broker starts a deal, the system freezes the selected evidence versions. later correspondence can produce a new version and a new recap proposal without rewriting the basis of an earlier decision. authorization follows the evidence into the derived records and source viewer.

## uploads take the direct path to s3

the app authorizes an upload and asks a lambda to create a short-lived upload intent. the browser sends the file directly to s3 using a presigned form. its conditions constrain the object, size, type, checksum, and encryption.

```text
browser -> worker -> lambda
                        |
                        v
                 upload intent
                 signed form
                        |
                        v
browser -------------> s3
                        |
                        v
                 finalize lambda
                        |
                        v
                postgres version
                + job
                        |
                        v
                scheduled lambda
                        |
                        v
                broker records
```

finalization verifies the stored object against the intent and pins its exact s3 version before creating the processing job. a scheduled lambda claims that job and reuses the attachment extraction and knowledge publication components. file bytes bypass the web app, while authorization and completion stay server-controlled.

## scaling without losing control

capture, attachments, classification, extraction, and downstream work have separate queues and lambdas. each stage can have its own concurrency and retry policy. a slow inference service can build a backlog without occupying web requests or blocking unrelated attachment work. the knowledge queue uses fifo (first in, first out) groups per thread, keeping ordered work separate from unrelated threads.

postgres claims and expiring leases decide who may process a job. repeated queue deliveries converge on the same durable work. stale revisions cannot overwrite newer results. bounded retries and dead-letter queues isolate persistent failures; a scheduled reconciler rediscovers unfinished work and missed provider changes from saved state. provider checkpoints advance only after the work they cover is durable.

background fireworks calls share a capacity controller backed by dynamodb. workers reserve capacity before calling the provider, defer when the budget is busy, and back off when throttled. conditional updates prevent concurrent workers from spending the same budget. adding lambda concurrency alone does not increase database or model-provider capacity. those limits govern how fast the queues drain.

## privacy, operations, and release boundaries

the ingestion, processing, upload, and source-reading lambdas run in private subnets. an s3 gateway endpoint keeps their object-storage traffic on the aws network; outbound provider requests leave through a nat gateway. iam roles limit each component's aws permissions, and credentials stay in secret stores or encrypted credential records.

the request layer derives access from the authenticated user. an organization boundary alone is insufficient: private mailbox and upload evidence also need owner authorization. ask receives only the server-authorized records needed for its request and returns structured filters or an answer. ask runs in a separate lambda with no database, evidence-store, or queue access. the model does not write sql. gmail access is read-only, and the broker controls commercial decisions and sending.

cloudwatch tracks queue age, dead-letter depth, function errors, and stalled work. structured logs connect stages through identifiers and error categories without recording source content or credentials.

cloudformation defines the aws infrastructure. the web app and backend have separate releases, and backend rollout separates code and infrastructure, database migrations, consumer activation, and external inference activation. that separation keeps deploying code distinct from immediately starting expensive work against private evidence.

the design keeps one relational authority for the workflow, durable object storage for its evidence, and independently paced workers for expensive processing. the system can grow by increasing the capacity of the stage that needs it while preserving the same ownership, versioning, and recovery rules.
