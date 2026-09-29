function updateStockConsumption() {

    let activeShift = getActiveShift();

    if (!activeShift) return;

    let selectedShiftId = activeShift.id;

    document.querySelectorAll(".closing-stock").forEach(function(input) {

        let id = input.getAttribute("data-id");

        let opening = document.querySelector(
            '.opening-stock[data-id="' + id + '"]'
        );

        let restock = document.querySelector(
            '.restock-stock[data-id="' + id + '"]'
        );

        let output = document.querySelector(
            '.consumption[data-id="' + id + '"]'
        );

        if (!opening || !restock || !output) return;

        // No closing count yet = no consumption calculation
        if (input.value === "") {
            output.textContent = "0";
            return;
        }

        let spoilageTotal = wastes
            .filter(function(waste) {
                return waste.shiftId === selectedShiftId &&
                       waste.itemId === id;
            })
            .reduce(function(total, waste) {
                return total + Number(waste.quantity || 0);
            }, 0);

        let consumed = calculateDeductiveConsumption(
            Number(opening.value) || 0,
            Number(restock.value) || 0,
            spoilageTotal,
            Number(input.value) || 0
        );

        output.textContent = consumed;
    });
}

function displayStockTable() {
    let table = document.getElementById("stockTable");

    if (!table) return;

    table.innerHTML = "";

    let activeShift = getActiveShift();

    if (!activeShift) {
        table.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    No active shift. Please start a shift first.
                </td>
            </tr>
        `;
        return;
    }

    let selectedDate = activeShift.date;
    let selectedShiftId = activeShift.id;

    inventory.forEach(function(item) {

        let existingCount = stockCounts.find(function(count) {
            return count.shiftId === selectedShiftId &&
                   count.itemId === item.id;
        });

        let openingStock = existingCount
            ? Number(existingCount.opening)
            : 0;

        let restockTotal = restocks
            .filter(function(restock) {
                return restock.shiftId === selectedShiftId &&
                       restock.itemId === item.id;
            })
            .reduce(function(total, restock) {
                return total + Number(restock.quantity || 0);
            }, 0);

        let closingStock = existingCount
            ? (
                existingCount.closing === null ||
                existingCount.closing === undefined
                    ? ""
                    : Number(existingCount.closing)
            )
            : "";

        let row = document.createElement("tr");

        row.innerHTML = `
            <td>
                ${escapeHtml(item.name)}<br>
                <small>
                    ${escapeHtml(displayItemId(item.id))}
                </small>
            </td>

            <td>
                ${escapeHtml(item.unit)}
            </td>

            <td>
                <input
                    type="number"
                    class="form-control opening-stock"
                    data-id="${item.id}"
                    value="${openingStock}"
                    min="0"
                    step="1"
                    required
                >
            </td>

            <td>
                <input
                    type="number"
                    class="form-control restock-stock"
                    data-id="${item.id}"
                    value="${restockTotal}"
                    min="0"
                    step="1"
                    readonly
                >
            </td>

            <td>
                <input
                    type="number"
                    class="form-control closing-stock"
                    data-id="${item.id}"
                    value="${closingStock}"
                    min="0"
                    step="1"
                >
            </td>

            <td
                class="consumption"
                data-id="${item.id}"
            >0</td>
        `;

        table.appendChild(row);
    });

    updateStockConsumption();
}

document.addEventListener("input", function(event) {
    if (event.target.classList.contains("opening-stock") || event.target.classList.contains("closing-stock")) {
        updateStockConsumption();
    }
});

let stockForm = document.getElementById("stockForm");

if (stockForm) {
    stockForm.addEventListener("submit", function(event) {
        event.preventDefault();

        let activeShift = requireActiveShift();

            if (!activeShift) {
                return;
            }

            let stockDate = activeShift.date;
            let shiftId = activeShift.id;

        if (!stockDate) {
            alert("Please select a stock count date.");
            return;
        }

        let savedCount = 0;
        let hasError = false;

        document.querySelectorAll(".closing-stock").forEach(function(input) {
            if (hasError) return;

            let id = input.getAttribute("data-id");

            let openingInput = document.querySelector(
                '.opening-stock[data-id="' + id + '"]'
            );

            let item = inventory.find(function(entry) {
                return entry.id === id;
            });

            if (!item || !openingInput) return;

            let opening = Number(openingInput.value) || 0;
            let closing =
                input.value === ""
                    ? null
                    : Number(input.value);

            // Get restocks for this item on the selected date
            let restockTotal = restocks
                .filter(function(restock) {
                    return restock.date === stockDate &&
                           restock.itemId === id;
                })
                .reduce(function(total, restock) {
                    return total + Number(restock.quantity || 0);
                }, 0);

            // Get spoilage for this item on the selected date
            let spoilageTotal = wastes
                .filter(function(waste) {
                    return waste.date === stockDate &&
                           waste.itemId === id;
                })
                .reduce(function(total, waste) {
                    return total + Number(waste.quantity || 0);
                }, 0);

            // Opening + Restocks = total stock available
            let availableStock = opening + restockTotal;

            // Closing cannot exceed the available stock
            if (closing > availableStock) {
                alert(
                    item.name +
                    " closing stock cannot be greater than its available stock.\n\n" +
                    "Opening: " + opening +
                    "\nRestocks: " + restockTotal +
                    "\nAvailable: " + availableStock +
                    "\nClosing: " + closing
                );

                hasError = true;
                return;
            }

            // Deductive consumption:
            // (Opening + Restocks) - Spoilage - Closing
            let consumed = 0;

            if (closing !== null) {
                consumed = calculateDeductiveConsumption(
                    opening,
                    restockTotal,
                    spoilageTotal,
                    closing
                );
            }

            let existingRecord = stockCounts.find(function(record) {
                return record.shiftId === shiftId &&
                    record.itemId === item.id;
            });

            if (existingRecord) {
                existingRecord.shiftId = shiftId;
                existingRecord.opening = opening;
                existingRecord.restocks = restockTotal;
                existingRecord.spoilage = spoilageTotal;
                existingRecord.closing = closing;
                existingRecord.consumed = consumed;
                existingRecord.item = item.name;
                existingRecord.unit = item.unit;
            } else {
                stockCounts.push({
                    shiftId: shiftId,
                    date: stockDate,
                    itemId: item.id,
                    item: item.name,
                    unit: item.unit,
                    opening: opening,
                    restocks: restockTotal,
                    spoilage: spoilageTotal,
                    closing: closing,
                    consumed: consumed,
                    recordedBy: currentUser ? currentUser.name : "Owner",
                    recordedAt: new Date().toISOString()
                });
            }

            // Closing stock becomes the inventory's current stock.
            if (closing !== null) {
                item.stock = closing;
            }

            savedCount++;
        });

        // Stop if validation failed
        if (hasError) {
            return;
        }

        saveStockCountsLedger(stockCounts);
        saveInventory();

        displayStockTable();
        updateDashboard();

        alert("Stock count saved successfully!");
    });
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
        displayStockTable();
    });
} else {
    displayStockTable();
}