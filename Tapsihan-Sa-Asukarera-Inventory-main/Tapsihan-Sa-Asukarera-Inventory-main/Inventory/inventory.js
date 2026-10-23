// ============================================================
// INVENTORY PAGE
// ============================================================

// ============================================================
// DATABASE CONNECTION
// MySQL is the source of truth for the Inventory Catalog.
// ============================================================

/* Every change is sent to the server one item at a time (add / edit / archive).
   The browser never uploads its own copy of the catalog, so test data left in a browser
   can no longer reach the database, and a stale tab cannot overwrite stock. */

async function loadInventoryFromServer() {
    try {
        let response = await fetch("../api/inventory.php", {
            credentials: "same-origin",
            cache: "no-store"
        });

        let data = await response.json().catch(function() { return null; });

        if (!response.ok || !data || !data.ok) {
            throw new Error(data && data.error ? data.error : "Unable to load inventory from MySQL.");
        }

        inventory = (Array.isArray(data.items) ? data.items : []).map(normalizeInventoryItem);
        archivedInventory = Array.isArray(data.archived) ? data.archived : [];

        // Browser copy is only a cache for quick page loads. It is never uploaded.
        saveInventory();

        return true;
    } catch (error) {
        console.error("Inventory database load failed:", error);
        alert("The Inventory Catalog could not connect to MySQL. The list shown may be out of date and changes cannot be saved until the connection is back. Check that Apache and MySQL are running and that the project is opened through localhost.");
        return false;
    }
}


// Inventory summary
function updateInventorySummary() {
    let total = inventory.length;

    let lowStock = inventory.filter(function(item) {
        return item.stock < item.minimum;
    }).length;

    let totalEl = document.getElementById("inventoryTotalItems");
    let lowEl = document.getElementById("inventoryLowStock");

    if (totalEl) {
        totalEl.textContent = total;
    }

    if (lowEl) {
        lowEl.textContent = lowStock;
    }
}


// Display inventory table
function displayInventory() {
    let searchEl = document.getElementById("searchInventory");
    let table = document.getElementById("inventoryTable");

    if (!table || !searchEl) return;

    let search = searchEl.value.trim().toLowerCase();

    let categoryEl = document.getElementById("categoryFilter");
    let statusEl = document.getElementById("statusFilter");

    let category = categoryEl ? categoryEl.value : "";
    let status = statusEl ? statusEl.value : "";

    table.innerHTML = "";

    let filtered = inventory.filter(function(item) {

        let searchMatch =
            item.name.toLowerCase().includes(search) ||
            item.id.toLowerCase().includes(search);

        let categoryMatch =
            category === "" ||
            item.category === category;

        let low = item.stock < item.minimum;

        let statusMatch = true;

        if (status === "low") {
            statusMatch = low;
        }

        if (status === "ok") {
            statusMatch = !low;
        }

        return searchMatch &&
               categoryMatch &&
               statusMatch;
    });

    // No results
    if (!filtered.length) {

        table.innerHTML = `
            <tr>
                <td colspan="9"
                    class="text-center text-muted py-4">
                    No raw materials found
                </td>
            </tr>
        `;

        updateInventorySummary();
        return;
    }


    // Display filtered inventory
    filtered.forEach(function(item) {

        let low = item.stock < item.minimum;

        let row = document.createElement("tr");

        let displayId = item.id;

        let supplierDisplay = "<span class=\"text-muted\">Not assigned</span>";

        if (
            Array.isArray(item.suppliers) &&
            item.suppliers.some(Boolean)
        ) {

            supplierDisplay = item.suppliers
                .filter(Boolean)
                .map(function(supplier) {

                    return `
                        ${escapeHtml(supplier.name)}
                        ${
                            supplier.contact
                                ? `<br><small>${escapeHtml(supplier.contact)}</small>`
                                : ""
                        }
                    `;

                })
                .join('<hr class="my-1">');
        }


        row.innerHTML = `
            <td>
                ${escapeHtml(displayId)}
            </td>

            <td>
                ${escapeHtml(item.name)}
            </td>

            <td>
                ${escapeHtml(item.category)}
            </td>

            <td>
                ${escapeHtml(item.unit)}
            </td>

            <td>
                ${item.stock}
            </td>

            <td>
                ${item.minimum}
            </td>

            <td>
                <span class="badge ${low ? "bg-danger" : "bg-success"}">
                    ${low ? "LOW STOCK" : "IN STOCK"}
                </span>
            </td>

            <td>
                ${supplierDisplay}
            </td>

            <td>
                <button
                    class="btn btn-sm btn-outline-primary me-2"
                    onclick="openEditItemModal('${item.id}')">
                    Edit
                </button>

                <button
                    class="btn btn-sm btn-outline-danger"
                    onclick="deleteItem('${item.id}')">
                    Archive
                </button>
            </td>
        `;

        table.appendChild(row);
    });


    updateInventorySummary();
    updateDashboard();
}


// ============================================================
// SEARCH & FILTER
// ============================================================

let searchInventory =
    document.getElementById("searchInventory");

if (searchInventory) {

    searchInventory.addEventListener(
        "input",
        displayInventory
    );
}


let categoryFilter =
    document.getElementById("categoryFilter");

