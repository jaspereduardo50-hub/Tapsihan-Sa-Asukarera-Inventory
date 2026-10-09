/* ==========================================
   RECONCILIATION
   Uses Stock Counts + Portion Mapping
   ========================================== */


/* ------------------------------------------
   DOM Elements
   ------------------------------------------ */

let reconciliationForm =
    document.getElementById("reconciliationForm");

let reconciliationDate =
    document.getElementById("reconciliationDate");

let revenueBreakdownTable =
    document.getElementById("revenueBreakdownTable");

let expectedRevenueInput =
    document.getElementById("expectedRevenue");

let expectedRevenueSummary =
    document.getElementById("expectedRevenueSummary");

let totalDishVolume =
    document.getElementById("totalDishVolume");

let totalDishRevenue =
    document.getElementById("totalDishRevenue");

let reconciliationHistoryTable =
    document.getElementById("reconciliationHistoryTable");

let saveReconciliationButton =
    document.querySelector(
        "#reconciliationForm button[type='submit']"
    );
    
let reconciliationInputsReady = false;

/* Latest egg-based order total for the active shift (saved with the reconciliation) */
let reconciliationOrderSummary = null;

function formatPHP(value) {
    let amount = Number(value) || 0;
    let formattedAmount = Math.abs(amount).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return amount < 0 ? `-₱${formattedAmount}` : `₱${formattedAmount}`;
}

function getReconciliationRecords() {
    try {
        let records = JSON.parse(
            localStorage.getItem("tapsihanReconciliationRecords") || "[]"
        );

        return Array.isArray(records) ? records : [];
    } catch (error) {
        console.error("Unable to load reconciliation history:", error);
        return [];
    }
}

function hasExistingReconciliation(shiftId) {
    if (!shiftId) {
        return false;
    }

    let records = getReconciliationRecords();

    return records.some(function(record) {
        return String(record.shiftId) === String(shiftId);
    });
}

function updateReconciliationSaveButton() {
    if (!saveReconciliationButton) {
        return;
    }

    let activeShift = getReconciliationShift();

    if (!activeShift) {
        saveReconciliationButton.classList.remove("btn-secondary");
        saveReconciliationButton.classList.add("btn-danger");
        saveReconciliationButton.title =
            "Start a shift before saving reconciliation.";
        return;
    }

    let alreadyReconciled =
        hasExistingReconciliation(activeShift.id);

    if (alreadyReconciled) {
        saveReconciliationButton.classList.remove("btn-danger");
        saveReconciliationButton.classList.add("btn-secondary");

        saveReconciliationButton.title =
            "This shift has already been reconciled.";
    } else {
        saveReconciliationButton.classList.remove("btn-secondary");
        saveReconciliationButton.classList.add("btn-danger");

        saveReconciliationButton.title =
            "Save reconciliation for this shift.";
    }
}

function displayReconciliationHistory() {
    if (!reconciliationHistoryTable) return;

    let records = getReconciliationRecords();
    reconciliationHistoryTable.innerHTML = "";

    if (!records.length) {
        let emptyRow = document.createElement("tr");
        emptyRow.innerHTML = `
            <td colspan="4" class="text-center text-muted py-3">
                No reconciliation history recorded yet.
            </td>
        `;
        reconciliationHistoryTable.appendChild(emptyRow);
        return;
    }

    records.forEach(function(record) {
        let row = document.createElement("tr");
        let variance = Number(record.variance) || 0;
        let statusClass = record.status === "SHORTAGE"
            ? "bg-danger"
            : record.status === "OVERAGE"
                ? "bg-success"
                : "bg-secondary";

        row.innerHTML = `
            <td>${escapeHtml(record.date || "")}<br><small class="text-muted">${escapeHtml(record.shiftId || "")}${record.savedAt ? ` · ${escapeHtml(new Date(record.savedAt).toLocaleString("en-PH"))}` : ""}</small></td>
            <td>
                ${formatPHP(record.expectedRevenue)}
                ${record.ordersServed !== null && record.ordersServed !== undefined ? `<br><small class="text-muted">Orders served: ${Number(record.ordersServed)}</small>` : ""}
            </td>
            <td>
                ${formatPHP(record.totalCollected)}
                <br>
                <small class="text-muted">
                    Cash: ${formatPHP(record.actualCash)} · GCash: ${formatPHP(record.actualGcash)}
                </small>
            </td>
            <td class="${variance < 0 ? "text-danger" : variance > 0 ? "text-success" : ""}">
                ${formatPHP(variance)}
                <span class="badge ${statusClass} ms-1">${escapeHtml(record.status || "BALANCED")}</span>
            </td>
        `;
        reconciliationHistoryTable.appendChild(row);
    });
}

