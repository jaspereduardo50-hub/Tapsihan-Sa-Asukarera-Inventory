
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

        if (input.value === "") {
            output.textContent = "—";
            return;
        }

        let spoilageTotal = wastes
            .filter(function(waste) {
                return String(waste.shiftId) === String(selectedShiftId) &&
                    String(waste.itemId) === String(id);
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
            return String(count.shiftId) === String(selectedShiftId) &&
                String(count.itemId) === String(item.id);
        });

        let openingStock = existingCount
            ? Number(existingCount.opening)
            : getShiftOpeningStock(activeShift, item);

        let restockTotal = restocks
            .filter(function(restock) {
                return String(restock.shiftId) === String(selectedShiftId) &&
                    String(restock.itemId) === String(item.id);
            })
            .reduce(function(total, restock) {
                return total + Number(restock.quantity || 0);
            }, 0);

        let spoilageTotal = wastes
            .filter(function(waste) {
                return String(waste.shiftId) === String(selectedShiftId) &&
                    String(waste.itemId) === String(item.id);
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
                <small>${escapeHtml(displayItemId(item.id))}</small>
            </td>
            <td>${escapeHtml(item.unit)}</td>
            <td>
                <input
                    type="number"
                    class="form-control opening-stock"
                    data-id="${escapeHtml(String(item.id))}"
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
                    data-id="${escapeHtml(String(item.id))}"
                    value="${restockTotal}"
                    min="0"
                    step="1"
                    readonly
                >
            </td>
            <td class="spoilage-stock" data-id="${escapeHtml(String(item.id))}">
                ${spoilageTotal}
            </td>
            <td>
                <input
                    type="number"
                    class="form-control closing-stock"
                    data-id="${escapeHtml(String(item.id))}"
                    value="${closingStock}"
                    placeholder="Enter count"
                    min="0"
                    step="1"
                    required
                >
            </td>
            <td class="consumption" data-id="${escapeHtml(String(item.id))}">—</td>
        `;

        table.appendChild(row);
    });

    updateStockConsumption();
}

document.addEventListener("input", function(event) {
    if (
        event.target.classList.contains("opening-stock") ||
        event.target.classList.contains("closing-stock")
    ) {
        updateStockConsumption();
    }
});

async function getStockCountCsrfToken() {
    let token = sessionStorage.getItem("csrfToken");

    if (token) return token;

    const response = await fetch("../api/auth/me.php", {
        credentials: "same-origin",
        cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || !data.ok || !data.csrf) {
        throw new Error(
            data.error || "Your session may have expired. Please sign in again."
        );
    }

    token = data.csrf;
    sessionStorage.setItem("csrfToken", token);

    return token;
}

async function loadStockCountsFromServer() {
    try {
        const response = await fetch("../Stockcount/stock-counts.php", {
            credentials: "same-origin",
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || !data.ok || !Array.isArray(data.stockCounts)) {
            throw new Error(
                data.error || "Unable to load stock counts from the database."
            );
        }

        stockCounts = data.stockCounts;

        localStorage.setItem(
            "tapsihanStockCounts",
            JSON.stringify(stockCounts)
        );
    } catch (error) {
        console.error("Unable to load stock counts from MySQL:", error);

        alert(
            "Stock counts could not be loaded from the database. " +
            "The displayed data may be outdated. Please check your connection and refresh."
        );
    }

    displayStockTable();
}

let stockForm = document.getElementById("stockForm");

if (stockForm) {
    stockForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        let activeShift = requireActiveShift();

        if (!activeShift) return;

        let stockDate = activeShift.date;
        let shiftId = activeShift.id;

        if (!stockDate || !shiftId) {
            alert("The active shift information is incomplete.");
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
                return String(entry.id) === String(id);
            });

            if (!item || !openingInput) {
                validationError =
                    "Unable to identify an inventory item. Please refresh the page.";
                return;
            }

            let opening = Number(openingInput.value);
            let closing = input.value === "" ? null : Number(input.value);

            let restockTotal = restocks
                .filter(function(restock) {
                    return String(restock.shiftId) === String(shiftId) &&
                        String(restock.itemId) === String(id);
                })
                .reduce(function(total, restock) {
                    return total + Number(restock.quantity || 0);
                }, 0);

            let spoilageTotal = wastes
                .filter(function(waste) {
                    return String(waste.shiftId) === String(shiftId) &&
                        String(waste.itemId) === String(id);
                })
                .reduce(function(total, waste) {
                    return total + Number(waste.quantity || 0);
                }, 0);

            if (!Number.isInteger(opening) || opening < 0) {
                validationError =
                    item.name + " opening stock must be a whole number of 0 or more.";
                return;
            }

            if (closing === null) {
                validationError =
                    "Enter a closing stock count for " + item.name + ".";
                return;
            }

            if (!Number.isInteger(closing) || closing < 0) {
                validationError =
                    item.name + " closing stock must be a whole number of 0 or more.";
                return;
            }

            let availableStock = opening + restockTotal - spoilageTotal;

            if (spoilageTotal > opening + restockTotal) {
                validationError =
                    item.name + " waste cannot exceed opening stock plus restocks.";
                return;
            }

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

            countUpdates.push({
                item: item,
                opening: opening,
                closing: closing
            });
        });

        if (validationError) {
            alert(validationError);
            return;
        }

        if (countUpdates.length === 0) {
            alert("There are no stock counts to save.");
            return;
        }

        let submitButton = stockForm.querySelector('[type="submit"]');
        let originalButtonText = submitButton
            ? submitButton.textContent
            : "";

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Saving...";
        }

        try {
            const token = await getStockCountCsrfToken();

            const response = await fetch("../Stockcount/stock-counts.php", {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": token
                },
                body: JSON.stringify({
                    shiftId: shiftId,
                    counts: countUpdates.map(function(count) {
                        return {
                            itemId: count.item.id,
                            opening: count.opening,
                            closing: count.closing
                        };
                    })
                })
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(
                    result.error || "The server could not save the stock counts."
                );
            }

            if (!Array.isArray(result.stockCounts)) {
                throw new Error(
                    "The server response did not contain the saved stock counts."
                );
            }

            stockCounts = result.stockCounts;

            localStorage.setItem(
                "tapsihanStockCounts",
                JSON.stringify(stockCounts)
            );

            if (result.itemStock && typeof result.itemStock === "object") {
                inventory.forEach(function(item) {
                    let itemCode = displayItemId(item.id);

                    if (
                        Object.prototype.hasOwnProperty.call(
                            result.itemStock,
                            itemCode
                        )
                    ) {
                        item.stock = Number(result.itemStock[itemCode]);
                    }
                });

                saveInventory();
            }

            displayStockTable();

            if (typeof updateDashboard === "function") {
                updateDashboard();
            }

            alert("Stock counts saved successfully to the database.");

        } catch (error) {
            console.error("Stock count save failed:", error);

            alert(
                "Stock counts were not confirmed as saved.\n\n" +
                error.message +
                "\n\nPlease check the connection and reload the counts before trying again."
            );
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });
}

/* Take the shift, stock levels, restocks and waste from MySQL first, so a shift started on the phone
   (or a restock logged there) is seen here without opening the Shift, Restock or Waste page. */
async function initializeStockCountPage() {
    await refreshSharedDataFromServer();
    await loadStockCountsFromServer();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeStockCountPage);
} else {
    initializeStockCountPage();
}
