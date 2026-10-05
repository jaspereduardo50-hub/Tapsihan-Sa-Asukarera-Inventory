let wasteForm = document.getElementById("wasteForm");

function updateWasteImpact() {
    let itemSelect = document.getElementById("wasteItem");
    let quantityInput = document.getElementById("wasteQuantity");
    let currentStockEl = document.getElementById("wasteCurrentStock");
    let quantityEl = document.getElementById("wasteImpactQuantity");
    let projectedStockEl = document.getElementById("wasteProjectedStock");

    if (
        !itemSelect ||
        !quantityInput ||
        !currentStockEl ||
        !quantityEl ||
        !projectedStockEl
    ) {
        return;
    }

    let item = inventory.find(function(entry) {
        return entry.id === itemSelect.value;
    });

    let quantity = Number(quantityInput.value) || 0;

    if (!item) {
        currentStockEl.textContent = "-";
        quantityEl.textContent = "-";
        projectedStockEl.textContent = "-";
        return;
    }

    currentStockEl.textContent = `${item.stock} ${item.unit}`;
    quantityEl.textContent = `${quantity} ${item.unit}`;
    if (quantity > item.stock) {
        projectedStockEl.textContent = "Insufficient stock";
    } else {
        projectedStockEl.textContent =
            `${item.stock - quantity} ${item.unit}`;
    }
}

if (document.getElementById("wasteItem")) {
    document.getElementById("wasteItem").addEventListener(
        "change",
        updateWasteImpact
    );
}

if (document.getElementById("wasteQuantity")) {
    document.getElementById("wasteQuantity").addEventListener(
        "input",
        updateWasteImpact
    );
}

if (wasteForm) {
    wasteForm.addEventListener("submit", function(event) {
        event.preventDefault();

        let activeShift = requireActiveShift();

        if (!activeShift) {
            return;
        }

        if (!this.checkValidity()) {
            this.classList.add("was-validated");
            return;
        }

        let id =
            document.getElementById("wasteItem").value;

        let quantity =
            Number(
                document.getElementById("wasteQuantity").value
            );

        let reason =
            document.getElementById("wasteReason").value;

        let item = inventory.find(function(item) {
            return item.id === id;
        });

        if (!item) return;

        if (quantity <= 0) {
            alert("Waste quantity must be greater than 0.");
            return;
        }

        if (quantity > item.stock) {
            alert(
                `Cannot log waste. Available stock for ${item.name} is only ${item.stock} ${item.unit}.`
            );
            return;
        }

        /*
         * Create the waste record and associate it
         * with the active shift.
         */
        wastes.push({
            id: "WASTE-" + Date.now(),
            shiftId: activeShift.id,
            date: activeShift.date,
            itemId: item.id,
            item: item.name,
            quantity: quantity,
            reason: reason
        });

        /*
         * Waste reduces the current inventory balance.
         */
        item.stock -= quantity;

        addAuditLog(
            "Waste / Spoilage",
            "Waste Logged",
            `${item.id} - ${item.name}`,
            `Logged ${quantity} ${item.unit} as waste with reason: ${reason}`
        );

        saveLedger("tapsihanWastes", wastes);
        saveInventory();

        displayWaste();
        displayMovementLogs();
        updateDashboard();
        updateWasteImpact();

        this.reset();
        this.classList.remove("was-validated");

        let wasteDate =
            document.getElementById("wasteDate");

        if (wasteDate) {
            wasteDate.value = activeShift.date;
        }

        updateWasteImpact();

        alert("Waste record saved!");
    });
}

