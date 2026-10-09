// 1. Authentication Guard: Redirect to login if user is not logged in
let currentUser = null;
try {
    currentUser = JSON.parse(sessionStorage.getItem("currentUser"));
} catch (error) {
    sessionStorage.removeItem("currentUser");
}

const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }

    inactivityTimer = setTimeout(function() {
        sessionStorage.removeItem("currentUser");
        alert("Session expired due to inactivity. Please log in again.");
        window.location.href = "../Login/login.html";
    }, INACTIVITY_TIMEOUT_MS);
}

["click", "keydown", "mousemove", "scroll", "touchstart"].forEach(function(eventName) {
    document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

resetInactivityTimer();

document.addEventListener("input", function(event) {
    let field = event.target;
    let isTextField = field instanceof HTMLTextAreaElement ||
        field instanceof HTMLInputElement && ["text", "search"].includes(field.type);

    if (!isTextField || !field.value) return;

    let firstCharacterIndex = field.value.search(/\S/);
    if (firstCharacterIndex < 0) return;

    let firstCharacter = field.value.charAt(firstCharacterIndex);
    let uppercaseCharacter = firstCharacter.toUpperCase();
    if (firstCharacter === uppercaseCharacter) return;

    let selectionStart = field.selectionStart;
    let selectionEnd = field.selectionEnd;
    let selectionDirection = field.selectionDirection;
    let lengthDifference = uppercaseCharacter.length - firstCharacter.length;

    field.value =
        field.value.slice(0, firstCharacterIndex) +
        uppercaseCharacter +
        field.value.slice(firstCharacterIndex + firstCharacter.length);

    if (selectionStart !== null && selectionEnd !== null) {
        field.setSelectionRange(
            Math.max(0, selectionStart + (selectionStart > firstCharacterIndex ? lengthDifference : 0)),
            Math.max(0, selectionEnd + (selectionEnd > firstCharacterIndex ? lengthDifference : 0)),
            selectionDirection
        );
    }
});

document.querySelectorAll("form").forEach(function(form) {
    form.addEventListener("submit", function(event) {
        if (!form.checkValidity()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            form.classList.add("was-validated");
            form.reportValidity();
        }
    }, true);
});

if (!currentUser || !["owner", "manager", "staff"].includes(currentUser.role) || currentUser.active === false) {
    sessionStorage.removeItem("currentUser");
    currentUser = { role: "guest", name: "Guest", active: false };
    window.location.replace("../Login/login.html");
}

let roleAccess = {
    owner: ["dashboard", "inventory", "portionmapping", "stock", "restock", "waste", "suppliers", "shift", "reconciliation", "reports", "history", "audit"],
    manager: ["dashboard", "inventory", "portionmapping", "stock", "restock", "waste", "suppliers", "shift", "reconciliation", "reports", "history"],
    staff: ["dashboard", "inventory", "shift", "stock", "restock", "waste", "suppliers", "reconciliation"]
};

let activePage = document.body.getAttribute("data-page");
if (activePage && roleAccess[currentUser.role] && !roleAccess[currentUser.role].includes(activePage)) {
    alert("Access denied. You do not have permission to open this page.");
    window.location.replace("../Dashboard/dashboard.html");
}

function applyRoleAccess() {
    document.querySelectorAll(".nav-link").forEach(function(link) {
        let page = link.getAttribute("data-page");
        let allowed = roleAccess[currentUser.role] ? roleAccess[currentUser.role].includes(page) : false;
        link.classList.toggle("d-none", !allowed);
    });

    document.querySelectorAll("[data-page-button]").forEach(function(button) {
        let page = button.getAttribute("data-page-button");
        let allowed = roleAccess[currentUser.role] ? roleAccess[currentUser.role].includes(page) : false;
        button.classList.toggle("d-none", !allowed);
    });

    document.querySelectorAll("[data-owner-only]").forEach(function(element) {
        element.classList.toggle("d-none", currentUser.role !== "owner");
    });

    // Update User Info in Sidebar & Header
    let userStrong = document.querySelector(".user strong");
    let userSmall = document.querySelector(".user small");
    let avatar = document.querySelector(".avatar");
    let badge = document.querySelector(".owner-badge");

    if (userStrong) userStrong.textContent = currentUser.name;
    if (userSmall) userSmall.textContent = currentUser.role === "owner" ? "Administrator" : currentUser.role === "manager" ? "Operations Manager" : "Staff";
    if (avatar) avatar.textContent = currentUser.role === "owner" ? "O" : "S";
    if (badge) badge.textContent = currentUser.role.toUpperCase();
}

function logout() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    sessionStorage.removeItem("currentUser");
    window.location.href = "../Login/login.html";
}

let logoutBtn = document.getElementById("logoutButton");
if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function displayItemId(id) {
    return String(id);
}

let inventorySeed = [
    { id: "RM-001", name: "Beef Tapa", category: "Meats", unit: "portions", stock: 38, minimum: 20 },
    { id: "RM-002", name: "Chicken Fillet", category: "Meats", unit: "portions", stock: 28, minimum: 15 },
    { id: "RM-003", name: "Hotdog", category: "Meats", unit: "pieces", stock: 12, minimum: 20 },
    { id: "RM-004", name: "Rice", category: "Rice", unit: "kilograms", stock: 18, minimum: 10 },
    { id: "RM-005", name: "Eggs", category: "Eggs", unit: "pieces", stock: 34, minimum: 30 },
    { id: "RM-006", name: "Soy Sauce", category: "Condiments", unit: "packs", stock: 8, minimum: 5 },
    { id: "RM-007", name: "Calamansi", category: "Other", unit: "pieces", stock: 16, minimum: 10 }
];

function normalizeInventoryItem(item) {
    let suppliers = Array.isArray(item.suppliers) ? item.suppliers.map(function(supplier) {
        return supplier ? {
            name: String(supplier.name || "").trim(),
            contact: String(supplier.contact || "").trim()
        } : null;
    }) : [];

    return {
        id: String(item.id || ""),
        name: String(item.name || "").trim(),
        category: String(item.category || "Other"),
        unit: String(item.unit || "pieces"),
        stock: Math.max(0, Number(item.stock) || 0),
        minimum: Math.max(1, Number(item.minimum) || 1),
        suppliers: suppliers
    };
}

function loadInventory() {
    try {
        let saved = localStorage.getItem("tapsihanInventory");
        if (!saved) {
            let legacyState = JSON.parse(localStorage.getItem("inventoryState") || "null");
            saved = legacyState && Array.isArray(legacyState.inventory) ? JSON.stringify(legacyState.inventory) : null;
        }

        let parsed = saved ? JSON.parse(saved) : inventorySeed;
        return Array.isArray(parsed) ? parsed.map(normalizeInventoryItem).filter(function(item) { return item.id && item.name; }) : inventorySeed.map(normalizeInventoryItem);
    } catch (error) {
        return inventorySeed.map(normalizeInventoryItem);
    }
}

let inventory = loadInventory();
let archivedInventory = [];
try {
    let savedArchives = JSON.parse(localStorage.getItem("tapsihanArchivedInventory") || "[]");
    archivedInventory = Array.isArray(savedArchives) ? savedArchives : [];
} catch (error) {
    localStorage.removeItem("tapsihanArchivedInventory");
}

function saveInventory() {
    localStorage.setItem("tapsihanInventory", JSON.stringify(inventory));
    localStorage.setItem("tapsihanArchivedInventory", JSON.stringify(archivedInventory));
}

function loadLegacyInventoryState() {
    try {
        let saved = JSON.parse(localStorage.getItem("inventoryState") || "null");
        return saved && typeof saved === "object" ? saved : null;
    } catch (error) {
        return null;
    }
}

function loadLedger(key, legacyProperty) {
    try {
        let savedValue = localStorage.getItem(key);
        if (savedValue) {
            let saved = JSON.parse(savedValue);
            return Array.isArray(saved) ? saved : [];
        }

        let legacyState = loadLegacyInventoryState();
        return legacyState && Array.isArray(legacyState[legacyProperty]) ? legacyState[legacyProperty] : [];
    } catch (error) {
        localStorage.removeItem(key);
        return [];
    }
}

function saveLedger(key, entries) {
    localStorage.setItem(key, JSON.stringify(entries));
}

let restocks = loadLedger("tapsihanRestocks", "restocks");
let wastes = loadLedger("tapsihanWastes", "wastes");
let stockCounts = getStockCountsLedger();

let systemAuditLogs = [];

let savedAuditLogs = localStorage.getItem("tapsihanAuditLogs");
if (savedAuditLogs) {
    try {
        let parsedAuditLogs = JSON.parse(savedAuditLogs);
        if (Array.isArray(parsedAuditLogs)) systemAuditLogs = parsedAuditLogs.concat(systemAuditLogs);
    } catch (error) {
        localStorage.removeItem("tapsihanAuditLogs");
    }
}

let today = new Date();

function getLocalDateString(date) {
    let year = date.getFullYear();
    let month = String(date.getMonth() + 1).padStart(2, "0");
    let day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

let todayString = getLocalDateString(today);

function getStockCountsLedger() {
    try {
        let savedValue = localStorage.getItem("tapsihanStockCounts");
        if (savedValue) {
            let saved = JSON.parse(savedValue);
            return Array.isArray(saved) ? saved : [];
        }

        let legacyState = loadLegacyInventoryState();
        return legacyState && Array.isArray(legacyState.stockCounts) ? legacyState.stockCounts : [];
    } catch (error) {
        localStorage.removeItem("tapsihanStockCounts");
        return [];
    }
}

function saveStockCountsLedger(entries) {
    localStorage.setItem("tapsihanStockCounts", JSON.stringify(entries));
}

function getShiftOpeningStock(shift, item) {
    let openingStocks = shift && shift.openingStocks;
    let openingStock = openingStocks && openingStocks[item.id];

    if (openingStock !== null && openingStock !== undefined && openingStock !== "" &&
        Number.isInteger(Number(openingStock)) && Number(openingStock) >= 0) {
        return Number(openingStock);
    }

    return Math.max(0, Number(item.stock) || 0);
}

function calculateDeductiveConsumption(opening, restocks, spoilage, closing) {
    let openingValue = Number(opening) || 0;
    let restocksValue = Number(restocks) || 0;
    let spoilageValue = Number(spoilage) || 0;
    let closingValue = Number(closing) || 0;

    return (openingValue + restocksValue) - spoilageValue - closingValue;
}

function validateStockCountRow(itemName, opening, closing, restocks) {
    let openingValue = Number(opening) || 0;
    let closingValue = Number(closing) || 0;
    let restockValue = Number(restocks) || 0;

    if (closingValue > openingValue + restockValue && restockValue <= 0) {
        return `${itemName} closing stock cannot exceed opening stock + restocks unless a restock entry is logged.`;
    }

    return "";
}

if (document.getElementById("stockDate")) document.getElementById("stockDate").value = todayString;
if (document.getElementById("restockDate")) document.getElementById("restockDate").value = todayString;
if (document.getElementById("wasteDate")) document.getElementById("wasteDate").value = todayString;
if (document.getElementById("stockShift")) document.getElementById("stockShift").value = "Opening Shift";

// ==========================================
// ACTIVE SHIFT CONTEXT
// ==========================================

function getActiveShift() {
    try {
        let savedShifts = JSON.parse(
            localStorage.getItem("tapsihanShifts") || "[]"
        );

        if (!Array.isArray(savedShifts)) {
            return null;
        }

        let activeShift = savedShifts.find(function(shift) {
            return shift.status === "OPEN";
        }) || null;

        if (activeShift) {
            if (!activeShift.openingStocks || typeof activeShift.openingStocks !== "object") {
                activeShift.openingStocks = {};
            }
            let openingStocksUpdated = false;

            inventory.forEach(function(item) {
                let currentOpening = activeShift.openingStocks[item.id];
                if (currentOpening !== null && currentOpening !== undefined && currentOpening !== "" &&
                    Number.isInteger(Number(currentOpening)) && Number(currentOpening) >= 0) {
                    return;
                }

                let existingCount = stockCounts.find(function(count) {
                    return count.shiftId === activeShift.id &&
                        count.itemId === item.id &&
                        count.opening !== null &&
                        count.opening !== undefined &&
                        count.opening !== "" &&
                        Number.isInteger(Number(count.opening)) &&
                        Number(count.opening) >= 0;
                });

                activeShift.openingStocks[item.id] = existingCount
                    ? Number(existingCount.opening)
                    : Math.max(0, Number(item.stock) || 0);
                openingStocksUpdated = true;
            });

            if (openingStocksUpdated) {
                localStorage.setItem("tapsihanShifts", JSON.stringify(savedShifts));
            }
        }

        return activeShift;

    } catch (error) {
        console.error("Unable to load active shift:", error);
        return null;
    }
}

function getActiveShiftId() {
    let shift = getActiveShift();
    return shift ? shift.id : null;
}

function requireActiveShift() {
    let shift = getActiveShift();

    if (!shift) {
        alert("Please start a shift before performing this operation.");
        return null;
    }

    return shift;
}

// ==========================================
// LOCKED LEDGER ENTRIES
// A restock or waste entry can only be edited or removed while the shift
// it belongs to is still open. Once that shift is closed, the entry is part
// of the shift's stock count and reconciliation, so it must not change.
// ==========================================

const LOCKED_ENTRY_MESSAGE =
    "This entry belongs to a shift that has already ended, so it can no longer be edited or removed.";

function readSavedShifts() {
    try {
        let saved = JSON.parse(localStorage.getItem("tapsihanShifts") || "[]");
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function isLedgerEntryLocked(entry) {
    if (!entry) return true;

    let savedShifts = readSavedShifts();

    // Entry recorded during a shift: editable only while that shift is OPEN.
    if (entry.shiftId) {
        let shift = savedShifts.find(function(savedShift) {
            return savedShift.id === entry.shiftId;
        });
        return !shift || shift.status !== "OPEN";
    }

    // Entry recorded with no active shift (a pre-shift restock): it is part of
    // the opening stock of the next shift, so it locks once any shift has
    // started after it was recorded.
    let recordedAt = entry.recordedAt ? new Date(entry.recordedAt).getTime() : NaN;
    if (Number.isFinite(recordedAt)) {
        return savedShifts.some(function(savedShift) {
            let startedAt = new Date(savedShift.startTime).getTime();
            return Number.isFinite(startedAt) && startedAt >= recordedAt;
        });
    }

    // Older entries with no shift and no timestamp: lock anything before today.
    return String(entry.date || "") < todayString;
}

let navLinks = document.querySelectorAll(".nav-link");
let pages = document.querySelectorAll(".page");
let pageTitle = document.getElementById("pageTitle");

function showPage(pageName) {
    // If multiple section pages exist in a single file
    if (pages.length > 1) {
        pages.forEach(function(page) {
            page.classList.add("d-none");
        });

        let selectedPage = document.getElementById(pageName);
        if (selectedPage) {
            selectedPage.classList.remove("d-none");
        }
    } else if (pages.length === 1) {
        // Multi-file HTML setup: keep current section visible
        pages[0].classList.remove("d-none");
    }

    navLinks.forEach(function(link) {
        if (link.getAttribute("data-page") === pageName) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    let titles = {
        dashboard: "Dashboard",
        inventory: "Inventory Catalog",
        portionmapping: "Portion Mapping",
        stock: "Stock Counts",
        restock: "Restocks",
        waste: "Waste / Spoilage",
        suppliers: "Suppliers",
        reconciliation: "Reconciliation",
        reports: "Reports",
        history: "Transaction History",
        audit: "System Audit Log"
    };

    if (pageTitle && titles[pageName]) {
        pageTitle.textContent = titles[pageName];
    }

    let sidebarEl = document.getElementById("sidebar");
    if (sidebarEl) sidebarEl.classList.remove("show");
}

// Sidebar toggle & dismiss logic
const sidebar = document.getElementById("sidebar");
const menuButton = document.getElementById("menuButton");

if (menuButton && sidebar) {
    menuButton.addEventListener("click", function(event) {
        event.stopPropagation();
        sidebar.classList.toggle("show");
    });

    document.addEventListener("click", function(event) {
        if (sidebar.classList.contains("show") && !sidebar.contains(event.target) && !menuButton.contains(event.target)) {
            sidebar.classList.remove("show");
        }
    });

    document.addEventListener("keydown", function(event) {
        if (event.key === "Escape" && sidebar.classList.contains("show")) {
            sidebar.classList.remove("show");
        }
    });
}

function updateDashboard() {
    let totalItemsEl = document.getElementById("totalItems");
    if (!totalItemsEl) return;

    totalItemsEl.textContent = inventory.length;

    let lowStockItems = inventory.filter(function(item) {
        return item.stock < item.minimum;
    });

    if (document.getElementById("lowStock")) document.getElementById("lowStock").textContent = lowStockItems.length;
    if (document.getElementById("reportLowStock")) document.getElementById("reportLowStock").textContent = lowStockItems.length;

    let wasteCount = 0;
    wastes.forEach(function(waste) {
        if (waste.date === todayString) {
            wasteCount += Number(waste.quantity);
        }
    });

    if (document.getElementById("wasteToday")) document.getElementById("wasteToday").textContent = wasteCount;

    let restockedCount = 0;
    restocks.forEach(function(restock) {
        if (restock.date === todayString) {
            restockedCount += Number(restock.quantity);
        }
    });

    if (document.getElementById("restockedToday")) document.getElementById("restockedToday").textContent = restockedCount;
    if (document.getElementById("reportTotalItems")) document.getElementById("reportTotalItems").textContent = inventory.length;
    if (document.getElementById("reportWasteToday")) document.getElementById("reportWasteToday").textContent = wasteCount;
    if (document.getElementById("reportRestockedToday")) document.getElementById("reportRestockedToday").textContent = restockedCount;

    let reportTable = document.getElementById("reportInventoryTable");
    if (reportTable) {
        reportTable.innerHTML = "";
        inventory.forEach(function(item) {
            let reportRow = document.createElement("tr");
            let low = item.stock < item.minimum;

            reportRow.innerHTML = `
                <td>${item.name}</td>
                <td>${item.stock} ${item.unit}</td>
                <td>
                    <span class="badge ${low ? "bg-danger" : "bg-success"}">
                        ${low ? "Low Stock" : "In Stock"}
                    </span>
                </td>
            `;
            reportTable.appendChild(reportRow);
        });
    }

    let dashboardTable = document.getElementById("dashboardInventory");
    if (dashboardTable) {
        dashboardTable.innerHTML = "";
        inventory.forEach(function(item) {
            let low = item.stock < item.minimum;
            let row = document.createElement("tr");

            row.innerHTML = `
                <td>
                    ${item.name}<br>
                    <small>${escapeHtml(displayItemId(item.id))}</small>
                </td>
                <td>${item.category}</td>
                <td>${item.stock} ${item.unit}</td>
                <td>${item.minimum}</td>
                <td>
                    <span class="badge ${low ? "bg-danger" : "bg-success"}">
                        ${low ? "LOW" : "OK"}
                    </span>
                </td>
            `;
            dashboardTable.appendChild(row);
        });
    }
}

function getPortionMappings() {
    try {
        let savedMappings = JSON.parse(
            localStorage.getItem("portionMappings") || "[]"
        );

        return Array.isArray(savedMappings) ? savedMappings : [];
    } catch (error) {
        return [];
    }
}

function getReportMappings() {
    return getPortionMappings().map(function(mapping) {
        return {
            dishName: mapping.dishName,
            sellingPrice: Number(mapping.sellingPrice) || 0,
            volume: Number(mapping.volumeSold ?? mapping.estimatedServings ?? 0),
            date: mapping.volumeDate || todayString
        };
    });
}

function formatReportDate(dateValue) {
    if (!dateValue) return "";

    let parts = dateValue.split("-").map(Number);
    if (parts.length !== 3 || parts.some(function(part) { return !Number.isInteger(part); })) {
        return dateValue;
    }

    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function getReportPeriodLabel() {
    let period = document.getElementById("bestSellerPeriod")?.value || "daily";
    let todayDate = new Date();
    let today = getLocalDateString(todayDate);

    if (period === "daily") {
        return `Report date: ${formatReportDate(today)}`;
    }

    if (period === "weekly" || period === "monthly") {
        let startDate = new Date(todayDate);
        startDate.setDate(startDate.getDate() - (period === "weekly" ? 6 : 29));
        let periodName = period === "weekly" ? "Weekly report period" : "Monthly report period";
        return `${periodName}: ${formatReportDate(getLocalDateString(startDate))} – ${formatReportDate(today)}`;
    }

    let from = document.getElementById("reportFrom")?.value || "";
    let to = document.getElementById("reportTo")?.value || "";
    if (!from && !to) return "Custom report period: All dates";
    return `Custom report period: ${from ? formatReportDate(from) : "No start date"} – ${to ? formatReportDate(to) : "No end date"}`;
}

function getBestSellerRows() {
    let period = document.getElementById("bestSellerPeriod")?.value || "daily";
    let from = document.getElementById("reportFrom")?.value || "";
    let to = document.getElementById("reportTo")?.value || "";
    let startDate = new Date(todayString);

    if (period === "weekly") startDate.setDate(startDate.getDate() - 6);
    if (period === "monthly") startDate.setDate(startDate.getDate() - 29);
    let startDateString = getLocalDateString(startDate);

    let rows = getReportMappings().filter(function(mapping) {
        if (period === "custom") return (!from || mapping.date >= from) && (!to || mapping.date <= to);
        return mapping.date >= startDateString && mapping.date <= todayString;
    });

    return rows.map(function(mapping) {
        return {
            dishName: mapping.dishName,
            volume: mapping.volume,
            price: mapping.sellingPrice,
            revenue: mapping.volume * mapping.sellingPrice
        };
    }).sort(function(first, second) {
        return second.volume - first.volume || second.revenue - first.revenue;
    });
}

function renderReports() {
    let table = document.getElementById("bestSellerTable");
    if (!table) return;

    let periodLabel = document.getElementById("reportPeriodLabel");
    if (periodLabel) periodLabel.textContent = getReportPeriodLabel();

    let rows = getBestSellerRows();
    let totalRevenue = rows.reduce(function(total, row) { return total + row.revenue; }, 0);
    let expectedEl = document.getElementById("reportExpectedRevenue");
    if (expectedEl) expectedEl.textContent = `₱${totalRevenue.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

    let topDishEl = document.getElementById("reportTopDish");
    let topRevenueEl = document.getElementById("reportTopDishRevenue");
    if (topDishEl) topDishEl.textContent = rows.length ? rows[0].dishName : "No data";
    if (topRevenueEl) topRevenueEl.textContent = rows.length ? `₱${rows[0].revenue.toLocaleString("en-PH", { minimumFractionDigits: 2 })} revenue` : "₱0.00 revenue";

    table.innerHTML = rows.length ? rows.map(function(row, index) {
        return `<tr><td>${index + 1}</td><td>${escapeHtml(row.dishName)}</td><td>${row.volume}</td><td>₱${row.price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td><td>₱${row.revenue.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="text-muted">No dish volume data for this period.</td></tr>`;

    let chart = document.getElementById("bestSellerChart");
    let maxVolume = rows.length ? Math.max(...rows.map(function(row) { return row.volume; }), 1) : 1;
    if (chart) {
        chart.innerHTML = rows.length ? rows.map(function(row) {
            let width = Math.max(2, row.volume / maxVolume * 100);
            return `<div class="d-flex align-items-center gap-2 mb-2"><span style="width: 130px">${escapeHtml(row.dishName)}</span><div style="height: 22px; width: ${width}%; background: #e52b2b; border-radius: 3px"></div><strong>${row.volume}</strong></div>`;
        }).join("") : `<span class="text-muted">Create portion mappings and enter sold volumes to see the ranking.</span>`;
    }
}

function exportReport(format) {
    let rows = getBestSellerRows();
    let csvRows = [["Rank", "Dish", "Portions Sold", "Menu Price", "Gross Revenue"]];
    rows.forEach(function(row, index) {
        csvRows.push([index + 1, row.dishName, row.volume, row.price.toFixed(2), row.revenue.toFixed(2)]);
    });
    let csv = csvRows.map(function(row) {
        return row.map(function(value) { return `"${String(value).replace(/"/g, "\"\"")}"`; }).join(",");
    }).join("\n");
    let timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "pdf") {
        window.print();
        return;
    }

    let mime = format === "excel" ? "application/vnd.ms-excel" : "text/csv;charset=utf-8;";
    let extension = format === "excel" ? "xls" : "csv";
    let link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: mime }));
    link.download = `sales-report-${timestamp}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
}

let bestSellerPeriod = document.getElementById("bestSellerPeriod");
if (bestSellerPeriod) bestSellerPeriod.addEventListener("change", function() {
    document.getElementById("customReportDates")?.classList.toggle("d-none", this.value !== "custom");
    renderReports();
});
["reportFrom", "reportTo"].forEach(function(id) {
    let element = document.getElementById(id);
    if (element) element.addEventListener("change", renderReports);
});
if (document.getElementById("exportCsvButton")) document.getElementById("exportCsvButton").addEventListener("click", function() { exportReport("csv"); });
if (document.getElementById("exportExcelButton")) document.getElementById("exportExcelButton").addEventListener("click", function() { exportReport("excel"); });
if (document.getElementById("exportPdfButton")) document.getElementById("exportPdfButton").addEventListener("click", function() { exportReport("pdf"); });


function populateItemSelects() {
    let restockSelect = document.getElementById("restockItem");
    let wasteSelect = document.getElementById("wasteItem");
    let supplierSelect = document.getElementById("supplierItem");

    if (restockSelect) restockSelect.innerHTML = "";
    if (wasteSelect) wasteSelect.innerHTML = "";
    if (supplierSelect) supplierSelect.innerHTML = "";

    inventory.forEach(function(item) {
        if (restockSelect) {
            let option1 = document.createElement("option");
            option1.value = item.id;
            option1.textContent = item.name;
            restockSelect.appendChild(option1);
        }

        if (wasteSelect) {
            let option2 = document.createElement("option");
            option2.value = item.id;
            option2.textContent = item.name;
            wasteSelect.appendChild(option2);
        }

        if (supplierSelect) {
            let option3 = document.createElement("option");
            option3.value = item.id;
            option3.textContent = item.name;
            supplierSelect.appendChild(option3);
        }
    });

    updateRestockSuppliers();
}

function updateRestockSuppliers() {
    let itemSelect = document.getElementById("restockItem");
    let supplierSelect = document.getElementById("restockSupplier");
    if (!itemSelect || !supplierSelect) return;

    let previousSupplier = supplierSelect.value;

    let item = inventory.find(function(entry) {
        return entry.id === itemSelect.value;
    });

    supplierSelect.innerHTML = "";

    if (!item || !Array.isArray(item.suppliers) || !item.suppliers.length) {
        let option = document.createElement("option");
        option.value = "";
        option.textContent = "Assign a supplier first";
        option.disabled = true;
        option.selected = true;
        supplierSelect.appendChild(option);
        supplierSelect.disabled = true;
        return;
    }

    let activeSuppliers = item.suppliers.filter(function(supplier) {
        return supplier && supplier.name;
    });

    if (!activeSuppliers.length) {
        let option = document.createElement("option");
        option.value = "";
        option.textContent = "Assign a supplier first";
        option.disabled = true;
        option.selected = true;
        supplierSelect.appendChild(option);
        supplierSelect.disabled = true;
        return;
    }

    supplierSelect.disabled = false;
    activeSuppliers.forEach(function(supplier) {
        let option = document.createElement("option");
        let optionValue = `${supplier.name}${supplier.contact ? ` - ${supplier.contact}` : ""}`;
        option.value = optionValue;
        option.textContent = supplier.contact ? `${supplier.name} (${supplier.contact})` : supplier.name;
        supplierSelect.appendChild(option);
    });

    if (previousSupplier && Array.from(supplierSelect.options).some(function(option) {
        return option.value === previousSupplier;
    })) {
        supplierSelect.value = previousSupplier;
    } else {
        supplierSelect.selectedIndex = 0;
    }
}


if (document.getElementById("restockItem")) {
    document.getElementById("restockItem").addEventListener("change", updateRestockSuppliers);
}

function refreshSharedDashboardState() {
    inventory = loadInventory();
    restocks = loadLedger("tapsihanRestocks", "restocks");
    wastes = loadLedger("tapsihanWastes", "wastes");
    stockCounts = getStockCountsLedger();
    try {
        let savedAuditLogs = JSON.parse(localStorage.getItem("tapsihanAuditLogs") || "[]");
        systemAuditLogs = Array.isArray(savedAuditLogs) ? savedAuditLogs : [];
    } catch (error) {
        localStorage.removeItem("tapsihanAuditLogs");
        systemAuditLogs = [];
    }

    if (typeof populateItemSelects === "function") populateItemSelects();
    if (typeof loadSupplierFields === "function") loadSupplierFields();
    if (typeof displaySupplierProfiles === "function") displaySupplierProfiles();
    if (typeof displayInventory === "function") displayInventory();
    if (typeof displayRestocks === "function") displayRestocks();
    if (typeof displayWaste === "function") displayWaste();
    if (typeof displayStockTable === "function") displayStockTable();
    if (typeof initializeRestockShift === "function") initializeRestockShift();
    if (typeof updateRestockSuppliers === "function") updateRestockSuppliers();
    if (typeof renderReports === "function") renderReports();
    if (typeof updateDashboard === "function") updateDashboard();
    if (typeof displayMovementLogs === "function") displayMovementLogs();
    if (typeof displaySystemAuditLogs === "function") displaySystemAuditLogs();
}

window.addEventListener("storage", function(event) {
    if (!event.key) return;

    if (["tapsihanInventory", "tapsihanRestocks", "tapsihanWastes", "tapsihanStockCounts", "tapsihanShifts", "tapsihanAuditLogs"].includes(event.key)) {
        refreshSharedDashboardState();
    }
});


function getMovementLedger() {
    let movements = [];

    restocks.forEach(function(restock) {
        let item = inventory.find(function(entry) {
            return entry.id === restock.itemId || entry.name === restock.item;
        });
        movements.push({
            date: restock.date,
            itemId: restock.itemId || (item ? item.id : ""),
            item: restock.item,
            type: "Restock",
            quantity: Number(restock.quantity),
            notes: `Supplier: ${restock.supplier}`
        });
    });

    stockCounts.forEach(function(count) {
        let item = inventory.find(function(entry) {
            return entry.id === count.itemId || entry.name === count.item;
        });
        movements.push({
            date: count.date,
            itemId: count.itemId || (item ? item.id : ""),
            item: count.item,
            type: "Count",
            quantity: Number(count.closing) - Number(count.opening),
            notes: `Opening: ${count.opening}  Closing: ${count.closing}`
        });
    });

    wastes.forEach(function(waste) {
        let item = inventory.find(function(entry) {
            return entry.id === waste.itemId || entry.name === waste.item;
        });
        movements.push({
            date: waste.date,
            itemId: waste.itemId || (item ? item.id : ""),
            item: waste.item,
            type: "Spoilage",
            quantity: -Number(waste.quantity),
            notes: `Reason: ${waste.reason}`
        });
    });

    return movements.sort(function(first, second) {
        return String(second.date).localeCompare(String(first.date));
    });
}

// FR-024: Display Inventory Movement Logs
function displayMovementLogs() {
    let table = document.getElementById("inventoryMovementTable");
    if (!table) return;

    let from = document.getElementById("movementFrom")?.value || "";
    let to = document.getElementById("movementTo")?.value || "";
    let type = document.getElementById("movementType")?.value || "";
    let search = (document.getElementById("movementSearch")?.value || "").toLowerCase();

    let movements = getMovementLedger().filter(function(movement) {
        let matchesDate = (!from || movement.date >= from) && (!to || movement.date <= to);
        let matchesType = !type || movement.type === type;
        let searchable = `${movement.itemId} ${movement.item} ${movement.notes}`.toLowerCase();
        return matchesDate && matchesType && searchable.includes(search);
    });

    table.innerHTML = "";
    if (!movements.length) {
        table.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    No transaction history found.
                </td>
            </tr>
        `;
        return;
    }

    movements.forEach(function(movement) {
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

function normalizeAuditDateValue(value) {
    if (!value) return "";

    let date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value).slice(0, 10);
    }

    let year = date.getFullYear();
    let month = String(date.getMonth() + 1).padStart(2, "0");
    let day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// FR-025: Display Master Data System Audit Logs[cite: 19]
function displaySystemAuditLogs() {
    let from = document.getElementById("auditFrom")?.value || "";
    let to = document.getElementById("auditTo")?.value || "";
    let module = document.getElementById("auditModule")?.value || "";
    let search = (document.getElementById("auditSearch")?.value || "").toLowerCase();

    let filteredLogs = systemAuditLogs.filter(function(log) {
        let logDate = normalizeAuditDateValue(log.timestamp);
        let matchesDate = (!from || logDate >= from) && (!to || logDate <= to);
        let matchesModule = !module || log.module === module;
        let searchable = `${log.module} ${log.action} ${log.target} ${log.details}`.toLowerCase();
        return matchesDate && matchesModule && searchable.includes(search);
    });

    let table = document.getElementById("systemAuditTable");
    if (table) {
        table.innerHTML = "";
        if (!filteredLogs.length) {
            table.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-4">
                        No audit history found.
                    </td>
                </tr>
            `;
        }
    }

    let dashboardHistoryTable = document.getElementById("historyTable");
    if (dashboardHistoryTable) {
        dashboardHistoryTable.innerHTML = "";
        if (!systemAuditLogs.length) {
            dashboardHistoryTable.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-muted py-4">
                        No activity history found.
                    </td>
                </tr>
            `;
        }
    }

    filteredLogs.forEach(function(log) {
        let row = document.createElement("tr");
        if (table) {
            row.innerHTML = `
                <td>${escapeHtml(log.timestamp)}</td>
                <td>${escapeHtml(log.module)}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.target)}</td>
                <td>${escapeHtml(log.user)}</td>
                <td>${escapeHtml(log.details)}</td>
            `;
            table.appendChild(row);
        }

        if (dashboardHistoryTable) {
            let historyRow = document.createElement("tr");
            historyRow.innerHTML = `
                <td>${escapeHtml(log.timestamp)}</td>
                <td>${escapeHtml(log.module)}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.user)}</td>
                <td>${escapeHtml(log.target)}: ${escapeHtml(log.details)}</td>
            `;
            dashboardHistoryTable.appendChild(historyRow);
        }
    });
}

function addAuditLog(module, action, target, details) {
    let timestamp = new Date().toLocaleString("en-PH");
    systemAuditLogs.unshift({
        timestamp: timestamp,
        module: module,
        action: action,
        target: target,
        user: `${currentUser.name} (${currentUser.role === "owner" ? "Administrator" : "Staff"})`,
        details: details
    });
    localStorage.setItem("tapsihanAuditLogs", JSON.stringify(systemAuditLogs));
    displaySystemAuditLogs();
}

["movementFrom", "movementTo", "movementType", "movementSearch"].forEach(function(id) {
    let element = document.getElementById(id);
    if (element) element.addEventListener("input", displayMovementLogs);
    if (element) element.addEventListener("change", displayMovementLogs);
});

["auditFrom", "auditTo", "auditModule", "auditSearch"].forEach(function(id) {
    let element = document.getElementById(id);
    if (element) element.addEventListener("input", displaySystemAuditLogs);
    if (element) element.addEventListener("change", displaySystemAuditLogs);
});

document.querySelectorAll("[data-page-button]").forEach(function(button) {
    button.addEventListener("click", function() {
        let page = button.getAttribute("data-page-button");
        showPage(page);
    });
});

// Initialization
applyRoleAccess();
populateItemSelects();
renderReports();
updateDashboard();
displayMovementLogs();
displaySystemAuditLogs();

// Highlight the current page in the sidebar
function setActiveNav() {
    const currentPage = document.body.getAttribute("data-page");

    if (!currentPage) return;

    document.querySelectorAll(".nav-link").forEach(function(link) {
        const linkPage = link.getAttribute("data-page");

        link.classList.toggle("active", linkPage === currentPage);
    });
}

setActiveNav();