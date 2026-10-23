# Step 4: roles, reconciliation preview, no more browser uploads

Changed files (same layout as the project zip):
includes/bootstrap.php, api/auth/login.php, api/auth/me.php, api/audit.php, api/reports.php, api/inventory.php,
History/history.php, Portionmapping/portionmapping.php, Reconciliation/reconciliation.php,
Inventory/inventory.html, Inventory/inventory.js, Dashboard/dashboard.js, Stockcount/stock-counts.js, Reconciliation/reconciliation.js

## 1. Role rules (server side)
The table is `ROLE_PAGES` in includes/bootstrap.php. It is a copy of the website's own menu rules, so nothing is stricter than before, but a phone or hand-made request can no longer reach what the website hides.

| Role | Can use |
|---|---|
| owner | everything |
| manager | everything except the Audit Log |
| staff | dashboard, inventory, shift, stock counts, restock, waste, suppliers, reconciliation |

Enforced on:
| Endpoint | Rule |
|---|---|
| api/reports.php (and exports) | owner, manager |
| History/history.php | owner, manager |
| api/audit.php GET (list, ?check) | owner only. POST (adding an entry) stays open to every role |
| Portionmapping/portionmapping.php POST (add, edit, delete) | owner, manager. GET stays open to every role (Reconciliation needs it) |
Everything else is open to every logged-in role, as on the website.

A refused request is `403 {"ok": false, "code": "role_forbidden", "error": "..."}`.
Login and `api/auth/me` now also return `user.pages`, the list of pages that role may use, so the app can hide screens without hard-coding roles.
To change who may do what, edit `ROLE_PAGES` (and the matching `roleAccess` list at the top of Dashboard/dashboard.js, which only hides menu items).

## 2. Reconciliation preview (read only)
`GET Reconciliation/reconciliation.php?action=preview`
Optional: `&shiftId=SHIFT-...` (default: the open shift; 409 if none is open), `&actualCash=1200&actualGcash=800`.

```json
{"ok": true, "preview": {
  "shiftId": "SHIFT-...", "date": "2026-10-23", "shiftStatus": "OPEN",
  "expectedRevenue": 4350.0, "dishVolume": 29,
  "breakdown": [{"dishName": "...", "sellingPrice": 150.0, "ingredient": "...", "ingredientConsumed": 3.0,
                 "usedPerOrder": 0.1, "estimatedPortions": 29, "estimatedRevenue": 4350.0}],
  "missingCounts": [], "alreadyReconciled": false,
  "canSave": true, "problems": [],
  "collection": {"actualCash": 1200.0, "actualGcash": 800.0, "totalCollected": 2000.0, "variance": -2350.0, "status": "SHORTAGE"}
}}
```
`collection` appears only when both amounts are sent. It saves nothing and writes no audit entry.
The expected revenue uses the same calculation as the save, so the preview and the saved record always agree.
When `canSave` is false, `problems` says why (closing counts missing, no portion mappings, already reconciled).
The save is unchanged: `POST {"records": [{"shiftId": "SHIFT-...", "actualCash": 1200, "actualGcash": 800}]}`.

## 3. Inventory page: no more uploads
- The Inventory page now adds, edits and archives one item at a time (the api/inventory.php per-item calls). The old save-the-whole-catalog request is gone: it answers `410`.
- The page no longer seeds an empty database from the browser.
- The server writes the audit entries for these actions, so the page no longer adds its own (no duplicates).
- Behaviour changes: "Current Stock" in the Edit window is read-only (stock changes through Restock, Waste and Stock Count); the Archive popup about movement history is gone (the server records it in the audit entry).

## 4. Stock Counts, Reconciliation, Dashboard read the server
`refreshSharedDataFromServer()` (Dashboard/dashboard.js) loads the shift, stock levels, restocks, waste and stock counts (and portion mappings for Reconciliation) from MySQL when each of the three pages opens. A shift started on a phone shows straight away.

## Test checklist (XAMPP)
Nothing here has been run; PHP was not available when this was written. The JavaScript passed `node --check`.
1. Log in as staff. GET api/reports.php, History/history.php, api/audit.php: all 403 with `code: role_forbidden`. POST to Portionmapping/portionmapping.php: 403. GET Portionmapping/portionmapping.php: 200.
2. Log in as manager: reports and history work, api/audit.php is 403. As owner: everything works.
3. Log in with `"client":"mobile"`: the response has `user.pages`.
4. Start a shift (phone or Shift page), add a restock, then open the Reconciliation page as staff. GET `...reconciliation.php?action=preview`: `canSave: false` with `missingCounts` listed. Save counts for the mapped items: `canSave: true` and `expectedRevenue` filled. Add `&actualCash=...&actualGcash=...` and check the variance.
5. Save the reconciliation, then preview again: `alreadyReconciled: true`, `canSave: false`.
6. Inventory page: add an item, edit its name and minimum, archive it. phpMyAdmin shows the change, and Audit Log shows one entry per action (not two).
7. Inventory page in a browser with old test data and an empty database: nothing is uploaded.
8. POST `{"items": []}` to api/inventory.php: 410.
9. Start a shift from the phone, then open the Stock Counts, Reconciliation and Dashboard pages in a browser that has not visited Shift/Restock/Waste: the shift appears without visiting them.