function displayWaste() {
    let table = document.getElementById("wasteTable");
    if (!table) return;

    table.innerHTML = "";

    if (!wastes.length) {
        table.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted py-4">
                    No waste transactions recorded yet.
                </td>
            </tr>
        `;
        return; 
    }

    wastes.slice().reverse().forEach(function(item, reverseIndex) {
        let wasteIndex = wastes.length - 1 - reverseIndex;
        let row = document.createElement("tr");

        row.innerHTML = `
            <td>${item.date}</td>
            <td>${escapeHtml(item.item)}</td>
            <td>-${item.quantity}</td>
            <td>${escapeHtml(item.reason)}</td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary me-2" onclick="openEditWaste('${item.id || wasteIndex}')">Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteWaste('${item.id || wasteIndex}')">Remove</button>
            </td>
        `;

        table.appendChild(row);
    });
}

function findWasteRecord(id) {
    return wastes.find(function(entry, index) {
        return String(entry.id || index) === String(id);
    });
}

function getWasteInventoryItem(waste) {
    return inventory.find(function(item) {
        return item.id === waste.itemId || item.name === waste.item;
    });
}

function openEditWaste(id) {
    let waste = findWasteRecord(id);
    if (!waste) return;

    document.getElementById("editWasteId").value = waste.id || id;
    document.getElementById("editWasteDate").value = waste.date;
    document.getElementById("editWasteQuantity").value = waste.quantity;
    document.getElementById("editWasteReason").value = waste.reason;

    let itemSelect = document.getElementById("editWasteItem");
    itemSelect.innerHTML = "";

    inventory.forEach(function(item) {
        let option = document.createElement("option");

        option.value = item.id;
        option.textContent = item.name;
        option.selected =
            item.id === waste.itemId ||
            item.name === waste.item;

        itemSelect.appendChild(option);
    });

    new bootstrap.Modal(
        document.getElementById("editWasteModal")
    ).show();
}

function refreshWasteViews() {
    saveLedger("tapsihanWastes", wastes);
    saveInventory();
    displayWaste();
    displayMovementLogs();
    updateWasteImpact();
}

function deleteWaste(id) {
    let wasteIndex = wastes.findIndex(function(entry, index) {
        return String(entry.id || index) === String(id);
    });

    if (wasteIndex < 0) return;

    let waste = wastes[wasteIndex];
    let item = getWasteInventoryItem(waste);

    if (!confirm(
        "Remove this waste entry and restore its quantity to inventory?"
    )) {
        return;
    }

    if (item) {
        item.stock += Number(waste.quantity);
    }

    addAuditLog(
        "Waste / Spoilage",
        "Waste Deleted",
        waste.itemId || waste.item || "Waste Record",
        `Removed waste record for ${waste.item} (${waste.quantity} ${item ? item.unit : "units"}) and restored stock.`
    );

    wastes.splice(wasteIndex, 1);

    refreshWasteViews();

    alert("Waste entry removed and inventory restored.");
}

let editWasteForm = document.getElementById("editWasteForm");

if (editWasteForm) {
    editWasteForm.addEventListener("submit", function(event) {
        event.preventDefault();

        this.classList.add("was-validated");

        if (!this.checkValidity()) return;

        let waste = findWasteRecord(
            document.getElementById("editWasteId").value
        );

        if (!waste) return;

        let oldQuantity = Number(waste.quantity) || 0;
        let oldItem = getWasteInventoryItem(waste);

        let newItemId =
            document.getElementById("editWasteItem").value;

        let newItem = inventory.find(function(item) {
            return item.id === newItemId;
        });

        let newQuantity =
            Number(document.getElementById("editWasteQuantity").value);

        if (!Number.isFinite(newQuantity) || newQuantity <= 0) {
            alert("Waste quantity must be greater than zero.");
            return;
        }

        if (!newItem) return;

        let availableStock = newItem.stock;

        if (oldItem && oldItem.id === newItem.id) {
            availableStock += oldQuantity;
        }

        if (newQuantity > availableStock) {
            alert(
                `Cannot update waste for ${newItem.name}. Available stock is ${availableStock} ${newItem.unit}.`
            );
            return;
        }

        if (oldItem) {
            oldItem.stock += oldQuantity;
        }

        newItem.stock = Math.max(
            0,
            newItem.stock - newQuantity
        );

        waste.itemId = newItem.id;
        waste.item = newItem.name;
        waste.quantity = newQuantity;
        waste.reason =
            document.getElementById("editWasteReason").value;

        addAuditLog(
            "Waste / Spoilage",
            "Waste Updated",
            `${newItem.id} - ${newItem.name}`,
            `Updated waste quantity from ${oldQuantity} to ${newQuantity} ${newItem.unit}`
        );

        refreshWasteViews();

        bootstrap.Modal
            .getInstance(
                document.getElementById("editWasteModal")
            )
            .hide();

        this.reset();
        this.classList.remove("was-validated");

        alert("Waste entry updated.");
    });
}

if (document.getElementById("wasteTable")) {
    displayWaste();
}

if (document.getElementById("wasteItem")) {
    updateWasteImpact();
}

function initializeWasteShift() {

    let wasteDate =
        document.getElementById("wasteDate");

    if (!wasteDate) return;

    let activeShift = getActiveShift();

    if (!activeShift) {
        wasteDate.value = "";
        wasteDate.disabled = true;
        return;
    }

    wasteDate.value = activeShift.date;
    wasteDate.disabled = true;
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeWasteShift
    );
} else {
    initializeWasteShift();
}