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
    wasteForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        let activeShift = requireActiveShift();

        if (!activeShift) {
            return;
        }

        if (!this.checkValidity()) {
            this.classList.add("was-validated");
            return;
        }

        let form = this;

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

        if (!Number.isInteger(quantity) || quantity <= 0) {
            alert("Waste quantity must be a whole number greater than 0.");
            return;
        }

        if (quantity > item.stock) {
            alert(
                `Cannot log waste. Available stock for ${item.name} is only ${item.stock} ${item.unit}.`
            );
            return;
        }

        let saveButton = form.querySelector("[type='submit']");
        if (saveButton) saveButton.disabled = true;

        try {
            /*
             * One record is sent to MySQL. The server checks the stock, attaches the
             * waste to the open shift, lowers the stock and writes the audit entry.
             */
            await ledgerRequest("waste_spoilage.php", "POST", {
                waste: {
                    itemId: item.id,
                    quantity: quantity,
                    reason: reason,
                    shiftId: activeShift.id
                }
            });

            await refreshInventoryFromServer();
            await loadWastesFromServer();

            displayMovementLogs();
            updateDashboard();

            form.reset();
            form.classList.remove("was-validated");
            initializeWasteShift();
            updateWasteImpact();

            alert("Waste record saved!");
        } catch (error) {
            alert(error.message);

            // The shift may have been ended on another device.
            await refreshShiftsFromServer();
            await refreshInventoryFromServer();
            await loadWastesFromServer();
            initializeWasteShift();
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
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

        let actions = isLedgerEntryLocked(item) ? `
            <td>
                <span class="badge bg-secondary" title="${LOCKED_ENTRY_MESSAGE}">Locked</span>
            </td>` : `
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary me-2" onclick="openEditWaste('${item.id || wasteIndex}')">Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteWaste('${item.id || wasteIndex}')">Remove</button>
            </td>`;

        row.innerHTML = `
            <td>${item.date}</td>
            <td>${escapeHtml(item.item)}</td>
            <td>-${item.quantity}</td>
            <td>${escapeHtml(item.reason)}</td>
            ${actions}
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

    if (isLedgerEntryLocked(waste)) {
        alert(LOCKED_ENTRY_MESSAGE);
        displayWaste();
        return;
    }

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
    displayWaste();
    displayMovementLogs();
    updateWasteImpact();
}

async function deleteWaste(id) {
    let waste = findWasteRecord(id);

    if (!waste) return;

    if (isLedgerEntryLocked(waste)) {
        alert(LOCKED_ENTRY_MESSAGE);
        displayWaste();
        return;
    }

    if (!confirm(
        "Remove this waste entry and restore its quantity to inventory?"
    )) {
        return;
    }

    try {
        await ledgerRequest(
            "waste_spoilage.php?id=" + encodeURIComponent(waste.id),
            "DELETE"
        );

        await refreshInventoryFromServer();
        await loadWastesFromServer();

        refreshWasteViews();
        updateDashboard();

        alert("Waste entry removed and inventory restored.");
    } catch (error) {
        alert(error.message);
        await refreshShiftsFromServer();
        await loadWastesFromServer();
    }
}

let editWasteForm = document.getElementById("editWasteForm");

if (editWasteForm) {
    editWasteForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        this.classList.add("was-validated");

        if (!this.checkValidity()) return;

        let form = this;

        let waste = findWasteRecord(
            document.getElementById("editWasteId").value
        );

        if (!waste) return;

        if (isLedgerEntryLocked(waste)) {
            alert(LOCKED_ENTRY_MESSAGE);
            bootstrap.Modal
                .getInstance(document.getElementById("editWasteModal"))
                ?.hide();
            displayWaste();
            return;
        }

        let oldQuantity = Number(waste.quantity) || 0;
        let oldItem = getWasteInventoryItem(waste);

        let newItemId =
            document.getElementById("editWasteItem").value;

        let newItem = inventory.find(function(item) {
            return item.id === newItemId;
        });

        let newQuantity =
            Number(document.getElementById("editWasteQuantity").value);

        if (!Number.isInteger(newQuantity) || newQuantity <= 0) {
            alert("Waste quantity must be a whole number greater than zero.");
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

        let saveButton = form.querySelector("[type='submit']");
        if (saveButton) saveButton.disabled = true;

        try {
            await ledgerRequest(
                "waste_spoilage.php?id=" + encodeURIComponent(waste.id),
                "PUT",
                {
                    waste: {
                        itemId: newItem.id,
                        quantity: newQuantity,
                        reason: document.getElementById("editWasteReason").value
                    }
                }
            );

            await refreshInventoryFromServer();
            await loadWastesFromServer();

            refreshWasteViews();
            updateDashboard();

            bootstrap.Modal
                .getInstance(
                    document.getElementById("editWasteModal")
                )
                ?.hide();

            form.reset();
            form.classList.remove("was-validated");

            alert("Waste entry updated.");
        } catch (error) {
            alert(error.message);
            await refreshShiftsFromServer();
            await loadWastesFromServer();
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
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

/* MySQL is the source of truth. The browser copy is only a cache and is NEVER uploaded. */
function setWastespoilageDbStatus(message, isError) {
    const table = document.getElementById("wasteTable");
    if (!table) return;
    const tableElement = table.closest("table") || table;
    let box = document.getElementById("wasteDbStatus");
    if (!message) { if (box) box.remove(); return; }
    if (!box) {
        box = document.createElement("div");
        box.id = "wasteDbStatus";
        box.setAttribute("role", "status");
        tableElement.parentNode.insertBefore(box, tableElement);
    }
    box.className = "alert " + (isError ? "alert-danger" : "alert-success") + " py-2 small";
    box.textContent = message;
}

async function loadWastesFromServer() {
    try {
        const response = await fetch("waste_spoilage.php", { credentials: "same-origin", cache: "no-store" });
        const data = await response.json().catch(function() { return null; });
        const collection = data && data.wastes;
        if (!response.ok || !data || !data.ok || !Array.isArray(collection)) {
            throw new Error(data && data.error ? data.error : "HTTP " + response.status);
        }
        wastes = collection;
        localStorage.setItem("tapsihanWastes", JSON.stringify(wastes));
        setWastespoilageDbStatus("", false);
    } catch (error) {
        console.warn("Unable to load waste / spoilage from MySQL.", error);
        setWastespoilageDbStatus(
            "DATABASE CONNECTION WARNING: Waste / spoilage could not be refreshed from MySQL. The records shown may be outdated. Do not use this copy to make stock decisions or assume a change was saved. Check the connection and refresh.",
            true
        );
    }
    displayWaste();
    updateWasteImpact();
}

async function initializeWastePage() {
    await Promise.all([refreshShiftsFromServer(), refreshInventoryFromServer()]);
    if (typeof populateItemSelects === "function") populateItemSelects();
    initializeWasteShift();
    await loadWastesFromServer();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWastePage);
} else {
    initializeWastePage();
}
