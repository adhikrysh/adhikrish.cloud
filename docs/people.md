# people: links between rows, and the graph they draw

how does "ada works at acme, i met her at space week, ben introduced us" become a graph on `seniorintern.adhikrish.cloud/people` that any agent can read and write, without anyone handling ids?

**the short answer.** a field of type `ref` holds the title of a row in another tab: a person's `company` is "Acme", the name of a row in companies. the api matches the name to its row (ignoring case), creates the row if there is none, and stores the row's own spelling. the graph view walks every ref from people into companies, events and people, and returns the rows as nodes and the refs as edges. the page draws that json, and `GET /api/people/_views` returns the same json to agents. code: [`src/refs.ts`](../private/snrintern/src/refs.ts) (the rules and the graph), [`src/graph.ts`](../private/snrintern/src/graph.ts) (the drawing).

## the objects

- **a ref field.** a field with `type: "ref"` and `to: "<tab>"`. its value is a title in that tab. `many: true` makes it a list. people has four: `company` (to companies), `met_where` (to events), `referred_by` (to people) and `knows` (to people, many).
- **a title.** the field a tab names as `title` (`name` for people, companies and events). it's what a ref holds.
- **a target tab.** a tab some ref points into. companies, events and people are all targets (people of itself).
- **a node.** one row of a tab the graph reaches: `{ id: "people/12", tab, row, label, data }`. `data` is the row's shown fields.
- **an edge.** one name in one ref field that matches a row: `{ from: "people/12", to: "companies/3", field: "company" }`.

## one write, traced

```text
the agent: POST /api/people
  { name: "Gil", company: "acme", met_where: "Space Week",
    knows: ["Ada", "Hal", "gil"] }
  │
  ├─► checkRow: types are right (a string, a list of strings)
  │
  ├─► resolve (src/refs.ts)
  │     people is a target, so "Gil" must be a free title ✓
  │     "acme"       matches companies' "Acme"  → "Acme"
  │     "Space Week" matches events' "space week" → "space week"
  │     "Ada"        matches people's "Ada"
  │     "Hal"        no row: insert people { name: "Hal" }
  │     "gil"        is this row itself: dropped
  │
  └─► insert { company: "Acme", met_where: "space week",
               knows: ["Ada", "Hal"] }    → 201

later: GET /people (or GET /api/people/_views)
  graph: people → companies, events (and people)
  nodes: every row of the three tabs
  edges: Gil→Acme, Gil→space week, Gil→Ada, Gil→Hal, ...
```

every check runs before anything is created, so a refused write (a name matching two rows, a new target that needs more than its title) leaves no stray rows.

## renames and deletes

- **a rename** (`PATCH /api/companies/3 { name: "Acme Space" }`) rewrites every ref holding "Acme", in single fields and inside lists, in one batch.
- **a delete** of a row something links to is refused with what links to it (`people.company (2 rows)`). unlink those rows, then delete.

## the page

the graph sits above the list, which stays as it was (groups, search), on the page's own black. it's cytoscape.js with the fcose layout, served by the worker at `/_graph-<versions>.js` like the chart library. fcose packs many small parts (most people are a person and their company) into one round cluster, and spaces nodes by the size of their labels, so no two names overlap. each tab gets a shape (people bright circles, companies grey squares, events grey diamonds). labels have a fixed size in the graph, so they grow and shrink with the zoom and hide when they'd be too small to read.

hovering a node lights up what it links to and fades the rest (the way obsidian's graph does). a click holds that and shows, under the graph, the node's fields, a link to its row and what it links to; clicking a linked name jumps there. drag a node to move it, drag the background to pan, and zoom with the wheel or a pinch, like the charts. where you dragged things isn't saved: every load lays the graph out again.

## misconceptions we hit

**wrong:** company and event are just text on a person, so the graph can group people by matching strings. **why it fails:** "Acme", "acme" and "Acme Inc" are three companies to a string match, and a company has nowhere to keep its own notes. **instead:** a company is a row, and a ref names it; the api folds case and stores one spelling.

**wrong:** links should store ids, like a database foreign key. **why it fails:** every agent would have to look up an id before each write and turn ids back into names to read a row, and agents get that wrong. **instead:** links store titles, kept honest by unique titles, renames that follow, and deletes that wait for links to go (the way a wiki links by page name).

**wrong:** the graph is a separate store the agents must keep in sync. **why it fails:** two copies drift. **instead:** the graph is computed from the rows whenever it's asked for; writing a person is writing the graph.

## predict what happens

1. **the agent writes `company: "ACME"` for a new person.** the person links to the existing "Acme"; no new company.
2. **the agent creates a company "acme" directly.** `409`: companies already has "Acme", patch that row instead.
3. **two rows share a title (written before titles had to be unique), and the agent links to it.** `409`: rename one first. nothing is created.
4. **you rename ada to "ada lovelace".** gil's `knows` now reads "ada lovelace"; the graph's edge stays.
5. **a typo, `company: "Acmee"`.** a new company "Acmee" and a second node. the api can't tell a typo from a new company; merge by fixing the person and deleting "Acmee".

## invariants

- in a target tab, no two rows share a title, ignoring case (enforced on every write through the api).
- a ref holds the exact title of an existing row, except a row that was deleted outside the api.
- the graph has one edge per name per ref field that matches a row, and never an edge from a row to itself.

## changing it safely

- **a new link:** add a `ref` field to the definition (`PUT /api/_tabs/people`, and `test/fixtures/tabs.json`); the graph picks it up. its `to` tab must exist first.
- **a new kind of node:** a new tab (hidden or not) with a title, and a ref pointing into it. it gets the next shape.
- **turning a text field into a ref:** change its type, then patch each row with its own value, so the api creates the targets and folds case.

## open questions

- the page's phone layout is untested on a real phone; dragging on a touch screen may also scroll the page.
- a large graph (hundreds of nodes) hasn't been tried; fcose lays it out in the browser on every load.
