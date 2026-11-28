# training

one row per session, from adhi and from his watch.

## logging a session

- write `at` (the start, with time and offset: `2026-11-18T18:00-08:00`; a date alone is refused), `type` (strength, run, hike, climb, swim, ride, sport, other), `title`, `focus`, `lifts`, `rpe` (1-10), `notes`. ask him the start time if you don't know it.
- reuse an exercise's existing name (look at recent rows) so its history stays one line. a new exercise needs nothing special.
- the hourly garmin sync brings in every activity the watch records and merges it with yours: same day, starts within 2 hours, one session. so log a session the way he tells it even if the watch has it. when it does, the answer says `"merged": "garmin"`; don't post it again.
- garmin owns what the watch measures (`at`, `duration_min`, `distance_km`, `avg_hr`, `training_load`, zones, splits, `garmin_id`...). you own `focus`, `lifts`, `rpe`, `notes`; `type` and `title` too, though garmin fills them when you haven't. never write garmin's fields.
- a weigh-in goes in `body` (`at`, `bodyweight_kg`, `bodyfat_percentage`), never in a session. garmin's scale merges with yours by day; its numbers win.

## coaching

before you suggest a workout, follow the fitness-coach skill (`GET /api/_skills/fitness-coach`).
