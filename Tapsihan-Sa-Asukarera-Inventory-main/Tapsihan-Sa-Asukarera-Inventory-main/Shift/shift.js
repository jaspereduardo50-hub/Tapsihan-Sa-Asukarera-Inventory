/* ==========================================
   SHIFT MANAGEMENT
   ========================================== */

console.log("SHIFT JS LOADED");


const SHIFT_STORAGE_KEY = "tapsihanShifts";


let shifts = [];
let activeShift = null;


/* ==========================================
   LOAD SHIFTS
   ========================================== */

function loadShifts() {

    try {

        let saved =
            JSON.parse(
                localStorage.getItem(SHIFT_STORAGE_KEY) || "[]"
            );

        shifts = Array.isArray(saved) ? saved : [];

    } catch (error) {

        console.error("Unable to load shifts:", error);

        shifts = [];
    }


    activeShift =
        shifts.find(function(shift) {

            return shift.status === "OPEN";

        }) || null;
}


/* ==========================================
   SAVE SHIFTS
   ========================================== */

function saveShifts() {

    localStorage.setItem(
        SHIFT_STORAGE_KEY,
        JSON.stringify(shifts)
    );
}


/* ==========================================
   FORMAT DATE
   ========================================== */

function formatShiftDate(dateString) {

    if (!dateString) return "—";

    let date = new Date(dateString + "T00:00:00");

    return date.toLocaleDateString("en-PH", {

        year: "numeric",
        month: "long",
        day: "numeric"

    });
}


/* ==========================================
   FORMAT TIME
   ========================================== */

function formatShiftTime(dateTimeString) {

    if (!dateTimeString) return "—";

    let date = new Date(dateTimeString);

    return date.toLocaleTimeString("en-PH", {

        hour: "numeric",
        minute: "2-digit",
        hour12: true

    });
}


/* ==========================================
   FORMAT DURATION
   ========================================== */

function formatDuration(startTime) {

    if (!startTime) return "—";

    let start =
        new Date(startTime).getTime();

    let now =
        new Date().getTime();

    let difference =
        Math.max(0, now - start);

    let totalMinutes =
        Math.floor(difference / 60000);

    let hours =
        Math.floor(totalMinutes / 60);

    let minutes =
        totalMinutes % 60;

    return hours + "h " + minutes + "m";
}


/* ==========================================
   DISPLAY CURRENT SHIFT
   ========================================== */

function displayCurrentShift() {

    let noActiveShift =
        document.getElementById("noActiveShift");

    let activeShiftSection =
        document.getElementById("activeShift");

    let statusBadge =
        document.getElementById("shiftStatusBadge");


    if (!noActiveShift ||
        !activeShiftSection ||
        !statusBadge) {

        return;
    }


    if (!activeShift) {

        noActiveShift.classList.remove("d-none");

        activeShiftSection.classList.add("d-none");

        statusBadge.textContent =
            "NO ACTIVE SHIFT";

        statusBadge.className =
            "badge bg-secondary";

        return;
    }


    noActiveShift.classList.add("d-none");

    activeShiftSection.classList.remove("d-none");


    statusBadge.textContent =
        "OPEN";

    statusBadge.className =
        "badge bg-success";


    let activeShiftDate =
        document.getElementById("activeShiftDate");

    let activeShiftStart =
        document.getElementById("activeShiftStart");

    let activeShiftDuration =
        document.getElementById("activeShiftDuration");


    if (activeShiftDate) {

        activeShiftDate.textContent =
            formatShiftDate(activeShift.date);

    }


    if (activeShiftStart) {

        activeShiftStart.textContent =
            formatShiftTime(activeShift.startTime);

    }


    if (activeShiftDuration) {

        activeShiftDuration.textContent =
            formatDuration(activeShift.startTime);

    }
}


/* ==========================================
   DISPLAY SHIFT HISTORY
   ========================================== */

