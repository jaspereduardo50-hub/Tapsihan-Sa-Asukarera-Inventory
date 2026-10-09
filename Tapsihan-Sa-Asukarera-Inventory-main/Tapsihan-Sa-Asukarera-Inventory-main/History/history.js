function getTransactionLogger(record) {

    if (record.recordedRole) {
        return record.recordedRole;
    }

    /*
     * Compatibility for older records.
     * These records were created before recordedRole
     * was added, so their original account may not
     * be recoverable.
     */
    if (record.recordedBy) {

        let savedUser =
            String(record.recordedBy).toLowerCase();

        if (
            savedUser === "owner" ||
            savedUser.includes("owner") ||
            savedUser.includes("administrator")
        ) {
            return "Owner";
        }

        if (
            savedUser === "staff" ||
            savedUser.includes("staff")
        ) {
            return "Staff";
        }
    }

    return "Unknown";
}


function getHistoryMovementLedger() {

    let movements = [];


    /*
     * =========================
     * RESTOCKS
     * =========================
     */

    restocks.forEach(function(restock) {

        let item = inventory.find(function(entry) {
            return entry.id === restock.itemId ||
                   entry.name === restock.item;
        });

        movements.push({
            date: restock.date || "",
            timestamp:
                restock.recordedAt ||
                restock.date ||
                "",
            itemId:
                restock.itemId ||
                (item ? item.id : ""),
            item:
                restock.item ||
                (item ? item.name : "Unknown Item"),
            type: "Restock",
            quantity:
                Number(restock.quantity) || 0,
            notes:
                `Supplier: ${restock.supplier || "Not specified"}`,
            loggedBy:
                getTransactionLogger(restock)
        });
    });


    /*
     * =========================
     * STOCK COUNTS
     * =========================
     */

    stockCounts.forEach(function(count) {

        let item = inventory.find(function(entry) {
            return entry.id === count.itemId ||
                   entry.name === count.item;
        });

        let opening =
            Number(count.opening) || 0;

        let closing =
            Number(count.closing) || 0;

        movements.push({
            date: count.date || "",
            timestamp:
                count.recordedAt ||
                count.date ||
                "",
            itemId:
                count.itemId ||
                (item ? item.id : ""),
            item:
                count.item ||
                (item ? item.name : "Unknown Item"),
            type: "Count",
            quantity:
                closing - opening,
            notes:
                `Opening: ${opening}; Closing: ${closing}`,
            loggedBy:
                getTransactionLogger(count)
        });
    });


    /*
     * =========================
     * WASTE / SPOILAGE
     * =========================
     */

    wastes.forEach(function(waste) {

        let item = inventory.find(function(entry) {
            return entry.id === waste.itemId ||
                   entry.name === waste.item;
        });

        movements.push({
            date: waste.date || "",
            timestamp:
                waste.recordedAt ||
                waste.date ||
                "",
            itemId:
                waste.itemId ||
                (item ? item.id : ""),
            item:
                waste.item ||
                (item ? item.name : "Unknown Item"),
            type: "Spoilage",
            quantity:
                -Math.abs(Number(waste.quantity) || 0),
            notes:
                `Reason: ${waste.reason || "Not specified"}`,
            loggedBy:
                getTransactionLogger(waste)
        });
    });


    return movements.sort(function(first, second) {

        return String(second.timestamp)
            .localeCompare(
                String(first.timestamp)
            );
    });
}


function renderHistoryTable() {

    let table =
        document.getElementById(
            "inventoryMovementTable"
        );

    if (!table) return;


    let movements =
        getHistoryMovementLedger();


    let from =
        document.getElementById(
            "movementFrom"
        )?.value || "";


    let to =
        document.getElementById(
            "movementTo"
        )?.value || "";


    let type =
        document.getElementById(
            "movementType"
        )?.value || "";


    let search = (
        document.getElementById("movementSearch")?.value || ""
    ).trim().toLowerCase();


    let filtered =
        movements.filter(function(movement) {

            let matchesDate =
                (!from ||
                    movement.date >= from) &&
                (!to ||
                    movement.date <= to);


            let matchesType =
                !type ||
                movement.type === type;


            
            let searchText = (
                `${movement.itemId} ` +
                `${movement.item} ` +
                `${movement.notes} ` +
                `${movement.loggedBy} ` +
                `${movement.type} ` +
                `${movement.quantity} ` +
                `${movement.date}`
            ).toLowerCase();


            let matchesSearch =
                !search ||
                searchText.includes(search);


            return (
                matchesDate &&
                matchesType &&
                matchesSearch
            );
        });


    table.innerHTML = "";


    if (!filtered.length) {

        table.innerHTML = `
            <tr>
                <td colspan="6"
                    class="text-center text-muted py-4">
                    No transaction history found.
                </td>
            </tr>
        `;

        return;
    }


    filtered.forEach(function(movement) {

        let row =
            document.createElement("tr");


        let quantity =
            movement.quantity > 0
                ? `+${movement.quantity}`
                : movement.quantity;


        let badgeClass =
            movement.type === "Restock"
                ? "bg-success"
                : movement.type === "Spoilage"
                    ? "bg-danger"
                    : "bg-info";


        row.innerHTML = `
            <td>
                ${escapeHtml(
                    movement.date
                )}
            </td>

            <td>
                ${escapeHtml(
                    displayItemId(
                        movement.itemId
                    )
                )}
                -
                ${escapeHtml(
                    movement.item
                )}
            </td>

            <td>
                <span class="badge ${badgeClass}">
                    ${escapeHtml(
                        movement.type
                    )}
                </span>
            </td>

            <td>
                ${quantity}
            </td>

            <td>
                ${escapeHtml(
                    movement.loggedBy
                )}
            </td>

            <td>
                ${escapeHtml(
                    movement.notes
                )}
            </td>
        `;


        table.appendChild(row);
    });
}


/*
 * =========================
 * FILTERS
 * =========================
 */

[
    "movementFrom",
    "movementTo",
    "movementType",
    "movementSearch"
].forEach(function(id) {

    let element =
        document.getElementById(id);

    if (!element) return;


    element.addEventListener(
        "input",
        renderHistoryTable
    );

    element.addEventListener(
        "change",
        renderHistoryTable
    );
});


/*
 * =========================
 * INITIALIZE
 * =========================
 */

if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        renderHistoryTable
    );

} else {

    renderHistoryTable();

}