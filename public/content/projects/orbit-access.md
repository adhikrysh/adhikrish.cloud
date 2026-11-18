# orbit-access

a ground station only gets a few minutes with a low earth orbit satellite each pass. in the default case here it's four passes a day, six to eight minutes each, about half an hour of contact in total, so the pass times need to be right. orbit-access predicts them, accounting for the two effects that matter most: earth's equatorial bulge (j2), which slowly swings tilted orbits around, and earth's rotation, which moves the station under the orbit at about 465 m/s at the equator.

## how it works

<figure class="diagram">
<svg viewBox="0 0 600 190" role="img" aria-label="the pass pipeline: starting state, j2 propagation, station and earth rotation, elevation above the mask, bracket, bisect, pass">
<defs><marker id="oa-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="15" width="130" height="50" rx="4"/><text class="d-t" x="75.0" y="37" text-anchor="middle">state at t0</text><text class="d-s" x="75.0" y="54" text-anchor="middle">orbit start</text><rect class="d-box" x="175" y="15" width="190" height="50" rx="4"/><text class="d-t" x="270.0" y="37" text-anchor="middle">adaptive j2 propagation</text><text class="d-s" x="270.0" y="54" text-anchor="middle">dormand-prince 5(4)</text><rect class="d-box" x="400" y="15" width="150" height="50" rx="4"/><text class="d-t" x="475.0" y="37" text-anchor="middle">wgs84 station</text><text class="d-s" x="475.0" y="54" text-anchor="middle">+ earth rotation</text>
<line class="d-line" x1="140" y1="40" x2="173" y2="40" marker-end="url(#oa-a1)"/><line class="d-line" x1="365" y1="40" x2="398" y2="40" marker-end="url(#oa-a1)"/>
<rect class="d-box" x="10" y="125" width="120" height="50" rx="4"/><text class="d-t" x="70.0" y="147" text-anchor="middle">elevation</text><text class="d-s" x="70.0" y="164" text-anchor="middle">above the mask</text><rect class="d-box" x="160" y="125" width="120" height="50" rx="4"/><text class="d-t" x="220.0" y="147" text-anchor="middle">bracket</text><text class="d-s" x="220.0" y="164" text-anchor="middle">every 10 s</text><rect class="d-box" x="310" y="125" width="120" height="50" rx="4"/><text class="d-t" x="370.0" y="147" text-anchor="middle">bisect</text><text class="d-s" x="370.0" y="164" text-anchor="middle">to 1e-5 s</text><rect class="d-box" x="460" y="125" width="120" height="50" rx="4"/><text class="d-t" x="520.0" y="147" text-anchor="middle">pass</text><text class="d-s" x="520.0" y="164" text-anchor="middle">rise and set</text>
<path class="d-line" d="M475,65 L475,95 L70,95 L70,123" marker-end="url(#oa-a1)"/>
<line class="d-line" x1="130" y1="150" x2="158" y2="150" marker-end="url(#oa-a1)"/><line class="d-line" x1="280" y1="150" x2="308" y2="150" marker-end="url(#oa-a1)"/><line class="d-line" x1="430" y1="150" x2="458" y2="150" marker-end="url(#oa-a1)"/>
</svg>
<figcaption>the pipeline from a starting state to a pass.</figcaption>
</figure>

the default run is a circular orbit at 7,000 km radius and 51.6° inclination, with a station in singapore (1.35° N 103.82° E). it finds four passes above 10° in one day, lasting 390.278, 449.958, 455.508 and 404.475 s. these are outputs of this model, not predictions for a real spacecraft.

