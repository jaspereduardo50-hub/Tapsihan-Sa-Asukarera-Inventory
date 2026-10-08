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

        let actions = document.getElementById("editRestockForm") ? `
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary me-2" onclick="editRestock(${restockIndex})">Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteRestock(${restockIndex})">Delete</button>
            </td>` : "";

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
    restockForm.addEventListener("submit", function(event) {
        event.preventDefault();

        this.classList.add("was-validated");

        if (!this.checkValidity()) {
            return;
        }

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

        restocks.push({
            shiftId: shiftInfo ? shiftInfo.id : null,
            date: shiftInfo ? shiftInfo.date : todayString,
            itemId: item.id,
            item: item.name,
            quantity: quantity,
            supplier: supplier,
            recordedBy: currentUser ? currentUser.name : "Owner",
            recordedRole:
                currentUser && currentUser.role === "owner"
                    ? "Owner"
                    : "Staff",
            recordedAt: new Date().toISOString()
        });

        /*
         * Restock increases the current
         * inventory balance.
         */
        item.stock += quantity;

        saveInventory();
        saveLedger("tapsihanRestocks", restocks);

        displayRestocks();
        displayInventory();
        displayMovementLogs();

        this.reset();
        this.classList.remove("was-validated");

        let restockDate =
            document.getElementById("restockDate");

        if (restockDate) {
            restockDate.value = shiftInfo.date;
        }

        alert("Restock saved!");
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
    editRestockForm.addEventListener("submit", function(event) {
        event.preventDefault();

        if (!this.checkValidity()) {
            this.classList.add("was-validated");
            return;
        }

        let index = Number(
            document.getElementById("editRestockIndex").value
        );

        let restock = restocks[index];

        if (!restock) return;

        let oldItem = getRestockInventoryItem(restock);

        let oldQuantity = Number(restock.quantity);

        let newItem = inventory.find(function(item) {
            return item.id === document.getElementById("editRestockItem").value;
        });

        let quantity = Number(
            document.getElementById("editRestockQuantity").value
        );

        if (!Number.isFinite(quantity) || quantity <= 0) {
            alert("Restock quantity must be greater than zero.");
            return;
        }

        if (!newItem) return;

        if (oldItem) {
            oldItem.stock -= Number(restock.quantity);
        }

        newItem.stock += quantity;

        restock.date =
            document.getElementById("editRestockDate").value;

        restock.itemId = newItem.id;
        restock.item = newItem.name;
        restock.quantity = quantity;

        restock.supplier =
            document.getElementById("editRestockSupplier").value;

        addAuditLog(
            "Restock",
            "Restock Updated",
            `${newItem.id} - ${newItem.name}`,
            `Updated restock quantity from ${oldQuantity} to ${quantity} ${newItem.unit}. Supplier: ${restock.supplier || "Not specified"}.`
        );

        saveLedger("tapsihanRestocks", restocks);
        saveInventory();

        displayRestocks();
        displayMovementLogs();
        updateDashboard();

        bootstrap.Modal
            .getInstance(document.getElementById("editRestockModal"))
            ?.hide();

        this.classList.remove("was-validated");
    });
}


/* =========================
   DELETE RESTOCK
========================= */

function deleteRestock(index) {
    let restock = restocks[index];

    if (
        !restock ||
        !confirm(
            "Delete this restock entry and remove its quantity from inventory?\nThis will also reduce the current stock balance."
        )
    ) {
        return;
    }

    let item = getRestockInventoryItem(restock);

    if (item) {
        item.stock = Math.max(
            0,
            item.stock - Number(restock.quantity)
        );
    }

    if (
        !restock ||
        !confirm(
            "Delete this restock entry and remove its quantity from inventory?\nThis will also reduce the current stock balance."
        )
    ) {
        return;
    }

    addAuditLog(
        "Restock",
        "Restock Deleted",
        `${restock.itemId} - ${restock.item}`,
        `Deleted restock of ${restock.quantity} ${item ? item.unit : "units"}. Supplier: ${restock.supplier || "Not specified"}.`
    );

    restocks.splice(index, 1);

    saveLedger("tapsihanRestocks", restocks);
    saveInventory();

    displayRestocks();
    displayMovementLogs();
    updateDashboard();
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