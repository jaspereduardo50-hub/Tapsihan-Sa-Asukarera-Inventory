function displayRestocks() {
    let table = document.getElementById("restockTable");
    if (!table) return;

    table.innerHTML = "";

    if (!restocks.length) {
        let row = document.createElement("tr");
        row.innerHTML = `
            <td colspan="${document.getElementById("editRestockForm") ? 5 : 4}" class="text-center text-muted py-4">
                No restock transactions recorded yet.
            </td>
        `;
        table.appendChild(row);
        return;
    }

    restocks.slice().reverse().forEach(function(item, reverseIndex) {
        let restockIndex = restocks.length - 1 - reverseIndex;
        let row = document.createElement("tr");

        let actions = "";

        if (document.getElementById("editRestockForm")) {
            actions = isLedgerEntryLocked(item) ? `
            <td class="text-nowrap">
                <span class="badge bg-secondary" title="${LOCKED_ENTRY_MESSAGE}">Locked</span>
            </td>` : `
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary me-2" onclick="editRestock(${restockIndex})">Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteRestock(${restockIndex})">Delete</button>
            </td>`;
        }

        row.innerHTML = `
            <td>${escapeHtml(item.date)}</td>
            <td>${escapeHtml(item.item)}</td>
            <td>+${item.quantity}</td>
            <td>${escapeHtml(item.supplier)}</td>
            ${actions}
        `;

        table.appendChild(row);
    });
}


/* =========================
   ADD RESTOCK
========================= */

let restockForm = document.getElementById("restockForm");

if (restockForm) {
    restockForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        this.classList.add("was-validated");

        if (!this.checkValidity()) {
            return;
        }

        let form = this;

        let id =
            document.getElementById("restockItem").value;

        let quantity =
            Number(
                document.getElementById("restockQuantity").value
            );

        let supplier =
            document.getElementById("restockSupplier").value;

        let item = inventory.find(function(item) {
            return item.id === id;
        });

        if (!item) {
            return;
        }

        let shiftInfo = getActiveShift();

        if (!Number.isInteger(quantity) || quantity <= 0) {
            alert("Restock quantity must be a whole number greater than zero.");
            return;
        }

        let saveButton = form.querySelector("[type='submit']");
        if (saveButton) saveButton.disabled = true;

        try {
            /*
             * One record is sent to MySQL. The server updates the stock level,
             * attaches the restock to the open shift and writes the audit entry.
             */
            await ledgerRequest("restocks.php", "POST", {
                restock: {
                    itemId: item.id,
                    quantity: quantity,
                    supplier: supplier,
                    shiftId: shiftInfo ? shiftInfo.id : ""
                }
            });

            await refreshInventoryFromServer();
            await loadRestocksFromServer();

            displayMovementLogs();
            updateDashboard();

            form.reset();
            form.classList.remove("was-validated");
            initializeRestockShift();

            alert("Restock saved!");
        } catch (error) {
            alert(error.message);

            // The shift may have been started or ended on another device.
            await refreshShiftsFromServer();
            await refreshInventoryFromServer();
            await loadRestocksFromServer();
            initializeRestockShift();
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    });
}


/* =========================
   GET RESTOCK INVENTORY ITEM
========================= */

function getRestockInventoryItem(restock) {
    return inventory.find(function(item) {
        return item.id === restock.itemId || item.name === restock.item;
    });
}


/* =========================
   EDIT RESTOCK
========================= */

function editRestock(index) {
    let restock = restocks[index];
    if (!restock) return;

    if (isLedgerEntryLocked(restock)) {
        alert(LOCKED_ENTRY_MESSAGE);
        displayRestocks();
        return;
    }

    let modal = document.getElementById("editRestockModal");
    if (!modal) return;

    document.getElementById("editRestockIndex").value = index;
    document.getElementById("editRestockDate").value = restock.date;
    document.getElementById("editRestockDate").disabled = true;
    document.getElementById("editRestockQuantity").value = restock.quantity;

    let itemSelect = document.getElementById("editRestockItem");
    itemSelect.innerHTML = "";

    inventory.forEach(function(item) {
        let option = document.createElement("option");

        option.value = item.id;
        option.textContent = item.name;

        option.selected =
            item.id === restock.itemId ||
            item.name === restock.item;

        itemSelect.appendChild(option);
    });

    updateEditRestockSuppliers(
        restock.itemId || getRestockInventoryItem(restock)?.id,
        restock.supplier
    );

    bootstrap.Modal.getOrCreateInstance(modal).show();
}