<figure class="diagram">
<svg viewBox="0 0 600 228" role="img" aria-label="bar chart of the four default passes lasting 390.278, 449.958, 455.508 and 404.475 seconds">
<text class="d-s" x="70" y="32" text-anchor="end">pass 1</text><rect class="d-store" x="80" y="15" width="351.3" height="26" rx="3"/><text class="d-s" x="439.3" y="32" text-anchor="start">390.278 s</text>
<text class="d-s" x="70" y="72" text-anchor="end">pass 2</text><rect class="d-store" x="80" y="55" width="405.0" height="26" rx="3"/><text class="d-s" x="493.0" y="72" text-anchor="start">449.958 s</text>
<text class="d-s" x="70" y="112" text-anchor="end">pass 3</text><rect class="d-store" x="80" y="95" width="410.0" height="26" rx="3"/><text class="d-s" x="498.0" y="112" text-anchor="start">455.508 s</text>
<text class="d-s" x="70" y="152" text-anchor="end">pass 4</text><rect class="d-store" x="80" y="135" width="364.0" height="26" rx="3"/><text class="d-s" x="452.0" y="152" text-anchor="start">404.475 s</text>
<line class="d-line" x1="80" y1="185" x2="530" y2="185"/><line class="d-line" x1="80" y1="15" x2="80" y2="185"/>
<line class="d-line" x1="80.0" y1="185" x2="80.0" y2="190"/><text class="d-s" x="80.0" y="204" text-anchor="middle">0</text>
<line class="d-line" x1="170.0" y1="185" x2="170.0" y2="190"/><text class="d-s" x="170.0" y="204" text-anchor="middle">100</text>
<line class="d-line" x1="260.0" y1="185" x2="260.0" y2="190"/><text class="d-s" x="260.0" y="204" text-anchor="middle">200</text>
<line class="d-line" x1="350.0" y1="185" x2="350.0" y2="190"/><text class="d-s" x="350.0" y="204" text-anchor="middle">300</text>
<line class="d-line" x1="440.0" y1="185" x2="440.0" y2="190"/><text class="d-s" x="440.0" y="204" text-anchor="middle">400</text>
<line class="d-line" x1="530.0" y1="185" x2="530.0" y2="190"/><text class="d-s" x="530.0" y="204" text-anchor="middle">500</text>
<text class="d-s" x="570" y="220" text-anchor="end">seconds</text>
</svg>
<figcaption>the four passes above 10° in the default day, in seconds.</figcaption>
</figure>

![One-day comparison](docs/orbit-comparison.png)

gravity is a point mass plus j2 ([dynamics.cpp](src/dynamics.cpp)). the orbit is stepped with dormand-prince 5(4), an integrator that adapts its step size, with separate error tolerances for position (1e-8 km) and velocity (1e-11 km/s). it either reaches the requested time or throws, never a partial trajectory.

<figure class="diagram">
<svg viewBox="0 0 600 220" role="img" aria-label="two effects shown from above the pole: j2 swings the tilted orbit plane around, and earth rotation carries the station under the orbit at about 465 m/s">
<defs><marker id="oa-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<circle class="d-store" cx="135" cy="105" r="28"/><text class="d-s" x="135" y="109" text-anchor="middle">earth</text>
<ellipse class="d-line" cx="135" cy="105" rx="100" ry="40" transform="rotate(-20 135 105)"/><ellipse class="d-line d-dash" cx="135" cy="105" rx="100" ry="40" transform="rotate(25 135 105)"/>
<path class="d-line" d="M255,67 A112,112 0 0 1 251.5,152" marker-end="url(#oa-a2)"/><text class="d-s" x="266" y="112" text-anchor="start">slowly</text>
<text class="d-s" x="44" y="48" text-anchor="middle">orbit later</text><text class="d-s" x="41" y="158" text-anchor="middle">orbit now</text>
<text class="d-t" x="135" y="205" text-anchor="middle">j2 swings the orbit plane</text>
<ellipse class="d-line" cx="430" cy="105" rx="100" ry="40" transform="rotate(-20 430 105)"/><circle class="d-store" cx="430" cy="105" r="40"/><text class="d-s" x="430" y="109" text-anchor="middle">earth</text><circle class="d-arrow" cx="470" cy="105" r="4"/>
<line class="d-line" x1="470" y1="100" x2="470" y2="72" marker-end="url(#oa-a2)"/><rect class="d-box" x="474" y="62" width="122" height="22" rx="4"/><text class="d-s" x="535" y="77" text-anchor="middle">station, ~465 m/s</text>
<text class="d-t" x="430" y="205" text-anchor="middle">earth spins under the orbit</text>
</svg>
<figcaption>a schematic of the two effects, seen from above. left: j2 slowly swings the orbit plane around the earth. right: earth's spin carries the station at about 465 m/s at the equator.</figcaption>
</figure>

with j2 on, energy and the z part of angular momentum stay constant, but the full angular momentum vector doesn't. that decides which conservation checks actually test the integrator ([numerics.md](docs/numerics.md)).

the station's "up" is the line perpendicular to the wgs84 ellipsoid, not a line from earth's centre, rotated into space with an explicit greenwich angle. passes are found by checking elevation every 10 s, then narrowing down each rise and set to 1e-5 s by bisection. each step re-runs the orbit from the same starting point instead of interpolating. a grazing pass shorter than 10 s can still be missed, and the docs say so.