window.addEventListener("storage", function(event) {

    if (event.key === "tapsihanReconciliationRecords") {
        displayReconciliationHistory();
        updateReconciliationSaveButton();
    }

    if (
        [
            "portionMappings",
            "tapsihanStockCounts",
            "tapsihanShifts"
        ].includes(event.key)
    ) {
        calculateReconciliationResult();
        updateReconciliationSaveButton();
    }
});


/* ------------------------------------------
   Get Portion Mappings
   ------------------------------------------ */

function getReconciliationMappings() {

    try {

        let mappings =
            JSON.parse(
                localStorage.getItem("portionMappings") || "[]"
            );

        return Array.isArray(mappings)
            ? mappings
            : [];

    } catch (error) {

        console.error(
            "Unable to load portion mappings:",
            error
        );

        return [];

    }

}


/* ------------------------------------------
   Get Stock Counts
   ------------------------------------------ */

function getReconciliationStockCounts() {

    try {

        let counts =
            JSON.parse(
                localStorage.getItem("tapsihanStockCounts") || "[]"
            );

        return Array.isArray(counts)
            ? counts
            : [];

    } catch (error) {

        console.error(
            "Unable to load stock counts:",
            error
        );

        return [];

    }

}


/* ------------------------------------------
   Get Selected Date
   ------------------------------------------ */

function getReconciliationShift() {

    if (typeof getActiveShift !== "function") {
        return null;
    }

    return getActiveShift();

}


function getReconciliationDate() {

    let activeShift =
        getReconciliationShift();

    if (!activeShift) {
        return "";
    }

    return activeShift.date;

}


/* ------------------------------------------
   Find Consumed Quantity
   ------------------------------------------ */

function getConsumedQuantity(
    stockCounts,
    selectedShiftId,
    itemId
) {
    let matchingRecord =
        stockCounts.find(function(record) {

            if (record.shiftId !== selectedShiftId) {
                return false;
            }

            return String(record.itemId) ===
                   String(itemId);
        });

    if (!matchingRecord) {
        return 0;
    }

    return Number(
        matchingRecord.consumed || 0
    );
}


/* ------------------------------------------
   Calculate Dish Volume
   ------------------------------------------ */

function calculateDishVolume(
    mapping,
    stockCounts,
    selectedShiftId
) {

    if (
        !mapping ||
        !Array.isArray(mapping.ingredients) ||
        mapping.ingredients.length === 0
    ) {
        return 0;
    }

    let ingredients = mapping.ingredients.filter(function(ingredient) {
        return ingredient && ingredient.itemId;
    });

    if (!ingredients.length) {
        return 0;
    }

    let possibleDishVolumes = ingredients.map(function(ingredient) {
        let consumed = getConsumedQuantity(
            stockCounts,
            selectedShiftId,
            ingredient.itemId
        );

        let usedPerOrder = Number(ingredient.usedPerOrder);
        if (!Number.isFinite(consumed) || !Number.isFinite(usedPerOrder) || consumed < 0 || usedPerOrder <= 0) {
            return 0;
        }

        return Math.floor(consumed / usedPerOrder);
    });

    // The least-available recipe ingredient limits portions sold.
    return Math.max(0, Math.min(...possibleDishVolumes));

}


/* ------------------------------------------
   Calculate Expected Revenue
   ------------------------------------------ */

