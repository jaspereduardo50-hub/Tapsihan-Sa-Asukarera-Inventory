function renderHistoryTable() {
    let table = document.getElementById("inventoryMovementTable");
    if (!table) return;

    let movements = getMovementLedger();
    let from = document.getElementById("movementFrom")?.value || "";
    let to = document.getElementById("movementTo")?.value || "";
    let type = document.getElementById("movementType")?.value || "";
    let search = (document.getElementById("movementSearch")?.value || "").toLowerCase();

    let filtered = movements.filter(function(movement) {
        let matchesDate = (!from || movement.date >= from) && (!to || movement.date <= to);
        let matchesType = !type || movement.type === type;
        let searchText = `${movement.itemId} ${movement.item} ${movement.notes}`.toLowerCase();
        let matchesSearch = !search || searchText.includes(search);
        return matchesDate && matchesType && matchesSearch;
    });

    table.innerHTML = "";

    if (!filtered.length) {
        table.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    No transaction history found.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(function(movement) {
        let row = document.createElement("tr");
        let quantity = movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity;
        let badgeClass = movement.type === "Restock" ? "bg-success" : movement.type === "Spoilage" ? "bg-danger" : "bg-info";

        row.innerHTML = `
            <td>${escapeHtml(movement.date)}</td>
            <td>${escapeHtml(displayItemId(movement.itemId))} - ${escapeHtml(movement.item)}</td>
            <td><span class="badge ${badgeClass}">${movement.type}</span></td>
            <td>${quantity}</td>
            <td>${escapeHtml(currentUser.name)}</td>
            <td>${escapeHtml(movement.notes)}</td>
        `;

        table.appendChild(row);
    });
}

["movementFrom", "movementTo", "movementType", "movementSearch"].forEach(function(id) {
    let element = document.getElementById(id);
    if (element) {
        element.addEventListener("input", renderHistoryTable);
        element.addEventListener("change", renderHistoryTable);
    }
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderHistoryTable);
} else {
    renderHistoryTable();
}
