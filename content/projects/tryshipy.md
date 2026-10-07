# tryshipy (revenue generating)

[tryshipy](https://tryshipy.com) is a system for ship brokers. it brings emails and uploaded documents into one workflow: understand the information, find relevant opportunities, and help the broker move a deal forward.

a ship sale can involve a buyer's requirements, several seller offers, vessel documents, and changing terms spread across conversations. the system connects those pieces while keeping each conclusion tied to its original source.

## the overall design

```text
email + uploaded documents
            |
            v
         capture
            |
            +--> originals
            |
            v
    background processing
            |
            v
    structured knowledge
            |
            v
     suggested matches
            |
            v
       broker review
            |
            v
     deal + recap draft
```

capture preserves the original email or file. background workers read the conversation and its attachments, then build records of vessels, buyer requirements, and seller offers. matching uses those records to suggest opportunities. a broker chooses whether to start a deal. the system can then draft a recap, a summary of the proposed deal terms, for the broker to review.

## keep the app separate from processing

reading a dashboard and processing a long conversation have different needs. the app handles sign-in, access checks, saved results, and broker actions. slower work runs in the background, so a document or analysis job does not need to finish inside a browser request.

```text
broker <-> web app
              |
              v
        access checks
          /       \
         v         v
   saved results  job queue
                      |
                      v
originals -------> workers
                      |
                      v
                updated records
```

the saved workflow state records what has finished and what remains. a queue tells workers which work to attempt. separating those roles lets a failed attempt be retried without treating the queue itself as the record of completed work.

## preserve evidence as information changes

the original evidence and the system's interpretation are separate records. a new email can change a vessel's details, an offer, or a buyer's requirements. the system can update its interpretation while retaining the original sources and their versions.

```text
original email or document
            |
            v
     knowledge version
            |
            v
      match assessment
            |
            v
    selected deal evidence
            |
            v
     broker-reviewed recap
```

when a broker starts a deal, the selected evidence is captured for that decision. later information can prompt a review without silently replacing the basis of the original choice. a recap draft carries references back to the evidence used to write it.

## make failures visible

external services, files, and analysis can fail independently. background stages record their progress, retry recoverable failures, and expose work that needs attention. a missing attachment or failed analysis stays visible instead of being treated as a completed result.

this also matters when the same work arrives again. workers check durable state and the source version before publishing results, rather than assuming that every delivery represents new information.

## keep access and decisions explicit

access checks follow the source information into the records derived from it. keeping companies separate is only part of the boundary; private mailbox evidence also needs its own authorization.

the system proposes matches and drafts terms. the broker starts the deal, reviews the evidence, and decides which commercial terms to use or share. analysis supports a commercial decision; it does not give the system authority to make that decision on the broker's behalf.