function calculateExpectedRevenue() {

    reconciliationInputsReady = false;
    reconciliationOrderSummary = null;
    renderEggOrderSummary(null, 0);

    if (!revenueBreakdownTable) {
        return 0;
    }


    let activeShift =
    getReconciliationShift();

    let selectedDate =
        activeShift
            ? activeShift.date
            : "";

    let selectedShiftId =
        activeShift
            ? activeShift.id
            : "";

    let mappings =
        getReconciliationMappings();

    let stockCounts =
        getReconciliationStockCounts();


    revenueBreakdownTable.innerHTML = "";


    let totalRevenue = 0;

    let totalVolume = 0;

    if (!activeShift) {

        revenueBreakdownTable.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-muted text-center"
                >
                    No active shift.
                    Start a shift before performing reconciliation.
                </td>
            </tr>
        `;

        updateRevenueSummary(
            0,
            0
        );

        return 0;
    }


    if (!selectedDate) {

        revenueBreakdownTable.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-muted text-center"
                >
                    Select a reconciliation date first.
                </td>
            </tr>
        `;

        updateRevenueSummary(
            0,
            0
        );

        return 0;
    }


    if (mappings.length === 0) {

        revenueBreakdownTable.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-muted text-center"
                >
                    No portion mappings found.
                    Add a dish in Portion Mapping first.
                </td>
            </tr>
        `;

        updateRevenueSummary(
            0,
            0
        );

        return 0;
    }


    let requiredIngredients = [];
    mappings.forEach(function(mapping) {
        (Array.isArray(mapping.ingredients) ? mapping.ingredients : []).forEach(function(ingredient) {
            if (ingredient && ingredient.itemId && !requiredIngredients.some(function(existing) {
                return String(existing.itemId) === String(ingredient.itemId);
            })) {
                requiredIngredients.push(ingredient);
            }
        });
    });

    if (!requiredIngredients.length) {
        revenueBreakdownTable.innerHTML = `
            <tr>
                <td colspan="4" class="text-muted text-center">
                    Portion mappings need at least one valid inventory ingredient.
                </td>
            </tr>
        `;
        updateRevenueSummary(0, 0);
        return 0;
    }

    /*
       Eggs are the basis of the total order count, so the egg stock count
       is required even though eggs are not mapped to a dish.
    */
    getEggInventoryItems().forEach(function(eggItem) {
        if (!requiredIngredients.some(function(existing) {
            return String(existing.itemId) === String(eggItem.id);
        })) {
            requiredIngredients.push({
                itemId: eggItem.id,
                name: eggItem.name
            });
        }
    });

    let missingCountIngredients = requiredIngredients.filter(function(ingredient) {
        return !stockCounts.some(function(record) {
            return record.shiftId === selectedShiftId &&
                String(record.itemId) === String(ingredient.itemId) &&
                record.closing !== null &&
                record.closing !== undefined &&
                record.closing !== "" &&
                Number.isInteger(Number(record.closing)) &&
                Number(record.closing) >= 0;
        });
    });

    if (missingCountIngredients.length) {

        revenueBreakdownTable.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-muted text-center"
                >
                    Complete stock counts for mapped ingredients before reconciling:
                    ${escapeHtml(missingCountIngredients.map(function(ingredient) {
                        return ingredient.name;
                    }).join(", "))}
                </td>
            </tr>
        `;

        updateRevenueSummary(
            0,
            0
        );

        return 0;
    }

    reconciliationInputsReady = true;

    mappings.forEach(function(mapping) {

        let volume =
            calculateDishVolume(
                mapping,
                stockCounts,
                selectedShiftId
            );

        let price = Number(mapping.sellingPrice || 0);

        if (!Number.isFinite(price) || price <= 0) {
            return;
        }

        let revenue = volume * price;

        totalVolume += volume;
        totalRevenue += revenue;


        let row =
            document.createElement("tr");


        row.innerHTML = `

            <td>
                ${escapeHtml(mapping.dishName)}
            </td>

            <td>
                ${formatPHP(price)}
            </td>

            <td>
                ${volume}
            </td>

            <td>
                ${formatPHP(revenue)}
            </td>

        `;


        revenueBreakdownTable.appendChild(row);

    });


    updateRevenueSummary(
        totalRevenue,
        totalVolume
    );


    let eggSummary =
        getEggOrderSummary(
            stockCounts,
            selectedShiftId
        );

    renderEggOrderSummary(
        eggSummary,
        totalVolume
    );

    reconciliationOrderSummary = {
        ordersServed: eggSummary && eggSummary.available
            ? eggSummary.orders
            : null,
        dishVolume: totalVolume
    };


    return totalRevenue;

}


