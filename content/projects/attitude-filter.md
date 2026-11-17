# attitude-filter

spacecraft figure out where they're pointing with star trackers, cameras that match star patterns. those drop out during turns, near the sun and during faults, and then all that's left is the gyros, which only measure rotation rate. gyros carry a small constant error, the bias, and integrating it gives a pointing error that keeps growing. attitude-filter estimates that bias while the tracker still works, so the spacecraft can ride out the outage. in the test scenario, gyros alone end up **18.57°** off and the filter ends up **0.089°** off.

## how it works

<figure class="diagram">
<svg viewBox="0 0 600 250" role="img" aria-label="the filter loop: gyro, subtract bias, predict; tracker reading is checked, then rejected or used to correct attitude and bias, then the error frame is reset and fed back">
<defs><marker id="af-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="20" width="100" height="50" rx="4"/><text class="d-t" x="60.0" y="42" text-anchor="middle">gyro</text><text class="d-s" x="60.0" y="59" text-anchor="middle">rotation rate</text><rect class="d-box" x="175" y="20" width="130" height="50" rx="4"/><text class="d-t" x="240.0" y="42" text-anchor="middle">subtract bias</text><text class="d-s" x="240.0" y="59" text-anchor="middle">from the gyro</text><rect class="d-box" x="340" y="20" width="180" height="50" rx="4"/><text class="d-t" x="430.0" y="42" text-anchor="middle">predict attitude</text><text class="d-s" x="430.0" y="59" text-anchor="middle">+ uncertainty</text>
<line class="d-line" x1="110" y1="45" x2="173" y2="45" marker-end="url(#af-a1)"/><line class="d-line" x1="305" y1="45" x2="338" y2="45" marker-end="url(#af-a1)"/>
<rect class="d-box" x="10" y="110" width="90" height="50" rx="4"/><text class="d-t" x="55.0" y="132" text-anchor="middle">tracker</text><text class="d-s" x="55.0" y="149" text-anchor="middle">star camera</text><rect class="d-box" x="130" y="110" width="150" height="50" rx="4"/><text class="d-t" x="205.0" y="132" text-anchor="middle">check the reading</text><text class="d-s" x="205.0" y="149" text-anchor="middle">before using it</text><rect class="d-box" x="340" y="110" width="180" height="50" rx="4"/><text class="d-t" x="430.0" y="132" text-anchor="middle">correct attitude</text><text class="d-s" x="430.0" y="149" text-anchor="middle">+ bias</text>
<line class="d-line" x1="100" y1="135" x2="128" y2="135" marker-end="url(#af-a1)"/><line class="d-line" x1="280" y1="135" x2="338" y2="135" marker-end="url(#af-a1)"/><text class="d-s" x="309" y="127" text-anchor="middle">accepted</text>
<line class="d-line" x1="430" y1="70" x2="430" y2="108" marker-end="url(#af-a1)"/>
<rect class="d-box" x="130" y="190" width="150" height="50" rx="4"/><text class="d-t" x="205.0" y="212" text-anchor="middle">reject it</text><text class="d-s" x="205.0" y="229" text-anchor="middle">reading ignored</text><rect class="d-box" x="340" y="190" width="180" height="50" rx="4"/><text class="d-t" x="430.0" y="212" text-anchor="middle">reset error frame</text><text class="d-s" x="430.0" y="229" text-anchor="middle">uncertainty moves too</text>
<line class="d-line d-dash" x1="205" y1="160" x2="205" y2="188" marker-end="url(#af-a1)"/><text class="d-s" x="240" y="178" text-anchor="start">rejected</text><line class="d-line" x1="430" y1="160" x2="430" y2="188" marker-end="url(#af-a1)"/>
<path class="d-line" d="M520,215 L570,215 L570,45 L522,45" marker-end="url(#af-a1)"/><text class="d-s" x="562" y="178" text-anchor="end">feeds back</text>
</svg>
<figcaption>the filter loop. the gyro drives the prediction. each tracker reading is checked first: a bad one is ignored, a good one corrects attitude and bias, and the result feeds the next step.</figcaption>
</figure>

