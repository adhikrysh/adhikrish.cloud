# people

one row per person. companies and events are what people link to.

- search first (`GET /api/people?q=<name>`) and update the person who's there.
- set `group` to the topic they belong to, reusing one already in use when it fits. set `last_contact` to today when he says he talked to them.
- four links, written as names: `company` (a row in companies), `met_where` (a row in events: where they met), `referred_by` (a person), `knows` (a list of people). write a name exactly as it's already spelled (search companies, events and people first); a new name creates that row with just its name.
- whenever he mentions who introduced or knows whom, or where they met, add the link.
- links rules: names match whatever the case; a tab that's linked to refuses a second row with the same title (`409`, naming the row to patch); renaming a row rewrites every link to it; deleting a row that's linked to is refused until the links go.
- `GET /api/people/_views` is the whole graph: `nodes` and `edges`. read it for "who do i know at X" or "who could introduce me to Y".
- companies: `name`, `about`, `url`, `notes`. events: `name`, `date`, `place`, `notes`. fill them in when you learn more.
