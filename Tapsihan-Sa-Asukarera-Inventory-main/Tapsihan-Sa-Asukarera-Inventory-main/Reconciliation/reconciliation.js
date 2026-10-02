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

    let mainIngredient =
        mapping.ingredients.find(function(ingredient) {
            return String(ingredient.name)
                .trim()
                .toLowerCase() !== "egg";
        });

    if (!mainIngredient || !mainIngredient.itemId) {
        return 0;
    }

    let consumed =
        getConsumedQuantity(
            stockCounts,
            selectedShiftId,
            mainIngredient.itemId
        );

    let usedPerOrder =
        Number(mainIngredient.usedPerOrder);

    if (!Number.isFinite(consumed) || !Number.isFinite(usedPerOrder) || consumed <= 0 || usedPerOrder <= 0) {
        return 0;
    }

    return Math.max(0, Math.floor(consumed / usedPerOrder));

}


/* ------------------------------------------
   Calculate Expected Revenue
   ------------------------------------------ */

function calculateExpectedRevenue() {

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


    let hasStockCount =
    stockCounts.some(function(record) {

        return record.shiftId === selectedShiftId;

    });


    if (!hasStockCount) {

        revenueBreakdownTable.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-muted text-center"
                >
                    No stock count has been recorded
                    for this date.
                </td>
            </tr>
        `;

        updateRevenueSummary(
            0,
            0
        );

        return 0;
    }


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
                ₱${price.toLocaleString(
                    "en-PH",
                    {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }
                )}
            </td>

            <td>
                ${volume}
            </td>

            <td>
                ₱${revenue.toLocaleString(
                    "en-PH",
                    {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }
                )}
            </td>

        `;


        revenueBreakdownTable.appendChild(row);

    });


    updateRevenueSummary(
        totalRevenue,
        totalVolume
    );


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

    if (expectedRevenueInput) {
        expectedRevenueInput.value = safeRevenue.toFixed(2);
    }

    if (expectedRevenueSummary) {

        expectedRevenueSummary.textContent =
            "₱" +
            totalRevenue.toLocaleString(
                "en-PH",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            );

    }


    if (totalDishVolume) {
        totalDishVolume.textContent = String(safeVolume);
    }

    if (totalDishRevenue) {
        totalDishRevenue.textContent =
            "₱" +
            safeRevenue.toLocaleString(
                "en-PH",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            );
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

function calculateExpectedEggConsumption(
    totalDishVolume
) {

    /*
       Every silog meal contains
       one egg.

       Therefore:

       45 silog orders
       × 1 egg
       = 45 eggs
    */

    return totalDishVolume;

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

                <strong>
                    ₱${expected.toLocaleString(
                        "en-PH",
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        }
                    )}
                </strong>

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

                <strong>
                    ₱${collected.toLocaleString(
                        "en-PH",
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        }
                    )}
                </strong>

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


    let variance =
        totalCollected - expected;


    let varianceElement =
        document.getElementById(
            "variance"
        );


    let totalCollectedElement =
        document.getElementById(
            "totalCollected"
        );


    let statusElement =
        document.getElementById(
            "reconciliationStatus"
        );


    if (varianceElement) {

        varianceElement.textContent =
            "₱" +
            variance.toLocaleString(
                "en-PH",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            );

    }


    if (totalCollectedElement) {

        totalCollectedElement.textContent =
            "₱" +
            totalCollected.toLocaleString(
                "en-PH",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            );

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


            let reconciliationRecords =
                [];


            try {

                reconciliationRecords =
                    JSON.parse(
                        localStorage.getItem(
                            "tapsihanReconciliationRecords"
                        ) || "[]"
                    );


                if (
                    !Array.isArray(
                        reconciliationRecords
                    )
                ) {

                    reconciliationRecords = [];

                }

            } catch (error) {

                reconciliationRecords = [];

            }


            let existingIndex =
                reconciliationRecords.findIndex(function(record) {
                    return record.shiftId === selectedShiftId;
                });

            let newRecord = {
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
                    result.status
            };

            if (existingIndex >= 0) {
                reconciliationRecords.splice(
                    existingIndex,
                    1,
                    newRecord
                );
            } else {
                reconciliationRecords.unshift(newRecord);
            }


            localStorage.setItem(
                "tapsihanReconciliationRecords",
                JSON.stringify(
                    reconciliationRecords
                )
            );

            addAuditLog(
                "Reconciliation",
                "Reconciliation Saved",
                `${selectedShiftId} - ${selectedDate}`,
                `Expected revenue: ₱${Number(result.expected || 0).toFixed(2)} | Total collected: ₱${Number(result.totalCollected || 0).toFixed(2)} | Variance: ₱${Number(result.variance || 0).toFixed(2)}`
            );


            alert(
                "Reconciliation calculated and saved successfully!"
            );

        }
    );

}


/* ------------------------------------------
   Initialize Page
   ------------------------------------------ */

function initializeReconciliation() {

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
}


if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        initializeReconciliation
    );

} else {

    initializeReconciliation();

}