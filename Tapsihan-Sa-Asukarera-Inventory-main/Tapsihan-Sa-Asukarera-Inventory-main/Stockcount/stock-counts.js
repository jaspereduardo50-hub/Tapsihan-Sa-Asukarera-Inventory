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
        let stockDateInput = document.getElementById("stockDate");
        if (stockDateInput) {
            stockDateInput.value = "";
            stockDateInput.disabled = true;
        }

        table.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    No active shift. Please start a shift first.
                </td>
            </tr>
        `;
        return;
    }

    let selectedDate = activeShift.date;
    let selectedShiftId = activeShift.id;
    let stockDateInput = document.getElementById("stockDate");
    if (stockDateInput) {
        stockDateInput.value = selectedDate;
        stockDateInput.disabled = true;
    }

    inventory.forEach(function(item) {

        let existingCount = stockCounts.find(function(count) {
            return count.shiftId === selectedShiftId &&
                   count.itemId === item.id;
        });

        let openingStock = existingCount
            ? Number(existingCount.opening)
            : getShiftOpeningStock(activeShift, item);

        let restockTotal = restocks
            .filter(function(restock) {
                return restock.shiftId === selectedShiftId &&
                       restock.itemId === item.id;
            })
            .reduce(function(total, restock) {
                return total + Number(restock.quantity || 0);
            }, 0);

        let spoilageTotal = wastes
            .filter(function(waste) {
                return waste.shiftId === selectedShiftId &&
                       waste.itemId === item.id;
            })
            .reduce(function(total, waste) {
                return total + Number(waste.quantity || 0);
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
                    readonly
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

            <td class="spoilage-stock" data-id="${item.id}">
                ${spoilageTotal}
            </td>

            <td>
                <input
                    type="number"
                    class="form-control closing-stock"
                    data-id="${item.id}"
                    value="${closingStock}"
                    min="0"
                    step="1"
                    required
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
    if (event.target.classList.contains("closing-stock")) {
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

        let countUpdates = [];
        let validationError = "";

        document.querySelectorAll(".closing-stock").forEach(function(input) {
            if (validationError) return;
            let id = input.getAttribute("data-id");

            let openingInput = document.querySelector(
                '.opening-stock[data-id="' + id + '"]'
            );

            let item = inventory.find(function(entry) {
                return entry.id === id;
            });

            if (!item || !openingInput) return;

            let opening = Number(openingInput.value);
            let expectedOpening = getShiftOpeningStock(activeShift, item);
            let closing = input.value === "" ? null : Number(input.value);

            // Get restocks for this item in the active shift
            let restockTotal = restocks
                .filter(function(restock) {
                    return restock.shiftId === shiftId &&
                           restock.itemId === id;
                })
                .reduce(function(total, restock) {
                    return total + Number(restock.quantity || 0);
                }, 0);

            // Get spoilage for this item in the active shift
            let spoilageTotal = wastes
                .filter(function(waste) {
                    return waste.shiftId === shiftId &&
                           waste.itemId === id;
                })
                .reduce(function(total, waste) {
                    return total + Number(waste.quantity || 0);
                }, 0);

            let availableStock = opening + restockTotal - spoilageTotal;

            if (!Number.isInteger(opening) || opening < 0 || opening !== expectedOpening) {
                validationError = item.name + " opening stock does not match the fixed stock available at the start of the shift.";
                return;
            }

            if (closing === null) {
                validationError = "Enter a closing stock count for " + item.name + ".";
                return;
            }

            if (!Number.isInteger(closing) || closing < 0) {
                validationError = item.name + " closing stock must be a whole number of 0 or more.";
                return;
            }

            if (spoilageTotal > opening + restockTotal) {
                validationError = item.name + " waste cannot exceed opening stock plus restocks.";
                return;
            }

            // Closing cannot exceed stock remaining after waste
            if (closing > availableStock) {
                validationError =
                    item.name +
                    " closing stock cannot be greater than its available stock.\n\n" +
                    "Opening: " + opening +
                    "\nRestocks: " + restockTotal +
                    "\nWaste: " + spoilageTotal +
                    "\nAvailable: " + availableStock +
                    "\nClosing: " + closing;
                return;
            }

            let consumed = calculateDeductiveConsumption(
                opening,
                restockTotal,
                spoilageTotal,
                closing
            );

            let existingRecord = stockCounts.find(function(record) {
                return record.shiftId === shiftId &&
                    record.itemId === item.id;
            });

            countUpdates.push({
                item: item,
                opening: opening,
                restocks: restockTotal,
                spoilage: spoilageTotal,
                closing: closing,
                consumed: consumed,
                existingRecord: existingRecord
            });
        });

        if (validationError) {
            alert(validationError);
            return;
        }

        countUpdates.forEach(function(count) {
            let record = count.existingRecord;
            if (!record) {
                record = {
                    shiftId: shiftId,
                    date: stockDate,
                    itemId: count.item.id,
                    recordedBy: currentUser ? currentUser.name : "Owner",
                    recordedAt: new Date().toISOString()
                };
                stockCounts.push(record);
            }

            record.shiftId = shiftId;
            record.date = stockDate;
            record.opening = count.opening;
            record.restocks = count.restocks;
            record.spoilage = count.spoilage;
            record.closing = count.closing;
            record.consumed = count.consumed;
            record.item = count.item.name;
            record.unit = count.item.unit;
            record.recordedBy = currentUser ? currentUser.name : "Owner";
            record.recordedAt = new Date().toISOString();
            count.item.stock = count.closing;
        });

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