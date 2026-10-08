/* =========================================================
   REPORTS MODULE
   Tapsihan sa Asukarera
   ========================================================= */

(function () {
    "use strict";

    /* =========================================================
       STORAGE HELPERS
       ========================================================= */

    function readStorage(key, fallback) {
        try {
            let saved = localStorage.getItem(key);

            if (!saved) {
                return fallback;
            }

            let parsed = JSON.parse(saved);

            return parsed;
        } catch (error) {
            console.error("Unable to read " + key + ":", error);
            return fallback;
        }
    }

    function getInventoryData() {
        return readStorage("tapsihanInventory", []);
    }

    function getRestockData() {
        return readStorage("tapsihanRestocks", []);
    }

    function getWasteData() {
        return readStorage("tapsihanWastes", []);
    }

    function getStockCountData() {
        return readStorage("tapsihanStockCounts", []);
    }

    function getPortionMappingData() {
        return readStorage("portionMappings", []);
    }


    /* =========================================================
       DATE HELPERS
       ========================================================= */

    function getLocalDateString(date) {
        let year = date.getFullYear();
        let month = String(date.getMonth() + 1).padStart(2, "0");
        let day = String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function parseDate(dateValue) {
        if (!dateValue) {
            return null;
        }

        let date = new Date(dateValue);

        if (isNaN(date.getTime())) {
            return null;
        }

        return date;
    }

    function formatLongDate(dateString) {
        let date = parseDate(dateString);

        if (!date) {
            return dateString || "";
        }

        return date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    function formatShortDate(dateString) {
        let date = parseDate(dateString);

        if (!date) {
            return dateString || "";
        }

        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
        });
    }

    function formatMonthYear(date) {
        return date.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
        });
    }

    function addDays(date, amount) {
        let result = new Date(date);
        result.setDate(result.getDate() + amount);
        return result;
    }

    function getStartOfWeek(date) {
        let result = new Date(date);
        let day = result.getDay();

        /*
            Sunday = 0
            Monday = 1

            We want Monday as the first day.
        */
        let difference = day === 0 ? -6 : 1 - day;

        result.setDate(result.getDate() + difference);
        result.setHours(0, 0, 0, 0);

        return result;
    }


    /* =========================================================
       PERIOD CALCULATION
       ========================================================= */

    function getReportRange() {
        let periodSelect = document.getElementById("bestSellerPeriod");

        let period = periodSelect ? periodSelect.value : "daily";

        let today = new Date();
        today.setHours(0, 0, 0, 0);

        let from;
        let to;

        if (period === "daily") {
            from = new Date(today);
            to = new Date(today);
        }

        else if (period === "weekly") {
            from = getStartOfWeek(today);
            to = addDays(from, 6);
        }

        else if (period === "monthly") {
            from = new Date(
                today.getFullYear(),
                today.getMonth(),
                1
            );

            to = new Date(
                today.getFullYear(),
                today.getMonth() + 1,
                0
            );
        }

        else if (period === "custom") {
            let fromInput = document.getElementById("reportFrom");
            let toInput = document.getElementById("reportTo");

            let fromValue = fromInput ? fromInput.value : "";
            let toValue = toInput ? toInput.value : "";

            if (!fromValue || !toValue) {
                return null;
            }

            from = new Date(fromValue + "T00:00:00");
            to = new Date(toValue + "T00:00:00");

            if (isNaN(from.getTime()) || isNaN(to.getTime())) {
                return null;
            }

            if (from > to) {
                return null;
            }
        }

        return {
            period: period,
            from: getLocalDateString(from),
            to: getLocalDateString(to)
        };
    }


    function getDatesBetween(fromString, toString) {
        let dates = [];

        let current = new Date(fromString + "T00:00:00");
        let end = new Date(toString + "T00:00:00");

        while (current <= end) {
            dates.push(getLocalDateString(current));
            current = addDays(current, 1);
        }

        return dates;
    }


    /* =========================================================
       INVENTORY / PORTION MAPPING HELPERS
       ========================================================= */

    function findInventoryItem(ingredient) {
        let inventory = getInventoryData();

        if (!ingredient) {
            return null;
        }

        let itemId =
            ingredient.itemId ||
            ingredient.ingredientId ||
            ingredient.inventoryId ||
            "";

        let name = String(ingredient.name || "").trim().toLowerCase();

        return inventory.find(function (item) {
            if (itemId && item.id === itemId) {
                return true;
            }

            return String(item.name || "")
                .trim()
                .toLowerCase() === name;
        }) || null;
    }


    /*
        A dish may have multiple ingredients.

        For best-seller calculation we use the primary
        portion-controlled ingredient.

        Meat/Fish is preferred because it represents the
        actual main dish.

        Example:
            Hotsilog
            - Hotdog = 2 pieces
            - Egg = 1 piece

        Hotdog determines the number of Hotsilog portions.
    */
    function getPrimaryIngredient(mapping) {
        if (!mapping || !Array.isArray(mapping.ingredients)) {
            return null;
        }

        let inventory = getInventoryData();

        let resolvedIngredients = mapping.ingredients.map(function (ingredient) {
            let item = findInventoryItem(ingredient);

            return {
                ingredient: ingredient,
                item: item
            };
        });

        let meatOrFish = resolvedIngredients.find(function (entry) {
            if (!entry.item) {
                return false;
            }

            let category = String(entry.item.category || "")
                .trim()
                .toLowerCase();

            return category === "meats" ||
                   category === "meat" ||
                   category === "fish";
        });

        if (meatOrFish) {
            return meatOrFish;
        }

        /*
            Fallback:
            use the first valid ingredient if no meat/fish
            ingredient is available.
        */
        return resolvedIngredients.find(function (entry) {
            return entry.item;
        }) || null;
    }


    /* =========================================================
       STOCK CONSUMPTION
       ========================================================= */

    function getRestocksForItemAndDate(itemId, date) {
        let restocks = getRestockData();

        return restocks
            .filter(function (record) {
                return String(record.itemId || "") === String(itemId) &&
                       String(record.date || "") === date;
            })
            .reduce(function (total, record) {
                return total + (Number(record.quantity) || 0);
            }, 0);
    }


    function getWasteForItemAndDate(itemId, date) {
        let wastes = getWasteData();

        return wastes
            .filter(function (record) {
                return String(record.itemId || "") === String(itemId) &&
                       String(record.date || "") === date;
            })
            .reduce(function (total, record) {
                return total + (Number(record.quantity) || 0);
            }, 0);
    }


    function getStockCountForItemAndDate(itemId, date) {
        let stockCounts = getStockCountData();

        let records = stockCounts.filter(function (record) {
            return String(record.itemId || "") === String(itemId) &&
                   String(record.date || "") === date;
        });

        if (!records.length) {
            return null;
        }

        /*
            If there are multiple records for the same item/date,
            use the most recently recorded one.
        */
        records.sort(function (a, b) {
            return String(b.recordedAt || "").localeCompare(
                String(a.recordedAt || "")
            );
        });

        return records[0];
    }


    function calculateDailyConsumption(itemId, date) {
        let stockCount = getStockCountForItemAndDate(
            itemId,
            date
        );

        if (!stockCount) {
            return 0;
        }

        let opening = Number(stockCount.opening) || 0;
        let closing = Number(stockCount.closing) || 0;

        let restocks = getRestocksForItemAndDate(
            itemId,
            date
        );

        let waste = getWasteForItemAndDate(
            itemId,
            date
        );

        let consumed =
            opening +
            restocks -
            waste -
            closing;

        return Math.max(0, consumed);
    }


    /* =========================================================
       DISH DATA
       ========================================================= */

    function getDishDefinitions() {
        let mappings = getPortionMappingData();

        return mappings
            .filter(function (mapping) {
                return mapping &&
                       mapping.dishName &&
                       Array.isArray(mapping.ingredients) &&
                       mapping.ingredients.length > 0;
            })
            .map(function (mapping) {
                let primary = getPrimaryIngredient(mapping);

                if (!primary || !primary.item) {
                    return null;
                }

                let usedPerOrder =
                    Number(primary.ingredient.usedPerOrder) || 0;

                if (usedPerOrder <= 0) {
                    return null;
                }

                return {
                    dishName: mapping.dishName,
                    sellingPrice: Number(mapping.sellingPrice) || 0,
                    itemId: primary.item.id,
                    usedPerOrder: usedPerOrder
                };
            })
            .filter(Boolean);
    }


    function calculateDishPortionsForDate(dish, date) {
        let consumed = calculateDailyConsumption(
            dish.itemId,
            date
        );

        if (dish.usedPerOrder <= 0) {
            return 0;
        }

        return consumed / dish.usedPerOrder;
    }


    function calculateDishDataForDate(date) {
        let dishes = getDishDefinitions();

        return dishes.map(function (dish) {
            let portions = calculateDishPortionsForDate(
                dish,
                date
            );

            return {
                dishName: dish.dishName,
                sellingPrice: dish.sellingPrice,
                portions: portions,
                revenue: portions * dish.sellingPrice
            };
        });
    }


    /* =========================================================
       AGGREGATED REPORT DATA
       ========================================================= */

    function calculateReportData(range) {
        if (!range) {
            return [];
        }

        let dates = getDatesBetween(
            range.from,
            range.to
        );

        let dishes = getDishDefinitions();

        return dishes.map(function (dish) {
            let totalPortions = 0;

            dates.forEach(function (date) {
                totalPortions += calculateDishPortionsForDate(
                    dish,
                    date
                );
            });

            return {
                dishName: dish.dishName,
                sellingPrice: dish.sellingPrice,

                /* Keep these for the chart */
                itemId: dish.itemId,
                usedPerOrder: dish.usedPerOrder,

                portions: totalPortions,
                revenue: totalPortions * dish.sellingPrice
            };
        })
        .sort(function (a, b) {
            return b.portions - a.portions;
        });
    }


    /* =========================================================
       TABLE
       ========================================================= */

    function formatCurrency(value) {
        return "₱" + Number(value || 0).toFixed(2);
    }


    function renderRankingTable(data) {
        let table = document.getElementById(
            "bestSellerTable"
        );

        if (!table) {
            return;
        }

        table.innerHTML = "";

        if (!data.length) {
            table.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-muted py-4">
                        No best-seller data available for this period.
                    </td>
                </tr>
            `;

            return;
        }

        data.forEach(function (record, index) {
            let row = document.createElement("tr");

            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHtmlReports(record.dishName)}</td>
                <td>${formatPortions(record.portions)}</td>
                <td>${formatCurrency(record.sellingPrice)}</td>
                <td>${formatCurrency(record.revenue)}</td>
            `;

            table.appendChild(row);
        });
    }


    function formatPortions(value) {
        let number = Number(value) || 0;

        if (Number.isInteger(number)) {
            return String(number);
        }

        return number.toFixed(2);
    }


    function escapeHtmlReports(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    /* =========================================================
       CHART COLORS
       ========================================================= */

    const chartColors = [
        "#ef2b2d",
        "#2563eb",
        "#16a34a",
        "#9333ea",
        "#ea580c",
        "#0891b2",
        "#ca8a04",
        "#db2777",
        "#4f46e5",
        "#059669"
    ];


    function getDishColor(index) {
        return chartColors[index % chartColors.length];
    }

    function getChartScale(maxValue) {
        maxValue = Number(maxValue) || 0;

        if (maxValue <= 0) {
            return {
                max: 1,
                step: 1
            };
        }

        /*
            Aim for approximately 5 to 7 Y-axis intervals.
        */
        let roughStep = maxValue / 5;

        let magnitude = Math.pow(
            10,
            Math.floor(Math.log10(roughStep))
        );

        let normalized = roughStep / magnitude;

        let niceStep;

        if (normalized <= 1) {
            niceStep = 1;
        } else if (normalized <= 2) {
            niceStep = 2;
        } else if (normalized <= 5) {
            niceStep = 5;
        } else {
            niceStep = 10;
        }

        let step = niceStep * magnitude;

        let axisMax = Math.ceil(maxValue / step) * step;

        return {
            max: axisMax,
            step: step
        };
    }


    function renderChartYAxis(yAxisElement, scale) {
        if (!yAxisElement) {
            return;
        }

        yAxisElement.innerHTML = "";

        let numberOfSteps = Math.round(
            scale.max / scale.step
        );

        /*
            Render from highest value down to zero.
        */
        for (let i = numberOfSteps; i >= 0; i--) {
            let label = document.createElement("span");

            label.className = "report-chart-y-label";

            label.textContent = formatPortions(
                i * scale.step
            );

            yAxisElement.appendChild(label);
        }
    }


    /* =========================================================
       CHART
       ========================================================= */

    function renderBestSellerChart(range, overallData) {
        let chart = document.getElementById(
            "bestSellerChart"
        );

        if (!chart) {
            return;
        }

        chart.innerHTML = "";

        if (!range) {
            chart.innerHTML = `
                <div class="text-center text-muted py-4">
                    Select a valid report date range.
                </div>
            `;

            return;
        }

        let dates = getDatesBetween(
            range.from,
            range.to
        );

        if (!overallData.length) {
            chart.innerHTML = `
                <div class="text-center text-muted py-4">
                    No chart data available for this period.
                </div>
            `;

            return;
        }

        let wrapper = document.createElement("div");

        wrapper.className = "report-chart-wrapper";

        wrapper.innerHTML = `
            <div class="report-chart-legend mb-3"></div>

            <div class="report-chart-area">

                <div class="report-chart-y-axis"></div>

                <div class="report-chart-scroll">
                    <div class="report-chart"></div>
                </div>

            </div>
        `;

        chart.appendChild(wrapper);

        let chartElement = wrapper.querySelector(
            ".report-chart"
        );

        let legendElement = wrapper.querySelector(
            ".report-chart-legend"
        );

        let yAxisElement = wrapper.querySelector(
            ".report-chart-y-axis"
        );

        let maxValue = 0;

        if (range.period === "daily") {
            maxValue = Math.max.apply(
                null,
                overallData.map(function (item) {
                    return item.portions;
                })
            );
        } else {
            let dailyData = buildDailyChartData(
                dates,
                overallData
            );

            dailyData.forEach(function (day) {
                day.dishes.forEach(function (dish) {
                    maxValue = Math.max(
                        maxValue,
                        dish.portions
                    );
                });
            });
        }

        if (maxValue <= 0) {
            maxValue = 1;
        }

        /*
            Create a clean Y-axis scale.

            Example:
                Maximum = 43
                Y-axis = 0, 10, 20, 30, 40, 50
        */
        let chartScale = getChartScale(maxValue);

        renderChartYAxis(
            yAxisElement,
            chartScale
        );

        maxValue = chartScale.max;

        /*
            Build legend from the dishes.
        */
        overallData.forEach(function (dish, index) {
            let legendItem = document.createElement("span");

            legendItem.className =
                "report-chart-legend-item";

            legendItem.innerHTML = `
                <span
                    class="report-chart-legend-color"
                    style="background:${getDishColor(index)}"
                ></span>
                <span>${escapeHtmlReports(dish.dishName)}</span>
            `;

            legendElement.appendChild(
                legendItem
            );
        });


        /* =====================================================
           DAILY
           ===================================================== */

        if (range.period === "daily") {
            chartElement.classList.add(
                "report-chart-daily"
            );

            overallData.forEach(function (dish, index) {
                let column = createBarColumn(
                    dish.dishName,
                    dish.portions,
                    maxValue,
                    getDishColor(index)
                );

                chartElement.appendChild(column);
            });
        }


        /* =====================================================
           WEEKLY / MONTHLY / CUSTOM
           ===================================================== */

        else {
            chartElement.classList.add(
                "report-chart-multi-day"
            );

            let dailyData = buildDailyChartData(
                dates,
                overallData
            );

            dailyData.forEach(function (dayData) {
                let dayGroup =
                    document.createElement("div");

                dayGroup.className =
                    "report-chart-day-group";

                let barsContainer =
                    document.createElement("div");

                barsContainer.className =
                    "report-chart-day-bars";

                dayData.dishes.forEach(function (
                    dish,
                    index
                ) {
                    let barHeight = 0;

                    if (maxValue > 0 && dish.portions > 0) {
                        barHeight =
                            (dish.portions / maxValue) * 270;
                    }

                    let barWrapper = document.createElement("div");

                    barWrapper.className = "report-chart-bar-wrapper";

                    let valueLabel = document.createElement("div");

                    valueLabel.className = "report-chart-bar-value";

                    valueLabel.textContent =
                        formatPortions(dish.portions);

                    let bar = document.createElement("div");

                    bar.className = "report-chart-bar";

                    bar.style.height =
                        Math.max(barHeight, 2) + "px";

                    bar.style.background =
                        getDishColor(index);

                    bar.title =
                        `${dish.dishName}: ${formatPortions(dish.portions)} portions`;

                    barWrapper.appendChild(valueLabel);
                    barWrapper.appendChild(bar);

                    barsContainer.appendChild(barWrapper);
                });

                let dateLabel =
                    document.createElement("div");

                dateLabel.className =
                    "report-chart-date-label";

                let dateObject = parseDate(
                    dayData.date
                );

                if (range.period === "monthly") {
                    dateLabel.textContent =
                        dateObject.getDate();
                } else {
                    dateLabel.innerHTML =
                        `${dateObject.toLocaleDateString(
                            "en-US",
                            { month: "short" }
                        )}<br>${dateObject.getDate()}`;
                }

                dayGroup.appendChild(
                    barsContainer
                );

                dayGroup.appendChild(
                    dateLabel
                );

                chartElement.appendChild(
                    dayGroup
                );
            });
        }


        /* =====================================================
           CSS FOR THE CHART
           ===================================================== */
    }


    function createBarColumn(
        label,
        value,
        maxValue,
        color
    ) {
        let column =
            document.createElement("div");

        column.className =
            "report-chart-single-column";

        let height =
            maxValue > 0
                ? (value / maxValue) * 100
                : 0;

        column.innerHTML = `
            <div class="report-chart-single-value">
                ${formatPortions(value)}
            </div>

            <div class="report-chart-single-bar-area">
                <div
                    class="report-chart-single-bar"
                    style="
                        height:${Math.max(height, 0)}%;
                        background:${color};
                    "
                    title="${escapeHtmlReports(label)}: ${formatPortions(value)} portions"
                ></div>
            </div>

            <div class="report-chart-single-label">
                ${escapeHtmlReports(label)}
            </div>
        `;

        return column;
    }


    function buildDailyChartData(
        dates,
        overallData
    ) {
        return dates.map(function (date) {
            let dailyDishes =
                overallData.map(function (dish) {
                    return {
                        dishName: dish.dishName,
                        portions:
                            calculateDishPortionsForDate(
                                dish,
                                date
                            )
                    };
                });

            return {
                date: date,
                dishes: dailyDishes
            };
        });
    }


    /* =========================================================
       REPORT LABEL
       ========================================================= */

    function updateReportPeriodLabel(range) {
        let label = document.getElementById(
            "reportPeriodLabel"
        );

        if (!label) {
            return;
        }

        if (!range) {
            label.textContent =
                "Select a valid report date range.";

            return;
        }

        let fromDate = parseDate(range.from);
        let toDate = parseDate(range.to);

        if (range.period === "daily") {
            label.textContent =
                "Report date: " +
                formatLongDate(range.from);
        }

        else if (range.period === "weekly") {
            label.textContent =
                `Report week: ${formatShortDate(range.from)} – ${formatLongDate(range.to)}`;
        }

        else if (range.period === "monthly") {
            label.textContent =
                "Report month: " +
                formatMonthYear(fromDate);
        }

        else {
            label.textContent =
                `Report range: ${formatLongDate(range.from)} – ${formatLongDate(range.to)}`;
        }
    }


    /* =========================================================
       MAIN REPORT RENDER
       ========================================================= */

    function renderReports() {
        let range = getReportRange();

        updateReportPeriodLabel(range);

        if (!range) {
            renderRankingTable([]);
            renderBestSellerChart(
                null,
                []
            );

            return;
        }

        let reportData =
            calculateReportData(range);

        renderRankingTable(
            reportData
        );

        renderBestSellerChart(
            range,
            reportData
        );
    }


    /* =========================================================
       PERIOD CONTROLS
       ========================================================= */

    function initializeReportControls() {
        let periodSelect =
            document.getElementById(
                "bestSellerPeriod"
            );

        let customDates =
            document.getElementById(
                "customReportDates"
            );

        let fromInput =
            document.getElementById(
                "reportFrom"
            );

        let toInput =
            document.getElementById(
                "reportTo"
            );

        if (periodSelect) {
            periodSelect.addEventListener(
                "change",
                function () {
                    if (customDates) {
                        customDates.classList.toggle(
                            "d-none",
                            periodSelect.value !== "custom"
                        );
                    }

                    renderReports();
                }
            );
        }

        if (fromInput) {
            fromInput.addEventListener(
                "change",
                renderReports
            );
        }

        if (toInput) {
            toInput.addEventListener(
                "change",
                renderReports
            );
        }

        /*
            Set default custom range.
        */
        let today =
            getLocalDateString(
                new Date()
            );

        if (fromInput && !fromInput.value) {
            fromInput.value = today;
        }

        if (toInput && !toInput.value) {
            toInput.value = today;
        }
    }


    /* =========================================================
       EXPORT
       ========================================================= */

    function getCurrentReportRows() {
        let range = getReportRange();

        if (!range) {
            return [];
        }

        return calculateReportData(
            range
        );
    }


    function exportCsv() {
        let data =
            getCurrentReportRows();

        if (!data.length) {
            alert(
                "There is no report data to export."
            );

            return;
        }

        let rows = [
            [
                "Rank",
                "Dish",
                "Portions Sold",
                "Menu Price",
                "Gross Revenue"
            ]
        ];

        data.forEach(function (
            record,
            index
        ) {
            rows.push([
                index + 1,
                record.dishName,
                formatPortions(record.portions),
                record.sellingPrice.toFixed(2),
                record.revenue.toFixed(2)
            ]);
        });

        let csv = rows.map(function (row) {
            return row.map(function (value) {
                let text = String(value);

                if (
                    text.includes(",") ||
                    text.includes('"') ||
                    text.includes("\n")
                ) {
                    text =
                        '"' +
                        text.replace(
                            /"/g,
                            '""'
                        ) +
                        '"';
                }

                return text;
            }).join(",");
        }).join("\n");

        let blob = new Blob(
            [csv],
            {
                type: "text/csv;charset=utf-8;"
            }
        );

        let url =
            URL.createObjectURL(blob);

        let link =
            document.createElement("a");

        link.href = url;
        link.download =
            "tapsihan-best-seller-report.csv";

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }


    function exportExcel() {
        let data =
            getCurrentReportRows();

        if (!data.length) {
            alert(
                "There is no report data to export."
            );

            return;
        }

        let html = `
            <table border="1">
                <tr>
                    <th>Rank</th>
                    <th>Dish</th>
                    <th>Portions Sold</th>
                    <th>Menu Price</th>
                    <th>Gross Revenue</th>
                </tr>
        `;

        data.forEach(function (
            record,
            index
        ) {
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtmlReports(record.dishName)}</td>
                    <td>${formatPortions(record.portions)}</td>
                    <td>${record.sellingPrice.toFixed(2)}</td>
                    <td>${record.revenue.toFixed(2)}</td>
                </tr>
            `;
        });

        html += "</table>";

        let blob = new Blob(
            [
                `
                <html>
                    <head>
                        <meta charset="UTF-8">
                    </head>
                    <body>
                        ${html}
                    </body>
                </html>
                `
            ],
            {
                type:
                    "application/vnd.ms-excel"
            }
        );

        let url =
            URL.createObjectURL(blob);

        let link =
            document.createElement("a");

        link.href = url;
        link.download =
            "tapsihan-best-seller-report.xls";

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }


    function printReport() {
        window.print();
    }


    function initializeExportButtons() {
        let csvButton =
            document.getElementById(
                "exportCsvButton"
            );

        let excelButton =
            document.getElementById(
                "exportExcelButton"
            );

        let pdfButton =
            document.getElementById(
                "exportPdfButton"
            );

        if (csvButton) {
            csvButton.addEventListener(
                "click",
                exportCsv
            );
        }

        if (excelButton) {
            excelButton.addEventListener(
                "click",
                exportExcel
            );
        }

        if (pdfButton) {
            pdfButton.addEventListener(
                "click",
                printReport
            );
        }
    }


    /* =========================================================
       LIVE REFRESH
       ========================================================= */

    window.addEventListener(
        "storage",
        function (event) {
            let reportKeys = [
                "tapsihanInventory",
                "tapsihanRestocks",
                "tapsihanWastes",
                "tapsihanStockCounts",
                "portionMappings"
            ];

            if (
                reportKeys.includes(
                    event.key
                )
            ) {
                renderReports();
            }
        }
    );

    /* =========================================================
       INITIALIZATION
       ========================================================= */

    function initializeReports() {
        initializeReportControls();
        initializeExportButtons();
        renderReports();
    }


    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initializeReports
        );
    } else {
        initializeReports();
    }

})();