if (categoryFilter) {

    categoryFilter.addEventListener(
        "change",
        displayInventory
    );
}


let statusFilter =
    document.getElementById("statusFilter");

if (statusFilter) {

    statusFilter.addEventListener(
        "change",
        displayInventory
    );
}


// ============================================================
// EDIT INVENTORY ITEM
// ============================================================

function openEditItemModal(id) {

    let item = inventory.find(function(entry) {
        return entry.id === id;
    });

    if (!item) return;


    document.getElementById("editItemId").value =
        item.id;

    document.getElementById("editItemName").value =
        item.name;

    document.getElementById("editItemCategory").value =
        item.category;

    document.getElementById("editItemUnit").value =
        item.unit;

    document.getElementById("editItemStock").value =
        item.stock;

    document.getElementById("editItemMinimum").value =
        item.minimum;


    let modalEl =
        document.getElementById("editItemModal");

    if (modalEl) {

        new bootstrap.Modal(modalEl).show();
    }
}


// Edit form
let editItemForm =
    document.getElementById("editItemForm");

if (editItemForm) {

    editItemForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            let id =
                document.getElementById("editItemId").value;

            let item = inventory.find(function(entry) {
                return entry.id === id;
            });

            if (!item) return;

            let name =
                document.getElementById("editItemName")
                .value
                .trim();

            let minimum =
                Number(
                    document.getElementById("editItemMinimum")
                    .value
                );

            let duplicate =
                inventory.some(function(entry) {

                    return (
                        entry.id !== id &&
                        entry.name.toLowerCase() ===
                        name.toLowerCase()
                    );

                });

            if (
                !name ||
                !Number.isInteger(minimum) ||
                minimum < 1 ||
                duplicate
            ) {

                alert(
                    duplicate
                        ? "An item with this name already exists."
                        : "Enter a valid name and minimum stock."
                );

                return;
            }

            // Stock is not sent: it only changes through restocks, waste and stock counts.
            // The server writes the audit entry.
            try {
                await ledgerRequest(
                    "../api/inventory.php?id=" + encodeURIComponent(id),
                    "PUT",
                    {
                        item: {
                            name: name,
                            category: document.getElementById("editItemCategory").value,
                            unit: document.getElementById("editItemUnit").value,
                            minimum: minimum
                        }
                    }
                );
            } catch (error) {
                alert("The change was not saved. " + error.message);
                return;
            }

            await loadInventoryFromServer();

            displayInventory();

            populateItemSelects();

            let modalEl =
                document.getElementById("editItemModal");

            if (modalEl) {

                bootstrap.Modal
                    .getInstance(modalEl)
                    ?.hide();
            }

            this.reset();

            alert("Raw material updated successfully!");
        }
    );
}


// ============================================================
// ARCHIVE INVENTORY ITEM
// Items are never deleted, so old records stay valid.
// ============================================================

async function deleteItem(id) {

    let answer =
        confirm(
            "Are you sure you want to archive this item?"
        );

    if (!answer) return;

    let targetItem =
        inventory.find(function(item) {
            return item.id === id;
        });

    if (!targetItem) return;

    try {
        await ledgerRequest(
            "../api/inventory.php?id=" + encodeURIComponent(id) + "&action=archive",
            "POST",
            {}
        );
    } catch (error) {
        alert("The item was not archived. " + error.message);
        return;
    }

    await loadInventoryFromServer();

    populateItemSelects();
    displayInventory();
}


// ============================================================
// ADD INVENTORY ITEM
// ============================================================

let itemForm =
    document.getElementById("itemForm");

if (itemForm) {

    itemForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            let name =
                document.getElementById("itemName")
                .value
                .trim();

            let category =
                document.getElementById("itemCategory")
                .value;

            let unit =
                document.getElementById("itemUnit")
                .value;

            let minimum =
                Number(
                    document.getElementById("itemMinimum")
                    .value
                );

            let duplicate =
                inventory.some(function(item) {

                    return (
                        item.name.toLowerCase() ===
                        name.toLowerCase()
                    );

                });

            if (
                !name ||
                !Number.isInteger(minimum) ||
                minimum < 1 ||
                duplicate
            ) {

                alert(
                    duplicate
                        ? "An item with this name already exists."
                        : "Enter a valid item name and minimum stock."
                );

                return;
            }

            // The server assigns the next RM-### code and writes the audit entry.
            try {
                await ledgerRequest(
                    "../api/inventory.php",
                    "POST",
                    {
                        item: {
                            name: name,
                            category: category,
                            unit: unit,
                            minimum: minimum
                        }
                    }
                );
            } catch (error) {
                alert("The item was not added. " + error.message);
                return;
            }

            await loadInventoryFromServer();

            displayInventory();

            populateItemSelects();

            let modalEl =
                document.getElementById("addItemModal");

            if (modalEl) {

                bootstrap.Modal
                    .getInstance(modalEl)
                    ?.hide();
            }

            this.reset();

            alert("Raw material added successfully!");
        }
    );
}


// ============================================================
// INITIAL DISPLAY
// ============================================================

if (document.getElementById("inventoryTable")) {
    loadInventoryFromServer().then(function() {
        displayInventory();
        populateItemSelects();
        updateDashboard();
    });
}