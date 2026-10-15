STEP 2 - PHP foundation + secure login

1. Copy everything in this zip into your project root (next to Login/, Dashboard/, Inventory/ ...).
   Say yes to overwrite Login/login.js and Dashboard/dashboard.js.
2. Edit config/config.php: database name/user/password and a long random setup_key.
3. Open http://localhost/<your-folder>/setup/create_accounts.php?key=<your setup_key>
   and choose the Owner and Staff passwords.
4. Delete the setup folder.
5. Open http://localhost/<your-folder>/Login/login.html and log in.


SUPPLIER ASSIGNMENTS PATCH
- Supplier/suppliers.php now reads and saves supplier assignments directly in MySQL.
- Supplier actions only update the browser copy after the database save succeeds.
- If saving fails, the Supplier page displays the server error and does not add a success audit entry.