/* =========================
   EDIT RESTOCK SUPPLIERS
========================= */

function updateEditRestockSuppliers(itemId, selectedSupplier) {
    let supplierSelect = document.getElementById("editRestockSupplier");
    if (!supplierSelect) return;

    let item = inventory.find(function(entry) {
        return entry.id === itemId;
    });

    let suppliers = item && Array.isArray(item.suppliers)
        ? item.suppliers.filter(Boolean)
        : [];

    supplierSelect.innerHTML = "";

    suppliers.forEach(function(supplier) {
        let option = document.createElement("option");

        option.value = supplier.name;
        option.textContent = supplier.name;
        option.selected = supplier.name === selectedSupplier;

        supplierSelect.appendChild(option);
    });

    if (!suppliers.some(function(supplier) {
        return supplier.name === selectedSupplier;
    })) {
        let option = document.createElement("option");

        option.value = selectedSupplier || "";
        option.textContent = selectedSupplier || "Select a supplier";
        option.selected = true;

        supplierSelect.appendChild(option);
    }
}


/* =========================
   EDIT ITEM CHANGE
========================= */

let editRestockItem = document.getElementById("editRestockItem");

if (editRestockItem) {
    editRestockItem.addEventListener("change", function() {
        updateEditRestockSuppliers(this.value, "");
    });
}


/* =========================
   EDIT RESTOCK FORM
========================= */

let editRestockForm = document.getElementById("editRestockForm");

if (editRestockForm) {
    editRestockForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        if (!this.checkValidity()) {
            this.classList.add("was-validated");
            return;
        }

        let form = this;

        let index = Number(
            document.getElementById("editRestockIndex").value
        );

        let restock = restocks[index];

        if (!restock) return;

        if (isLedgerEntryLocked(restock)) {
            alert(LOCKED_ENTRY_MESSAGE);
            bootstrap.Modal
                .getInstance(document.getElementById("editRestockModal"))
                ?.hide();
            displayRestocks();
            return;
        }

        let newItem = inventory.find(function(item) {
            return item.id === document.getElementById("editRestockItem").value;
        });

        let quantity = Number(
            document.getElementById("editRestockQuantity").value
        );

        if (!Number.isInteger(quantity) || quantity <= 0) {
            alert("Restock quantity must be a whole number greater than zero.");
            return;
        }

        if (!newItem) return;

        let saveButton = form.querySelector("[type='submit']");
        if (saveButton) saveButton.disabled = true;

        try {
            await ledgerRequest(
                "restocks.php?id=" + encodeURIComponent(restock.id),
                "PUT",
                {
                    restock: {
                        itemId: newItem.id,
                        quantity: quantity,
                        supplier: document.getElementById("editRestockSupplier").value
                    }
                }
            );

            await refreshInventoryFromServer();
            await loadRestocksFromServer();

            displayRestocks();
            displayMovementLogs();
            updateDashboard();

            bootstrap.Modal
                .getInstance(document.getElementById("editRestockModal"))
                ?.hide();

            form.classList.remove("was-validated");
        } catch (error) {
            alert(error.message);
            await refreshShiftsFromServer();
            await loadRestocksFromServer();
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    });
}


/* =========================
   DELETE RESTOCK
========================= */

