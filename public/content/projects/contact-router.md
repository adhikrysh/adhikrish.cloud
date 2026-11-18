# contact-router

in space, links only exist during scheduled windows, a lot of them share one radio, and data has a deadline. so you can't route like the internet and assume a path is up right now. you have to plan over a schedule, and two routes that look fine on their own can both want the same radio at the same moment. contact-router plans the earliest arrival for each bundle of data and books radio time as it goes, so a radio never gets double-booked. 2,800 of its bookings were checked against an independent brute-force search.

## how it works

each link window has an open time, a close time, a data rate, a travel delay and, optionally, the radio it uses. data moves in bundles, and a bundle can wait at a node until a window opens.

<figure class="diagram">
<svg viewBox="0 0 600 90" role="img" aria-label="bundle flow: bundle, stored at a node, first free slot that fits, shared radio calendar, arrival">
<defs><marker id="cr-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="4" y="20" width="108" height="50" rx="4"/><text class="d-t" x="58.0" y="50.0" text-anchor="middle">bundle</text>
<rect class="d-box" x="126" y="20" width="108" height="50" rx="4"/><text class="d-t" x="180.0" y="42" text-anchor="middle">stored</text><text class="d-s" x="180.0" y="59" text-anchor="middle">at a node</text>
<rect class="d-box" x="248" y="20" width="108" height="50" rx="4"/><text class="d-t" x="302.0" y="42" text-anchor="middle">free slot</text><text class="d-s" x="302.0" y="59" text-anchor="middle">first that fits</text>
<rect class="d-box" x="370" y="20" width="108" height="50" rx="4"/><text class="d-t" x="424.0" y="42" text-anchor="middle">calendar</text><text class="d-s" x="424.0" y="59" text-anchor="middle">shared radio</text>
<rect class="d-box" x="492" y="20" width="108" height="50" rx="4"/><text class="d-t" x="546.0" y="50.0" text-anchor="middle">arrival</text>
<line class="d-line" x1="112" y1="45" x2="126" y2="45" marker-end="url(#cr-a1)"/><line class="d-line" x1="234" y1="45" x2="248" y2="45" marker-end="url(#cr-a1)"/><line class="d-line" x1="356" y1="45" x2="370" y2="45" marker-end="url(#cr-a1)"/><line class="d-line" x1="478" y1="45" x2="492" y2="45" marker-end="url(#cr-a1)"/>
</svg>
<figcaption>one bundle. it waits at a node, takes the first free slot that fits, and books it on the radio calendar the link shares.</figcaption>
</figure>

![Contact reservations](docs/reservations.png)

the router searches for the earliest arrival over that schedule. keeping one best arrival per node is enough here, because storage is unlimited, waiting is free and each radio's calendar fills in time order. arriving earlier never takes away an option that arriving later would have had. add buffer limits or energy costs and that stops being true, and you'd need a different search.

time is whole microseconds, with an overflow check on every addition. the search never edits a calendar while it runs. once it has a full route, it copies the calendars, books every hop and swaps the copies in. so a failed search, a missed deadline or a failure halfway through leaves the existing plan untouched. ties always break the same way, so the result doesn't depend on input order.

<figure class="diagram">
<svg viewBox="0 0 600 170" role="img" aria-label="copy, book, swap: calendars are copied, every hop is booked on the copies and the copies are swapped in; on failure the copies are dropped and the existing plan stays">
<defs><marker id="cr-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="10" width="170" height="50" rx="4"/><text class="d-t" x="95.0" y="32" text-anchor="middle">copy calendars</text><text class="d-s" x="95.0" y="49" text-anchor="middle">once a full route exists</text>
<rect class="d-box" x="215" y="10" width="170" height="50" rx="4"/><text class="d-t" x="300.0" y="32" text-anchor="middle">book every hop</text><text class="d-s" x="300.0" y="49" text-anchor="middle">on the copies only</text>
<rect class="d-box" x="420" y="10" width="170" height="50" rx="4"/><text class="d-t" x="505.0" y="32" text-anchor="middle">swap copies in</text><text class="d-s" x="505.0" y="49" text-anchor="middle">the new plan is live</text>
<line class="d-line" x1="180" y1="35" x2="213" y2="35" marker-end="url(#cr-a3)"/><line class="d-line" x1="385" y1="35" x2="418" y2="35" marker-end="url(#cr-a3)"/><line class="d-line d-dash" x1="300" y1="60" x2="300" y2="108" marker-end="url(#cr-a3)"/><text class="d-s" x="292" y="92" text-anchor="end">search fails, deadline missed or failure halfway</text><rect class="d-box" x="185" y="110" width="230" height="50" rx="4"/><text class="d-t" x="300.0" y="132" text-anchor="middle">copies dropped</text><text class="d-s" x="300.0" y="149" text-anchor="middle">existing plan untouched</text>
</svg>
<figcaption>how a route is committed. the live calendars are only replaced once every hop has booked successfully.</figcaption>
</figure>