function displayShiftHistory() {

    let table =
        document.getElementById("shiftHistoryTable");

    if (!table) return;


    table.innerHTML = "";


    let closedShifts =
        shifts.filter(function(shift) {

            return shift.status === "CLOSED";

        });


    if (closedShifts.length === 0) {

        table.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    class="text-center text-muted py-4"
                >
                    No completed shifts yet.
                </td>
            </tr>
        `;

        return;
    }


    closedShifts.forEach(function(shift) {

        let row =
            document.createElement("tr");


        row.innerHTML = `
            <td>
                ${formatShiftDate(shift.date)}
            </td>

            <td>
                ${formatShiftTime(shift.startTime)}
            </td>

            <td>
                ${formatShiftTime(shift.endTime)}
            </td>

            <td>
                <span class="badge bg-secondary">
                    ${shift.status}
                </span>
            </td>
        `;


        table.appendChild(row);

    });
}


/* ==========================================
   START SHIFT
   ========================================== */

function startShift() {
    if (activeShift) {
        alert("There is already an active shift.");
        return;
    }

    let now = new Date();

    let date =
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0");

    let previousClosedShift = shifts
        .filter(function(shift) {
            return shift.status === "CLOSED";
        })
        .sort(function(first, second) {
            return String(second.endTime || second.startTime).localeCompare(
                String(first.endTime || first.startTime)
            );
        })[0];

    let openingStocks = {};

    inventory.forEach(function(item) {
        /*
        * Opening stock is the actual inventory balance
        * immediately before the shift starts.
        *
        * This includes any pre-shift restocks that
        * were already added to Inventory.
        */
        openingStocks[item.id] =
            Math.max(0, Number(item.stock) || 0);
    });

    let newShift = {
        id: "SHIFT-" + Date.now(),
        date: date,
        startTime: now.toISOString(),
        endTime: null,
        status: "OPEN",
        openingStocks: openingStocks
    };

    shifts.unshift(newShift);

    activeShift = newShift;

    saveShifts();

    displayCurrentShift();
    displayShiftHistory();

    alert(
        "Shift started successfully!\n\n" +
        "Opening stock has been carried forward. Record a closing count for every item before ending the shift."
    );
}


/* ==========================================
   END SHIFT
   ========================================== */

function endShift() {

    if (!activeShift) {
        alert("There is no active shift to close.");
        return;
    }

    let countRecords = getStockCountsLedger();
    let missingCounts = inventory.filter(function(item) {
        return !countRecords.some(function(record) {
            return record.shiftId === activeShift.id &&
                record.itemId === item.id &&
                record.closing !== null &&
                record.closing !== undefined &&
                record.closing !== "" &&
                Number.isInteger(Number(record.closing)) &&
                Number(record.closing) >= 0;
        });
    });

    if (missingCounts.length) {
        alert(
            "Record a valid closing stock count for every inventory item before closing the shift:\n\n" +
            missingCounts.map(function(item) { return item.name; }).join(", ")
        );
        return;
    }

    /*
       ------------------------------------------
       Check if reconciliation was completed
       for the current shift
       ------------------------------------------
    */

    let reconciliationRecords = [];

    try {
        reconciliationRecords =
            JSON.parse(
                localStorage.getItem(
                    "tapsihanReconciliationRecords"
                ) || "[]"
            );

        if (!Array.isArray(reconciliationRecords)) {
            reconciliationRecords = [];
        }

    } catch (error) {
        reconciliationRecords = [];
    }

    let reconciliation =
        reconciliationRecords.find(function(record) {
            return record.shiftId === activeShift.id;
        });

    if (!reconciliation) {

        alert(
            "Please complete reconciliation before closing the shift."
        );

        return;
    }

    /*
       ------------------------------------------
       Confirm Shift Closure
       ------------------------------------------
    */

    let confirmClose = confirm(
        "Are you sure you want to close this shift?\n\n" +
        "Expected Revenue: ₱" +
        Number(reconciliation.expectedRevenue || 0)
            .toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) +
        "\nTotal Collected: ₱" +
        Number(reconciliation.totalCollected || 0)
            .toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) +
        "\nVariance: ₱" +
        Number(reconciliation.variance || 0)
            .toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
    );

    if (!confirmClose) {
        return;
    }

    /*
       ------------------------------------------
       Close the Shift
       ------------------------------------------
    */

    let now = new Date();

    activeShift.endTime =
        now.toISOString();

    activeShift.status = "CLOSED";

    /*
       Keep a reference to the reconciliation
       used to close this shift.
    */

    saveShifts();

    /*
       Refresh active shift
    */

    activeShift = null;

    if (typeof resetReconciliationSummary === "function") {
        resetReconciliationSummary();
    }

    displayCurrentShift();
    displayShiftHistory();

    alert("Shift closed successfully!");
}


/* ==========================================
   EVENT LISTENERS
   ========================================== */

document.addEventListener("DOMContentLoaded", function () {

    let startShiftBtn =
        document.getElementById("startShiftBtn");

    let endShiftBtn =
        document.getElementById("endShiftBtn");

    if (startShiftBtn) {
        startShiftBtn.addEventListener("click", function () {
            startShift();
        });
    }

    if (endShiftBtn) {
        endShiftBtn.addEventListener("click", function () {
            endShift();
        });
    }

});


/* ==========================================
   UPDATE ACTIVE SHIFT DURATION
   ========================================== */

setInterval(function() {

    if (!activeShift) return;

    let duration =
        document.getElementById(
            "activeShiftDuration"
        );

    if (duration) {

        duration.textContent =
            formatDuration(
                activeShift.startTime
            );

    }

}, 60000);


/* ==========================================
   INITIALIZATION
   ========================================== */

function initializeShift() {

    loadShifts();

    displayCurrentShift();

    displayShiftHistory();

}


if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        initializeShift
    );

} else {

    initializeShift();

}