# health

one row per day, written by the hourly garmin sync. read it; never write it.

- `GET /api/health/_views` judges each metric's newest day with garmin's own verdict where garmin has one (sleep score label, hrv status, its body battery and stress bands, its step and intensity goals) and his own history otherwise. use those words when you talk about it; don't make up your own scale.
- fields ending in `_feedback`, `_insight` or `_qualifier` are garmin's verdicts as words.
- a day's heart rate every 2 minutes, overnight hrv and body battery: `GET /api/health/<id>/series` (garmin keeps these about 4 months).
- weight is in `body`, not here.
- before suggesting training, follow the fitness-coach skill (`GET /api/_skills/fitness-coach`).
