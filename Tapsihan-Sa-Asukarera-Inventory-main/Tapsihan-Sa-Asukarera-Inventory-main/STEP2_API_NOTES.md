# Step 2: per-record endpoints (restocks, waste, stock counts)

Files changed/added (same folder layout as Bago.zip):
- includes/ledger.php (new, shared rules)
- Restock/restocks.php
- Waste_spoilage/waste_spoilage.php
- Stockcount/stock-counts.php
(includes/bootstrap.php is the step 1 file.)

All writes need either the website session + X-CSRF-Token, or `Authorization: Bearer <token>`.
Errors are always `{"ok": false, "error": "..."}`. Status codes: 422 bad input, 404 not found, 409 conflict (shift closed / locked entry), 403 replace-all blocked for tokens.

## Restocks  (Restock/restocks.php)
| Call | Body | Notes |
|---|---|---|
| GET `?shiftId=SHIFT-CODE` | | list (filter optional) |
| POST | `{"restock":{"itemId":"ITM-001","quantity":20,"supplier":"..."}}` | attaches to the open shift if there is one; stock +quantity |
| PUT `?id=RESTOCK-12` | `{"restock":{"quantity":25}}` (itemId, quantity, supplier all optional) | refused if its shift has ended |
| DELETE `?id=RESTOCK-12` | | stock -quantity (not below 0); refused if shift ended |

## Waste  (Waste_spoilage/waste_spoilage.php)
| Call | Body | Notes |
|---|---|---|
| GET `?shiftId=...` | | |
| POST | `{"waste":{"itemId":"ITM-003","quantity":2,"reason":"Expired"}}` | needs an open shift; quantity cannot exceed stock; stock -quantity |
| PUT `?id=WASTE-4` | `{"waste":{"quantity":3}}` | stock re-balanced; refused if shift ended |
| DELETE `?id=WASTE-4` | | stock restored; refused if shift ended |

## Stock counts  (Stockcount/stock-counts.php)
| Call | Body | Notes |
|---|---|---|
| GET `?shiftId=...` | | |
| POST or PUT | `{"stockCount":{"itemId":"ITM-001","closing":12}}` | create or update (one record per shift + item); `opening` optional |
| POST or PUT | `{"counts":[{"itemId":"..","closing":5},{"itemId":"..","closing":9}]}` | several at once, all or nothing |
| DELETE `?shiftId=SHIFT-CODE&itemId=ITM-001` | | open shift only; item stock set back to opening + restocks - waste |

Server calculates: restock total, waste total, consumed = opening + restocks - waste - closing, and sets item stock = closing.
Optional `"shiftId"` in a body = "the shift my app thinks is open"; if it is no longer open the request gets 409.

Responses include the saved record plus `itemStock` (the item's new stock level).

## Test checklist (XAMPP)
Set TOKEN from a mobile login (`"client":"mobile"`), and use item/shift codes from your database.
1. Start a shift on the website (open shift needed for waste and counts).
2. POST a restock with the Bearer token and no CSRF header. Expect 201, `itemStock` up by the quantity; check Audit Log shows "Restock Added".
3. PUT that restock to a new quantity. Expect `itemStock` to change by the difference.
4. POST waste larger than stock. Expect 422. POST a valid one. Expect 201 and stock down.
5. POST a stock count with `closing` higher than opening + restocks - waste. Expect 422. Then a valid one. Expect `consumed` in the response.
6. DELETE the waste, then the restock. Stock should return to where it started.
7. End the shift on the website, then try PUT/DELETE on a record from it. Expect 409.
8. POST `{"restocks":[]}` with the token. Expect 403. The website's own saves still work.