## an example

in the lunar scenario, health telemetry has priority, takes the direct link and arrives at 6.3 s. science data doesn't fit in what's left of the first relay window, so it waits for the next one and arrives at 44.3 s. the image bundles have no route left.

<figure class="diagram">
<svg viewBox="0 0 600 200" role="img" aria-label="timeline of the lunar example: health arrives at 6.3 s on the direct link, science waits for the next relay window and arrives at 44.3 s, image has no route">
<defs><marker id="cr-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-t" x="10" y="45" text-anchor="start">health</text><text class="d-t" x="10" y="95" text-anchor="start">science</text><text class="d-t" x="10" y="145" text-anchor="start">image</text><rect class="d-store" x="100" y="28" width="60.5" height="24" rx="4"/><text class="d-s" x="172" y="45" text-anchor="start">arrives 6.3 s, direct link</text><rect class="d-store" x="100" y="78" width="425.3" height="24" rx="4"/><text class="d-s" x="312" y="94" text-anchor="middle">waits for the next relay window</text><text class="d-s" x="525" y="72" text-anchor="end">arrives 44.3 s</text><text class="d-s d-warn" x="100" y="145" text-anchor="start">no route</text><line class="d-line" x1="100" y1="170" x2="580" y2="170"/><line class="d-line" x1="100.0" y1="166" x2="100.0" y2="174"/><text class="d-s" x="100.0" y="190" text-anchor="middle">0 s</text><line class="d-line" x1="196.0" y1="166" x2="196.0" y2="174"/><text class="d-s" x="196.0" y="190" text-anchor="middle">10 s</text><line class="d-line" x1="292.0" y1="166" x2="292.0" y2="174"/><text class="d-s" x="292.0" y="190" text-anchor="middle">20 s</text><line class="d-line" x1="388.0" y1="166" x2="388.0" y2="174"/><text class="d-s" x="388.0" y="190" text-anchor="middle">30 s</text><line class="d-line" x1="484.0" y1="166" x2="484.0" y2="174"/><text class="d-s" x="484.0" y="190" text-anchor="middle">40 s</text><line class="d-line" x1="580.0" y1="166" x2="580.0" y2="174"/><text class="d-s" x="580.0" y="190" text-anchor="middle">50 s</text>
</svg>
<figcaption>arrival times in the lunar scenario. bars run from time 0 to arrival.</figcaption>
</figure>

```text
health,reserved,6300000,6300000,3
science,reserved,44300000,44300000,4;5
image,no_route,,,
```

bundles are booked greedily: each one gets its earliest arrival given what's already booked. it's predictable, but it doesn't optimise the batch as a whole, and one bundle's choice can block a cheaper option for a later one. a joint objective is the next step.

## testing

2,800 bookings checked against an independent brute-force path search and a microsecond-by-microsecond scan of every slot. other tests cover shared-radio conflicts, expiry and delay edge cases, releasing routes, overflow, search limits and shuffled inputs.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
ctest --test-dir build --output-on-failure
./build/contact-route examples/contacts.csv examples/bundles.csv
```

## limits

it doesn't model splitting bundles, buffer limits, retransmission or uncertain window times. it's a planning simulator, not an implementation of the bundle protocol. nasa's [dtn overview](https://www.nasa.gov/communicating-with-missions/delay-disruption-tolerant-networking/) covers the bigger picture.
