# notes

each coach's memory, one row per thing worth remembering: `at` (when it was written or last changed, with time and offset), `coach` (which coach, in words, like the heading of its skill), `note`.

- add a note for something lasting; edit the note when it changes (`PATCH`); remove it when it's no longer true or useful (`DELETE`). one thing, one note.
- a coach's notes together are capped at about a thousand words. `GET /api/notes` and every write return `memory`: how many words each coach uses of its cap. a write past the cap is refused with what to do.
- adhi reads them on the coach's page.