/* ------------------------------------------
   Update Revenue Summary
   ------------------------------------------ */

function updateRevenueSummary(
    totalRevenue,
    totalVolume
) {
    let safeRevenue = Number.isFinite(totalRevenue) ? totalRevenue : 0;
    let safeVolume = Number.isFinite(totalVolume) ? totalVolume : 0;

    if (revenueBreakdownTable && !document.getElementById("totalDishVolume")) {
        let totalRow = document.createElement("tr");
        totalRow.className = "fw-bold border-top";
        totalRow.innerHTML = `
            <td colspan="2" class="text-end">Total</td>
            <td id="totalDishVolume">0</td>
            <td id="totalDishRevenue">₱0.00</td>
        `;
        revenueBreakdownTable.appendChild(totalRow);
        totalDishVolume = document.getElementById("totalDishVolume");
        totalDishRevenue = document.getElementById("totalDishRevenue");
    }

    if (expectedRevenueInput) {
        expectedRevenueInput.value = safeRevenue.toFixed(2);
    }

    if (expectedRevenueSummary) {

        expectedRevenueSummary.textContent = formatPHP(totalRevenue);

    }


    if (totalDishVolume) {
        totalDishVolume.textContent = String(safeVolume);
    }

    if (totalDishRevenue) {
        totalDishRevenue.textContent = formatPHP(safeRevenue);
    }

}

function resetReconciliationSummary() {
    if (expectedRevenueInput) {
        expectedRevenueInput.value = "0.00";
    }

    if (expectedRevenueSummary) {
        expectedRevenueSummary.textContent = "₱0.00";
    }

    if (totalDishVolume) {
        totalDishVolume.textContent = "0";
    }

    if (totalDishRevenue) {
        totalDishRevenue.textContent = "₱0.00";
    }

    let cashInput = document.getElementById("actualCash");
    let gcashInput = document.getElementById("actualGcash");

    if (cashInput) cashInput.value = "";
    if (gcashInput) gcashInput.value = "";

    let varianceElement = document.getElementById("variance");
    let totalCollectedElement = document.getElementById("totalCollected");
    let statusElement = document.getElementById("reconciliationStatus");

    if (varianceElement) varianceElement.textContent = "₱0.00";
    if (totalCollectedElement) totalCollectedElement.textContent = "₱0.00";
    if (statusElement) {
        statusElement.textContent = "BALANCED";
        statusElement.style.background = "#666";
    }

    let chart = document.getElementById("reconciliationChart");
    if (chart) {
        chart.innerHTML = `
            <small class="text-muted d-block mb-2">Revenue Comparison</small>
            <div class="mb-3">
                <div class="d-flex justify-content-between">
                    <span>Expected Revenue</span>
                    <strong>₱0.00</strong>
                </div>
                <div style="height: 18px; width: 2%; background: #e52b2b; border-radius: 3px"></div>
            </div>
            <div>
                <div class="d-flex justify-content-between">
                    <span>Total Collected</span>
                    <strong>₱0.00</strong>
                </div>
                <div style="height: 18px; width: 2%; background: #247a4a; border-radius: 3px"></div>
            </div>
        `;
    }
}


/* ------------------------------------------
   Calculate Egg Consumption
   ------------------------------------------ */

function getEggInventoryItems() {

    return inventory.filter(function(item) {

        let category =
            String(item.category || "").trim().toLowerCase();

        let name =
            String(item.name || "").trim().toLowerCase();

        return category === "eggs" ||
               category === "egg" ||
               /\beggs?\b/.test(name);

    });

}


