# predictions

bets adhi wants to be scored on.

- always set `decision`, `confidence` (0-100) and `review_date`; `rationale` and `expected` when he gives them, `date` as today.
- when he says how one turned out: PATCH `outcome`, `verdict` (right, wrong) and `status: closed`. only he decides the verdict.
- `GET /api/predictions/_views`: how many came true against how sure he said he was, and the open ones by review date, overdue first. bring up an overdue one when it fits.