it's a multiplicative extended kalman filter. basically it tracks orientation as a quaternion (four numbers that describe a rotation), estimates the gyro bias next to it, and keeps an uncertainty over six numbers: three for rotation error and three for bias error. that way the four quaternion numbers are never treated as independent, because they aren't.

<figure class="diagram">
<svg viewBox="0 0 600 160" role="img" aria-label="a quaternion of four numbers next to an uncertainty over six numbers: three for rotation error and three for bias error">
<rect class="d-box" x="10" y="20" width="230" height="120" rx="4"/><text class="d-t" x="125" y="44" text-anchor="middle">quaternion</text><rect class="d-store" x="53" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="93" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="133" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="173" y="62" width="24" height="24" rx="3"/><text class="d-s" x="125" y="116" text-anchor="middle">4 numbers, not independent</text>
<rect class="d-box" x="270" y="20" width="320" height="120" rx="4"/><text class="d-t" x="430" y="44" text-anchor="middle">uncertainty over 6 numbers</text><rect class="d-store" x="304" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="338" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="372" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="464" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="498" y="62" width="24" height="24" rx="3"/><rect class="d-store" x="532" y="62" width="24" height="24" rx="3"/><text class="d-s" x="350" y="116" text-anchor="middle">rotation error</text><text class="d-s" x="510" y="116" text-anchor="middle">bias error</text><text class="d-t" x="430" y="80" text-anchor="middle">+</text>
</svg>
<figcaption>the filter holds orientation as 4 numbers but keeps its uncertainty over 6: 3 for rotation error and 3 for bias error.</figcaption>
</figure>

a few things usually go wrong in filters like this. here's how each one is handled:

- prediction steps forward with a block matrix exponential, which folds in the motion and the noise properly over each step. results don't depend on how often the gyro samples.
- each correction uses a factored solve and the joseph form instead of inverting a matrix, so the uncertainty stays symmetric and valid.
- after each correction, the uncertainty is moved into the new error frame. normalising the quaternion alone would leave it describing the old one.
- every update is built as a full candidate and checked before it replaces the stored state, so a bad reading can't leave the filter half-updated.

<figure class="diagram">
<svg viewBox="0 0 600 175" role="img" aria-label="a full candidate update is built, checked, and only then replaces the stored state; a failed check keeps the old state">
<defs><marker id="af-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="20" width="110" height="50" rx="4"/><text class="d-t" x="65.0" y="42" text-anchor="middle">stored state</text><text class="d-s" x="65.0" y="59" text-anchor="middle">as saved</text><rect class="d-box" x="145" y="20" width="170" height="50" rx="4"/><text class="d-t" x="230.0" y="42" text-anchor="middle">build candidate</text><text class="d-s" x="230.0" y="59" text-anchor="middle">a full updated copy</text><rect class="d-box" x="345" y="20" width="90" height="50" rx="4"/><text class="d-t" x="390.0" y="49.5" text-anchor="middle">check</text><rect class="d-box" x="465" y="20" width="125" height="50" rx="4"/><text class="d-t" x="527.5" y="42" text-anchor="middle">replace state</text><text class="d-s" x="527.5" y="59" text-anchor="middle">if it passes</text>
<line class="d-line" x1="120" y1="45" x2="143" y2="45" marker-end="url(#af-a2)"/><line class="d-line" x1="315" y1="45" x2="343" y2="45" marker-end="url(#af-a2)"/><line class="d-line" x1="435" y1="45" x2="463" y2="45" marker-end="url(#af-a2)"/>
<rect class="d-box" x="320" y="110" width="130" height="50" rx="4"/><text class="d-t" x="385.0" y="132" text-anchor="middle">keep old state</text><text class="d-s" x="385.0" y="149" text-anchor="middle">bad reading</text><line class="d-line d-dash" x1="390" y1="70" x2="390" y2="108" marker-end="url(#af-a2)"/>
</svg>
<figcaption>every update is built as a full candidate and checked first. only a candidate that passes replaces the stored state, so a bad reading can never leave it half-updated.</figcaption>
</figure>

the full derivation is in [filter.md](docs/filter.md).

## results

