// ============================================================
// INVENTORY PAGE
// ============================================================

// ============================================================
// DATABASE CONNECTION
// MySQL is the source of truth for the Inventory Catalog.
// ============================================================

async function getInventoryCsrfToken() {
    let token = sessionStorage.getItem("csrfToken") || "";

    if (token) {
        return token;
    }

    let response = await fetch("../api/auth/me.php", {
        credentials: "same-origin",
        cache: "no-store"
    });

    let data = await response.json().catch(function() { return null; });

    if (!response.ok || !data || !data.ok || !data.csrf) {
        throw new Error("Your server session has expired. Please log in again.");
    }

    sessionStorage.setItem("csrfToken", data.csrf);
    return data.csrf;
}

async function syncInventoryToServer() {
    let token = await getInventoryCsrfToken();

    let response = await fetch("../api/inventory.php", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token
        },
        body: JSON.stringify({
            items: inventory,
            archived: archivedInventory
        })
    });

    let data = await response.json().catch(function() { return null; });

    if (!response.ok || !data || !data.ok) {
        throw new Error(data && data.error ? data.error : "Unable to save inventory to MySQL.");
    }

    return true;
}

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

        // If the database is empty, preserve the existing browser inventory
        // and seed the database from it once.
        if (!data.items.length && inventory.length) {
            await syncInventoryToServer();
        } else {
            inventory = Array.isArray(data.items) ? data.items : [];
            archivedInventory = Array.isArray(data.archived) ? data.archived : [];

            localStorage.setItem("tapsihanInventory", JSON.stringify(inventory));
            localStorage.setItem("tapsihanArchivedInventory", JSON.stringify(archivedInventory));
        }

        return true;
    } catch (error) {
        console.error("Inventory database load failed:", error);
        alert("The Inventory Catalog could not connect to MySQL. The page will continue using the saved browser data. Check that Apache and MySQL are running and that the project is opened through localhost.");
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


            let stock =
                Number(
                    document.getElementById("editItemStock")
                    .value
                );


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
                !Number.isInteger(stock) ||
                stock < 0 ||
                !Number.isInteger(minimum) ||
                minimum < 1 ||
                duplicate
            ) {

                alert(
                    duplicate
                        ? "An item with this name already exists."
                        : "Enter a valid name, stock value, and minimum stock."
                );

                return;
            }


            item.name = name;

            item.category =
                document.getElementById("editItemCategory")
                .value;

            item.unit =
                document.getElementById("editItemUnit")
                .value;

            item.stock = stock;

            item.minimum = minimum;


            saveInventory();

            let databaseSaved = false;
            try {
                await syncInventoryToServer();
                databaseSaved = true;
            } catch (error) {
                console.error("Inventory update could not be saved to MySQL:", error);
            }

            addAuditLog(
                "Inventory Catalog",
                "Item Updated",
                `${item.id} - ${item.name}`,
                "Updated raw material details and threshold"
            );


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

            alert(
                databaseSaved
                    ? "Raw material updated successfully!"
                    : "The change was saved in this browser, but MySQL could not be updated. Please check the server connection and try again."
            );
        }
    );
}


// ============================================================
// ARCHIVE INVENTORY ITEM
// ============================================================

function itemHasMovementHistory(itemId) {
    return restocks.some(function(entry) {
        return entry.itemId === itemId;
    }) || wastes.some(function(entry) {
        return entry.itemId === itemId;
    }) || stockCounts.some(function(entry) {
        return entry.itemId === itemId;
    });
}

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

    let hasHistory = itemHasMovementHistory(id);

    if (hasHistory) {
        alert(
            "This item has movement history. It will be archived instead of permanently deleted so old records remain valid."
        );
    }


    archivedInventory.push({

        ...targetItem,

        archivedAt:
            new Date().toISOString(),

        archivedBy:
            currentUser.name,

        archivedReason:
            hasHistory
                ? "Historical movement records detected"
                : "Manual archive"

    });


    inventory =
        inventory.filter(function(item) {

            return item.id !== id;

        });


    addAuditLog(
        "Inventory Catalog",
        "Item Archived",
        targetItem.name,
        hasHistory
            ? `Archived raw material ${targetItem.id} while preserving historical movement logs.`
            : `Archived raw material ${targetItem.id}`
    );


    saveInventory();

    let databaseSaved = false;
    try {
        await syncInventoryToServer();
        databaseSaved = true;
    } catch (error) {
        console.error("Inventory archive could not be saved to MySQL:", error);
    }

    populateItemSelects();
    displayInventory();

    if (!databaseSaved) {
        alert("The item was archived in this browser, but MySQL could not be updated. Please check the server connection.");
    }
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


            // Generate next RM-### ID
            let usedIds =
                inventory
                    .concat(archivedInventory)
                    .map(function(item) {

                        return Number(
                            String(item.id)
                                .replace("RM-", "")
                        ) || 0;

                    });


            let newID =
                "RM-" +
                String(
                    Math.max(0, ...usedIds) + 1
                ).padStart(3, "0");


            inventory.push({

                id: newID,

                name: name,

                category: category,

                unit: unit,

                stock: 0,

                minimum: minimum,

                suppliers: []

            });


            saveInventory();

            let databaseSaved = false;
            try {
                await syncInventoryToServer();
                databaseSaved = true;
            } catch (error) {
                console.error("New inventory item could not be saved to MySQL:", error);
            }

            addAuditLog(
                "Inventory Catalog",
                "Item Added",
                `${newID} - ${name}`,
                `Added item with minimum threshold of ${minimum}`
            );


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


            alert(
                databaseSaved
                    ? "Raw material added successfully!"
                    : "The item was added in this browser, but MySQL could not be updated. Please check the server connection."
            );
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