/*
   Every silog meal contains one egg, so the eggs actually used to
   cook meals equal the number of orders served.

   Eggs that were spoiled or wasted were not cooked into an order,
   so logged egg waste is taken out first:

       50 orders served -> 50 eggs used (plus any wasted eggs)

       orders = opening + restocks - waste - closing
*/
function getEggOrderSummary(
    stockCounts,
    selectedShiftId
) {

    let eggItems =
        getEggInventoryItems();

    if (!eggItems.length) {
        return { available: false };
    }

    let summary = {
        available: true,
        orders: 0,
        opening: 0,
        restocks: 0,
        wasted: 0,
        closing: 0
    };

    eggItems.forEach(function(item) {

        let record =
            stockCounts.find(function(entry) {
                return entry.shiftId === selectedShiftId &&
                       String(entry.itemId) === String(item.id);
            });

        if (!record) {
            return;
        }

        let opening = Number(record.opening) || 0;
        let restocks = Number(record.restocks) || 0;
        let wasted = Number(record.spoilage) || 0;
        let closing = Number(record.closing) || 0;

        summary.opening += opening;
        summary.restocks += restocks;
        summary.wasted += wasted;
        summary.closing += closing;

        summary.orders += Math.max(
            0,
            calculateDeductiveConsumption(
                opening,
                restocks,
                wasted,
                closing
            )
        );

    });

    return summary;

}


/* ------------------------------------------
   Render Egg-Based Order Total
   ------------------------------------------ */

function renderEggOrderSummary(
    summary,
    dishVolume
) {

    let container =
        document.getElementById("eggOrderSummary");

    if (!container) {
        return;
    }

    if (!summary) {
        container.innerHTML = "";
        return;
    }

    if (!summary.available) {
        container.innerHTML = `
            <div class="alert alert-warning mb-0">
                No egg item was found in Inventory, so the total number of
                orders cannot be cross-checked against eggs.
            </div>
        `;
        return;
    }

    let difference =
        summary.orders - dishVolume;

    let alertClass = "alert-success";
    let message =
        `The dish volumes above (${dishVolume}) match the egg-based order total.`;

    if (difference > 0) {

        alertClass = "alert-warning";
        message =
            `${difference} order(s) used an egg but are not matched to any dish above ` +
            `(dish volumes total ${dishVolume}). Check the meat stock counts and any ` +
            `spoilage that was not logged before saving.`;

    } else if (difference < 0) {

        alertClass = "alert-warning";
        message =
            `The dish volumes above (${dishVolume}) are ${Math.abs(difference)} higher ` +
            `than the ${summary.orders} orders shown by eggs. Check the egg stock count ` +
            `and egg waste entries.`;

    }

    container.innerHTML = `
        <div class="border rounded p-3">
            <div class="text-muted small fw-bold">
                TOTAL ORDERS SERVED (BASED ON EGGS)
            </div>

            <div class="fs-3 fw-bold">
                ${summary.orders}
            </div>

            <small class="text-muted d-block mb-2">
                Every silog uses 1 egg. Eggs: opening ${summary.opening}
                + restocks ${summary.restocks}
                − waste/spoilage ${summary.wasted}
                − closing ${summary.closing}
                = ${summary.orders} eggs used.
            </small>

            <div class="alert ${alertClass} mb-0 py-2">
                ${escapeHtml(message)}
            </div>
        </div>
    `;

}


/* ------------------------------------------
   Render Reconciliation Chart
   ------------------------------------------ */

function renderReconciliationChart(
    expected,
    collected
) {

    let chart =
        document.getElementById(
            "reconciliationChart"
        );


    if (!chart) {
        return;
    }


    let maximum =
        Math.max(
            expected,
            collected,
            1
        );


    let expectedWidth =
        Math.max(
            2,
            expected / maximum * 100
        );


    let collectedWidth =
        Math.max(
            2,
            collected / maximum * 100
        );


    chart.innerHTML = `

        <small class="text-muted d-block mb-2">
            Revenue Comparison
        </small>


        <div class="mb-3">

            <div class="d-flex justify-content-between">

                <span>
                    Expected Revenue
                </span>

                <strong>${formatPHP(expected)}</strong>

            </div>


            <div
                style="
                    height: 18px;
                    width: ${expectedWidth}%;
                    background: #e52b2b;
                    border-radius: 3px;
                "
            ></div>

        </div>


        <div>

            <div class="d-flex justify-content-between">

                <span>
                    Total Collected
                </span>

                <strong>${formatPHP(collected)}</strong>

            </div>


            <div
                style="
                    height: 18px;
                    width: ${collectedWidth}%;
                    background: #247a4a;
                    border-radius: 3px;
                "
            ></div>

        </div>

    `;

}


