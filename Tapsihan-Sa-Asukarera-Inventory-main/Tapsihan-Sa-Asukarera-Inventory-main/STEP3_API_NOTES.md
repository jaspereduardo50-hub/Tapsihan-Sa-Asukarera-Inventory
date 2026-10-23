# Step 3: shift start/end and per-item inventory

Files changed (same folder layout as the project zip):
- includes/ledger.php        (added two small lock helpers at the bottom; nothing else changed)
- Shift/shift.php            (new ?action=start / ?action=end, GET ?current=1; old save kept for the website)
- api/inventory.php          (per-item create / update / archive / restore; GET unchanged; old save kept for the website)

Auth is the same as Step 2: website session + X-CSRF-Token, or `Authorization: Bearer <token>`.
Errors are `{"ok": false, "error": "..."}`. 422 bad input, 404 not found, 409 conflict, 403 old replace-all blocked for tokens, 503 server busy.
Item codes are `RM-###` (the Step 2 notes show `ITM-001` as an example; use `RM-001` style codes).

## Shifts  (Shift/shift.php)
| Call | Body | Notes |
|---|---|---|
| GET | | all shifts, newest first, each with `openingStocks` {itemCode: qty} |
| GET `?current=1` | | `{"shift": {...}}` for the open shift, or `{"shift": null}` |
| POST `?action=start` | none (or `{}`) | 201. 409 if a shift is already open. Server sets code, date, start time (Manila) and opening stock = every active item's current stock |
| POST `?action=end` | optional `{"shiftId": "SHIFT-..."}` | 409 if no open shift or the id is not the open one. See the three checks below |

End shift refuses (422) unless:
1. every active item has a saved closing count for this shift (response lists `missingCounts`);
2. those counts still match the shift's restocks and waste (response lists `staleCounts`; save those counts again);
3. a reconciliation was saved for the shift (`needsReconciliation: true`).
Then it closes the shift with the server's clock, writes "Shift Ended" to the audit log, and returns the shift plus the reconciliation totals.

Check 2 is new: the website never checked it. It stops a restock or waste entry edited after counting from leaving a wrong "consumed" figure.

`POST {"shifts": [...]}` (old save) now returns 403 for tokens. For the website it also refuses to reopen a shift that was already ended, or to create a second open shift.

## Inventory  (api/inventory.php)
| Call | Body | Notes |
|---|---|---|
| GET | | `{"items": [...], "archived": [...]}` (same as before) |
| GET `?id=RM-001` | | `{"item": {...}}`, active or archived |
| POST | `{"item": {"name":"Rice","category":"Dry goods","unit":"kg","minimum":5,"stock":0,"suppliers":[{"name":"..","contact":".."},null,null]}}` | 201. Server assigns the code. `stock` is the starting quantity only (default 0). `category`, `unit`, `stock`, `suppliers` optional |
| PUT `?id=RM-001` | `{"item": {"name":"..","minimum":8}}` | any of name, category, unit, minimum, suppliers. Sending `stock` gives 422. Archived items give 409 |
| POST `?id=RM-001&action=archive` | optional `{"reason":"..."}` | never deletes; history stays valid |
| POST `?id=RM-001&action=restore` | | 409 if an active item already has the same name |

Rules match the website: name required (max 100) and unique among active items (ignoring upper/lower case), minimum a whole number of at least 1, category max 50, unit max 30.
An item created or restored while a shift is open gets its opening stock fixed at that moment, so later restocks are not counted as opening stock.
`POST {"items": [...]}` (old save-everything, including stock) returns 403 for tokens.

## Known limits (not changed in this step)
- The website still uses the old replace-all saves for inventory, restocks, waste, stock counts and shifts, and the Shift page reads only the browser copy. A shift started on a phone will not appear there, and a stale website save can still overwrite items or stock the phone changed. Moving the website to these calls is step 6.
- No role rules yet (step 5): any logged-in user can call every endpoint above.
- Catalog edits are last-write-wins on name/category/unit/minimum. Stock is safe because it is never written from here.

## Test checklist (XAMPP)
Use a mobile login token (`"client":"mobile"`). Nothing here has been run; PHP was not available when this was written.
1. POST `?action=end` with no open shift. Expect 409.
2. POST `?action=start`. Expect 201; `openingStocks` matches the Inventory page stock for every active item. Check phpMyAdmin: one row in `shifts` (OPEN), one `shift_opening_stocks` row per active item; Audit Log shows "Shift Started".
3. POST `?action=start` again. Expect 409.
4. POST `{"item": {...}}` with a new name and minimum 5. Expect 201 and the next RM-### code. Repeat the same name. Expect 409. Send `minimum: 0`. Expect 422.
5. PUT that item with `{"item": {"stock": 99}}`. Expect 422. PUT `{"item": {"minimum": 8}}`. Expect 200, stock unchanged.
6. Restock the new item (Step 2 endpoint), then POST `?action=end`. Expect 422 with `missingCounts` listing the items without counts.
7. Save closing counts for all items (batch call), POST `?action=end`. Expect 422 with `needsReconciliation` until a reconciliation exists for the shift.
8. Save the reconciliation, then edit a restock quantity from this shift, then end. Expect 422 with `staleCounts`; re-save that count; end again. Expect 200, shift CLOSED, end time correct for Manila, Audit Log shows "Shift Ended" with the revenue figures.
9. After the shift ends, PUT/DELETE a restock from it. Expect 409 (Step 2 rule still holds).
10. Archive the new item, GET it (`archivedAt` set), PUT it (409), restore it, archive then create another item with the same name and restore the first (409).
11. POST `{"items": []}` to inventory.php and `{"shifts": []}` to shift.php with the token. Expect 403 for both. The website's own saves still work.
12. Website check: open the Shift page with a stale browser copy while a phone shift is open and start a new one there. Expect the 409 "Another shift is already open".