a 300 s run. the tracker goes dark from 80 s to 120 s, and a fake reading is injected at 150 s, which the filter rejects. with seed 42 the final error is 0.089°, against 18.57° for gyros alone. this is a controlled simulation, not flight data.

<figure class="diagram">
<svg viewBox="0 0 600 150" role="img" aria-label="the 300 second scenario: tracker available, outage from 80 to 120 seconds, false reading at 150 seconds rejected">
<defs><marker id="af-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-store" x="40" y="60" width="138.7" height="30" rx="4"/><text class="d-s" x="109.35" y="79" text-anchor="middle">tracker available</text><rect class="d-line d-dash" x="178.7" y="60" width="69.3" height="30" rx="4"/><text class="d-s" x="213.35" y="79" text-anchor="middle">outage</text><rect class="d-store" x="248.0" y="60" width="312.0" height="30" rx="4"/><text class="d-s" x="404.0" y="79" text-anchor="middle">tracker available</text>
<text class="d-s" x="300.0" y="32" text-anchor="middle">false reading, rejected</text><line class="d-line" x1="300.0" y1="38" x2="300.0" y2="58" marker-end="url(#af-a3)"/>
<line class="d-line" x1="40" y1="102" x2="560" y2="102"/>
<line class="d-line" x1="40.0" y1="98" x2="40.0" y2="106"/><text class="d-s" x="40.0" y="122" text-anchor="middle">0</text>
<line class="d-line" x1="178.7" y1="98" x2="178.7" y2="106"/><text class="d-s" x="178.7" y="122" text-anchor="middle">80</text>
<line class="d-line" x1="248.0" y1="98" x2="248.0" y2="106"/><text class="d-s" x="248.0" y="122" text-anchor="middle">120</text>
<line class="d-line" x1="300.0" y1="98" x2="300.0" y2="106"/><text class="d-s" x="300.0" y="122" text-anchor="middle">150</text>
<line class="d-line" x1="560.0" y1="98" x2="560.0" y2="106"/><text class="d-s" x="560.0" y="122" text-anchor="middle">300</text>
<text class="d-s" x="560" y="142" text-anchor="end">time (s)</text>
</svg>
<figcaption>the 300 s test scenario. the tracker drops out from 80 s to 120 s, and a fake reading at 150 s is rejected.</figcaption>
</figure>

<figure class="diagram">
<svg viewBox="0 0 600 230" role="img" aria-label="schematic of pointing error over time: gyros alone grow to 18.57 degrees while the filter stays near 0.089 degrees">
<line class="d-line" x1="60" y1="30" x2="60" y2="200"/><line class="d-line" x1="60" y1="200" x2="570" y2="200"/><text class="d-s" x="66" y="24" text-anchor="start">pointing error</text><text class="d-s" x="570" y="220" text-anchor="end">time</text><text class="d-s" x="52" y="204" text-anchor="end">0</text>
<path class="d-line" d="M60,200 L540,45"/><text class="d-s" x="530" y="36" text-anchor="end">gyros alone: 18.57°</text>
<path class="d-line d-dash" d="M60,200 C100,192 160,194 540,193"/><text class="d-s" x="540" y="178" text-anchor="end">filter: 0.089°</text>
</svg>
<figcaption>a schematic, not to scale and not real data points: bias adds up in gyros alone, while the filter learns it and stays near zero. only the end values, 18.57° and 0.089°, come from the test run.</figcaption>
</figure>

![Tracker outage experiment](docs/tracker-outage.png)

## testing

the [tests](tests/test_filter.cpp) compare the filter's derivatives against finite differences, check the noise handling against a closed-form answer, and run 24 seeded scenarios covering bias estimation, outages, false readings, quaternion sign flips, and whether the uncertainty stays symmetric and valid.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
ctest --test-dir build --output-on-failure
./build/attitude-demo 42 > trace.csv
```

## limits

it needs eigen and a reasonable starting orientation. it doesn't model starting from no idea of orientation, clock offsets, a misaligned tracker or non-gaussian noise. the method follows markley and bauer, [attitude error representations for kalman filtering](https://ntrs.nasa.gov/citations/20020060647).