/* ------------------------------------------
   Calculate Current Reconciliation
   ------------------------------------------ */

function calculateReconciliationResult() {

    let expected =
        calculateExpectedRevenue();


    let cash =
        Number(
            document.getElementById(
                "actualCash"
            )?.value
        ) || 0;


    let gcash =
        Number(
            document.getElementById(
                "actualGcash"
            )?.value
        ) || 0;


    let totalCollected =
        cash + gcash;

    let varianceElement =
        document.getElementById("variance");

    let totalCollectedElement =
        document.getElementById("totalCollected");

    let statusElement =
        document.getElementById("reconciliationStatus");

    if (totalCollectedElement) {
        totalCollectedElement.textContent = formatPHP(totalCollected);
    }

    if (!reconciliationInputsReady) {
        if (varianceElement) varianceElement.textContent = "—";
        if (statusElement) {
            statusElement.textContent = "NOT READY";
            statusElement.style.background = "#666";
        }

        renderReconciliationChart(expected, totalCollected);
        return {
            expected: expected,
            cash: cash,
            gcash: gcash,
            totalCollected: totalCollected,
            variance: 0,
            status: "NOT READY"
        };
    }

    let variance =
        totalCollected - expected;

    if (varianceElement) {

        varianceElement.textContent = formatPHP(variance);

    }


    if (totalCollectedElement) {

        totalCollectedElement.textContent = formatPHP(totalCollected);

    }


    if (statusElement) {

        if (variance < 0) {

            statusElement.textContent =
                "SHORTAGE";

            statusElement.style.background =
                "#e52b2b";

        } else if (variance > 0) {

            statusElement.textContent =
                "OVERAGE";

            statusElement.style.background =
                "#247a4a";

        } else {

            statusElement.textContent =
                "BALANCED";

            statusElement.style.background =
                "#666";

        }

    }


    renderReconciliationChart(
        expected,
        totalCollected
    );


    return {
        expected: expected,
        cash: cash,
        gcash: gcash,
        totalCollected: totalCollected,
        variance: variance,
        status:
            variance < 0
                ? "SHORTAGE"
                : variance > 0
                    ? "OVERAGE"
                    : "BALANCED"
    };

}



/* ------------------------------------------
   Cash / GCash Change
   ------------------------------------------ */

["actualCash", "actualGcash"].forEach(
    function(id) {

        let input =
            document.getElementById(id);


        if (input) {

            input.addEventListener(
                "input",
                function() {

                    calculateReconciliationResult();

                }
            );

        }

    }
);


/* ------------------------------------------
   Save Reconciliation
   ------------------------------------------ */