<figure class="diagram">
<svg viewBox="0 0 600 272" role="img" aria-label="the wgs84 normal at the station differs from the line from earth's centre; the station's up is the normal">
<defs><marker id="oa-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<ellipse class="d-store" cx="200" cy="140" rx="150" ry="100"/>
<line class="d-line d-dash" x1="200" y1="140" x2="314.9" y2="75.7"/><circle class="d-arrow" cx="200" cy="140" r="3"/><text class="d-s" x="200" y="158" text-anchor="middle">earth's centre</text>
<line class="d-line d-dash" x1="314.9" y1="75.7" x2="384.7" y2="36.7" marker-end="url(#oa-a3)"/><line class="d-line" x1="314.9" y1="75.7" x2="364.6" y2="13.1" marker-end="url(#oa-a3)"/>
<circle class="d-arrow" cx="314.9" cy="75.7" r="4"/><text class="d-s" x="326" y="94" text-anchor="start">station</text>
<text class="d-s" x="372" y="12" text-anchor="start">wgs84 normal: the real up</text><text class="d-s" x="392" y="44" text-anchor="start">line from earth's centre</text>
<text class="d-s" x="200" y="262" text-anchor="middle">wgs84 ellipsoid, flattening exaggerated</text>
</svg>
<figcaption>a schematic, flattening exaggerated. the station's up is the wgs84 normal (solid), which points a little differently from the line from earth's centre (dashed).</figcaption>
</figure>

<figure class="diagram">
<svg viewBox="0 0 600 256" role="img" aria-label="schematic of elevation over time sampled every 10 seconds; one sample below the 10 degree mask and the next above bracket the rise, which is then bisected to 1e-5 seconds">
<line class="d-line" x1="60" y1="30" x2="60" y2="220"/><line class="d-line" x1="60" y1="220" x2="570" y2="220"/><text class="d-s" x="66" y="24" text-anchor="start">elevation</text><text class="d-s" x="570" y="240" text-anchor="end">time</text>
<line class="d-line d-dash" x1="60" y1="140" x2="570" y2="140"/><text class="d-s" x="570" y="133" text-anchor="end">10° mask</text>
<rect class="d-store" x="100" y="90" width="40" height="130" rx="2"/>
<path class="d-line" d="M60,210 Q310,-130 560,210"/>
<circle class="d-arrow" cx="60" cy="210.0" r="3"/>
<circle class="d-arrow" cx="100" cy="160.0" r="3"/>
<circle class="d-arrow" cx="140" cy="118.6" r="3"/>
<circle class="d-arrow" cx="180" cy="86.0" r="3"/>
<circle class="d-arrow" cx="220" cy="62.0" r="3"/>
<circle class="d-arrow" cx="260" cy="46.8" r="3"/>
<circle class="d-arrow" cx="300" cy="40.3" r="3"/>
<circle class="d-arrow" cx="340" cy="42.4" r="3"/>
<circle class="d-arrow" cx="380" cy="53.3" r="3"/>
<circle class="d-arrow" cx="420" cy="72.9" r="3"/>
<circle class="d-arrow" cx="460" cy="101.2" r="3"/>
<circle class="d-arrow" cx="500" cy="138.2" r="3"/>
<circle class="d-arrow" cx="540" cy="183.9" r="3"/>
<text class="d-s" x="120" y="64" text-anchor="middle">bracket, then bisect</text><text class="d-s" x="120" y="78" text-anchor="middle">to 1e-5 s</text>
<text class="d-s" x="310" y="22" text-anchor="middle">elevation sampled every 10 s</text>
<line class="d-line" x1="60" y1="232" x2="100" y2="232"/><text class="d-s" x="80" y="248" text-anchor="middle">10 s</text>
</svg>
<figcaption>a schematic of one pass. elevation is sampled every 10 s, the samples either side of the mask crossing bracket it, and bisection narrows the crossing to 1e-5 s. the set is found the same way.</figcaption>
</figure>

## testing

- 150 elliptical orbits against an independent kepler solver, within 0.5 m and 0.5 mm/s
- conservation over long runs
- the j2 acceleration against a numerical gradient of the gravity potential
- orbit plane drift within 1% of first-order theory
- rise and set times against analytic answers
- the same pass list when the sample step drops from 31 s to 7 s

[ci](.github/workflows/check.yml) runs the suite with address and undefined-behaviour sanitizers.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
ctest --test-dir build --output-on-failure
./build/orbit-access passes 86400 1.3521 103.8198 10 j2
```

## limits

no drag, no moon or sun gravity, no utc or polar motion corrections, no atmospheric refraction. it's a tool for examining the numerics and geometry, not for scheduling real contacts.