async function deleteRestock(index) {
    let restock = restocks[index];

    if (!restock) return;

    if (isLedgerEntryLocked(restock)) {
        alert(LOCKED_ENTRY_MESSAGE);
        displayRestocks();
        return;
    }

    if (!confirm(
        "Delete this restock entry and remove its quantity from inventory?\nThis will also reduce the current stock balance."
    )) {
        return;
    }

    try {
        await ledgerRequest(
            "restocks.php?id=" + encodeURIComponent(restock.id),
            "DELETE"
        );

        await refreshInventoryFromServer();
        await loadRestocksFromServer();

        displayRestocks();
        displayMovementLogs();
        updateDashboard();
    } catch (error) {
        alert(error.message);
        await refreshShiftsFromServer();
        await loadRestocksFromServer();
    }
}


/* =========================
   INITIALIZE RESTOCK PAGE
========================= */

if (document.getElementById("restockTable")) {
    displayRestocks();
}

function initializeRestockShift() {

    let restockDate =
        document.getElementById("restockDate");
    let restockFormElement = document.getElementById("restockForm");
    let restockItem = document.getElementById("restockItem");
    let restockQuantity = document.getElementById("restockQuantity");
    let restockSupplier = document.getElementById("restockSupplier");
    let saveButton = restockFormElement?.querySelector("button[type='submit']") || restockFormElement?.querySelector("button");
    let message = document.getElementById("restockMessage");

    if (!restockDate) return;

    let activeShift = getActiveShift();

    if (!activeShift) {
        restockDate.value = todayString;
        restockDate.disabled = true;

        if (restockItem) restockItem.disabled = false;
        if (restockQuantity) restockQuantity.disabled = false;
        if (restockSupplier) restockSupplier.disabled = false;
        if (saveButton) saveButton.disabled = false;

        if (message) {
            message.textContent =
                "No active shift. This restock will be added to today's inventory and reflected in the next shift's opening stock.";
            message.className = "alert alert-info mt-3";
        }

        return;
    }

    restockDate.value = activeShift.date;
    restockDate.disabled = true;

    if (restockItem) restockItem.disabled = false;
    if (restockQuantity) restockQuantity.disabled = false;
    if (restockSupplier) restockSupplier.disabled = false;
    if (saveButton) saveButton.disabled = false;

    if (message) {
        message.textContent = "";
        message.className = "alert d-none mt-3";
    }
}

initializeRestockShift();

/* MySQL is the source of truth. The browser copy is only a cache and is NEVER uploaded. */
function setRestocksDbStatus(message, isError) {
    const table = document.getElementById("restockTable");
    if (!table) return;
    const tableElement = table.closest("table") || table;
    let box = document.getElementById("restockDbStatus");
    if (!message) { if (box) box.remove(); return; }
    if (!box) {
        box = document.createElement("div");
        box.id = "restockDbStatus";
        box.setAttribute("role", "status");
        tableElement.parentNode.insertBefore(box, tableElement);
    }
    box.className = "alert " + (isError ? "alert-danger" : "alert-success") + " py-2 small";
    box.textContent = message;
}

async function loadRestocksFromServer() {
    try {
        const response = await fetch("restocks.php", { credentials: "same-origin", cache: "no-store" });
        const data = await response.json().catch(function() { return null; });
        const collection = data && data.restocks;
        if (!response.ok || !data || !data.ok || !Array.isArray(collection)) {
            throw new Error(data && data.error ? data.error : "HTTP " + response.status);
        }
        restocks = collection;
        localStorage.setItem("tapsihanRestocks", JSON.stringify(restocks));
        setRestocksDbStatus("", false);
    } catch (error) {
        console.warn("Unable to load restocks from MySQL.", error);
        setRestocksDbStatus(
            "DATABASE CONNECTION WARNING: Restocks could not be refreshed from MySQL. The records shown may be outdated. Do not use this copy to make stock decisions or assume a change was saved. Check the connection and refresh.",
            true
        );
    }
    displayRestocks();
    if (typeof displayMovementLogs === "function") displayMovementLogs();
}

async function initializeRestockPage() {
    await Promise.all([refreshShiftsFromServer(), refreshInventoryFromServer()]);
    if (typeof populateItemSelects === "function") populateItemSelects();
    if (typeof updateRestockSuppliers === "function") updateRestockSuppliers();
    initializeRestockShift();
    await loadRestocksFromServer();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeRestockPage);
else initializeRestockPage();