if (reconciliationForm) {

    reconciliationForm.addEventListener(
        "submit",
        function(event) {

            event.preventDefault();


            if (!this.checkValidity()) {

                this.reportValidity();

                return;

            }


            let activeShift =
                getReconciliationShift();

            if (!activeShift) {

                alert(
                    "Please start a shift before performing reconciliation."
                );

                return;
            }

            let selectedDate =
                activeShift.date;

            let selectedShiftId =
                activeShift.id;


            if (!selectedDate) {

                alert(
                    "Please select a reconciliation date."
                );

                return;

            }


            let result =
                calculateReconciliationResult();

            if (!reconciliationInputsReady) {
                alert("Complete the portion mappings and stock counts for this shift before saving reconciliation.");
                return;
            }

            let reconciliationRecords = getReconciliationRecords();

            let alreadyReconciled =
                reconciliationRecords.some(function(record) {
                    return String(record.shiftId) ===
                        String(selectedShiftId);
                });

            if (alreadyReconciled) {
                alert(
                    "This shift has already been reconciled.\n\n" +
                    "Only one reconciliation is allowed per shift."
                );

                updateReconciliationSaveButton();

                return;
            }

            let savedAt = new Date().toISOString();
            let newRecord = {
                id: `RECON-${Date.now()}`,
                shiftId:
                    selectedShiftId,

                date:
                    selectedDate,

                expectedRevenue:
                    result.expected,

                actualCash:
                    result.cash,

                actualGcash:
                    result.gcash,

                totalCollected:
                    result.totalCollected,

                variance:
                    result.variance,

                status:
                    result.status,

                ordersServed:
                    reconciliationOrderSummary
                        ? reconciliationOrderSummary.ordersServed
                        : null,

                dishVolume:
                    reconciliationOrderSummary
                        ? reconciliationOrderSummary.dishVolume
                        : null,

                savedAt:
                    savedAt
            };

            let confirmSave = confirm(
                "Are you sure you want to save this reconciliation?\n\n" +
                (newRecord.ordersServed !== null
                    ? "Orders Served (eggs): " + newRecord.ordersServed + "\n"
                    : "") +
                "Expected Revenue: " +
                formatPHP(result.expected) +
                "\nCash: " +
                formatPHP(result.cash) +
                "\nGCash: " +
                formatPHP(result.gcash) +
                "\nTotal Collected: " +
                formatPHP(result.totalCollected) +
                "\nVariance: " +
                formatPHP(result.variance) +
                "\n\n" +
                "A shift can only have one reconciliation."
            );

            if (!confirmSave) {
                return;
            }

            reconciliationRecords.unshift(newRecord);

            let reconciliationSaved = false;
            try {
                localStorage.setItem(
                    "tapsihanReconciliationRecords",
                    JSON.stringify(reconciliationRecords)
                );

                let savedRecords = JSON.parse(
                    localStorage.getItem("tapsihanReconciliationRecords") || "[]"
                );
                if (!Array.isArray(savedRecords) ||
                    !savedRecords.some(function(record) {
                        return record.id === newRecord.id;
                    })) {
                    throw new Error("The reconciliation record could not be confirmed in browser storage.");
                }
                reconciliationSaved = true;

                displayReconciliationHistory();

                let auditTarget = `${selectedShiftId} - ${selectedDate}`;
                let auditDetails =
                    `Expected revenue: ₱${Number(result.expected || 0).toFixed(2)} | Cash: ₱${Number(result.cash || 0).toFixed(2)} | GCash: ₱${Number(result.gcash || 0).toFixed(2)} | Total collected: ₱${Number(result.totalCollected || 0).toFixed(2)} | Variance: ₱${Number(result.variance || 0).toFixed(2)} (${result.status})`;
                addAuditLog(
                    "Reconciliation",
                    "Reconciliation Saved",
                    auditTarget,
                    auditDetails
                );

                let savedAuditLogs = JSON.parse(
                    localStorage.getItem("tapsihanAuditLogs") || "[]"
                );
                if (!Array.isArray(savedAuditLogs) ||
                    !savedAuditLogs.some(function(log) {
                        return log.module === "Reconciliation" &&
                            log.action === "Reconciliation Saved" &&
                            log.target === auditTarget &&
                            log.details === auditDetails;
                    })) {
                    throw new Error("The reconciliation was saved, but its audit entry could not be confirmed.");
                }

                alert("Reconciliation and audit history saved successfully.");
            } catch (error) {
                console.error("Unable to save reconciliation and audit history:", error);
                displayReconciliationHistory();
                alert(
                    (reconciliationSaved
                        ? "Reconciliation was saved, but the audit log was not confirmed. "
                        : "Reconciliation was not saved. ") +
                    error.message +
                    " Check browser storage availability and try again."
                );
            }

        }
    );

}


/* ------------------------------------------
   Initialize Page
   ------------------------------------------ */

function initializeReconciliation() {

    displayReconciliationHistory();

    if (!reconciliationDate) {
        return;
    }

    let activeShift =
        getReconciliationShift();

    /*
       Reconciliation is only available
       while a shift is active.
    */

    if (!activeShift) {

        reconciliationDate.value = "";

        reconciliationDate.disabled = true;

        calculateExpectedRevenue();

        calculateReconciliationResult();

        updateReconciliationSaveButton();

        return;
    }

    /*
       The active shift determines
       the reconciliation date.
    */

    reconciliationDate.value =
        activeShift.date;

    reconciliationDate.disabled = true;

    calculateExpectedRevenue();

    calculateReconciliationResult();

    updateReconciliationSaveButton();
    
}


if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        initializeReconciliation
    );

} else {

    initializeReconciliation();

}