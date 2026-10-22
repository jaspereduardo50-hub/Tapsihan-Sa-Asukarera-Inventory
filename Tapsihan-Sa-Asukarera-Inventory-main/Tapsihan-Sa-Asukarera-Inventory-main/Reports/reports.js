/* =========================================================
   REPORTS MODULE
   Tapsihan sa Asukarera
   ========================================================= */

(function () {
    "use strict";

    /* =========================================================
       REPORT STATE
       ========================================================= */
    var selectedMonth = null;
    var periodOffset = 0;
    var chartMetric = "portions";
    var chartMode = "grouped";
    var lastRender = null;

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

        /* "YYYY-MM-DD" must be read as a LOCAL date, otherwise the
           day can shift by one in some time zones. */
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))) {
            dateValue = dateValue + "T00:00:00";
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
            from = addDays(today, periodOffset);
            to = new Date(from);
        }

        else if (period === "weekly") {
            from = addDays(getStartOfWeek(today), periodOffset * 7);
            to = addDays(from, 6);
        }

        else if (period === "monthly") {
            let year = today.getFullYear() + periodOffset;

            if (selectedMonth === null) {
                /* Year overview: January 1 - December 31 */
                from = new Date(year, 0, 1);
                to = new Date(year, 11, 31);
            } else {
                from = new Date(year, selectedMonth, 1);
                to = new Date(year, selectedMonth + 1, 0);
            }
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
            view: (period === "monthly" && selectedMonth === null)
                ? "year"
                : "days",
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


    /* Report data and calculations are supplied by the PHP API. */

    function aggregateDays(days, dishList) {
        return dishList.map(function (dish) {
            let portions = 0, revenue = 0, counted = 0, pastDays = 0;
            days.forEach(function (day) {
                let record = day.dishes[dish._index];
                if (!record) return;
                portions += Number(record.portions) || 0;
                revenue += Number(record.revenue) || 0;
                if (!day.isFuture) { pastDays++; if (record.counted) counted++; }
            });
            return { dishName: dish.dishName, sellingPrice: dish.sellingPrice, portions, revenue, counted, pastDays,
                noData: pastDays > 0 && counted === 0, partial: counted > 0 && counted < pastDays };
        });
    }

    /* =========================================================
       TABLE
       ========================================================= */

    function formatCurrency(value) {
        return "₱" + Number(value || 0).toFixed(2);
    }


    function getDataBadge(record) {
        if (record.noData) {
            return ` <span class="badge bg-warning text-dark ms-2" title="No stock count was recorded for this dish in the selected period, so its sales cannot be calculated.">No count</span>`;
        }

        if (record.partial) {
            return ` <span class="badge bg-light text-dark border ms-2" title="Stock was counted on only ${record.counted} of ${record.pastDays} days, so portions may be understated.">${record.counted}/${record.pastDays} days</span>`;
        }

        return "";
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
                <td>${formatPortions(record.portions)}${getDataBadge(record)}</td>
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


    var CHART_PLOT_HEIGHT = 270; /* must match --plot-h in reports.css */
    var CHART_TOP_HEIGHT = 46;   /* must match --top-h  in reports.css */

    var MONTH_SHORT_NAMES = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    var MONTH_LONG_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];


    /* =========================================================
       METRIC HELPERS (portions vs revenue)
       ========================================================= */

    function metricOf(record) {
        return chartMetric === "revenue"
            ? record.revenue
            : record.portions;
    }

    function formatMetricValue(value) {
        if (chartMetric === "revenue") {
            return "₱" + Math.round(Number(value) || 0)
                .toLocaleString("en-US");
        }

        return formatPortions(value);
    }

    function formatWeekdayDate(dateString) {
        let date = parseDate(dateString);

        if (!date) {
            return dateString || "";
        }

        return date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }


    /* =========================================================
       AXIS + GRID
       ========================================================= */

    /* Distance (px) from the top of the chart box to a given value */
    function chartYPosition(value, scale) {
        return CHART_TOP_HEIGHT +
            CHART_PLOT_HEIGHT -
            (value / scale.max) * CHART_PLOT_HEIGHT;
    }

    function renderChartYAxis(yAxisElement, scale) {
        if (!yAxisElement) {
            return;
        }

        yAxisElement.innerHTML = "";

        let numberOfSteps = Math.round(scale.max / scale.step);

        for (let i = 0; i <= numberOfSteps; i++) {
            let label = document.createElement("span");

            label.className = "report-chart-y-label";
            label.textContent = formatMetricValue(i * scale.step);
            label.style.top =
                chartYPosition(i * scale.step, scale) + "px";

            yAxisElement.appendChild(label);
        }
    }

    function renderChartGrid(chartElement, scale) {
        let numberOfSteps = Math.round(scale.max / scale.step);

        for (let i = 0; i <= numberOfSteps; i++) {
            let line = document.createElement("div");

            line.className = "report-chart-grid-line" +
                (i === 0 ? " is-zero" : "");

            line.style.top =
                chartYPosition(i * scale.step, scale) + "px";

            chartElement.appendChild(line);
        }
    }

    /* Escape, then allow wrapping between camelCase words
       (ChickenFilltetSilog -> Chicken / Filltet / Silog) */
    function formatChartLabel(text) {
        return escapeHtmlReports(text)
            .replace(/([a-z])([A-Z])/g, "$1<wbr>$2");
    }


    /* =========================================================
       TOOLTIP
       ========================================================= */

    var tooltipElement = null;

    function getTooltipElement() {
        if (!tooltipElement) {
            tooltipElement = document.createElement("div");
            tooltipElement.className = "report-chart-tooltip";
            tooltipElement._html = "";
            document.body.appendChild(tooltipElement);
        }

        return tooltipElement;
    }

    function positionTooltip(event) {
        let tip = getTooltipElement();

        let left = event.clientX + 16;
        let top = event.clientY + 16;

        if (left + tip.offsetWidth > window.innerWidth - 8) {
            left = event.clientX - tip.offsetWidth - 16;
        }

        if (top + tip.offsetHeight > window.innerHeight - 8) {
            top = event.clientY - tip.offsetHeight - 16;
        }

        tip.style.left = Math.max(8, left) + "px";
        tip.style.top = Math.max(8, top) + "px";
    }

    function updateTooltip(getHtml, event) {
        let tip = getTooltipElement();
        let html = getHtml(event);

        if (tip._html !== html) {
            tip.innerHTML = html;
            tip._html = html;
        }

        tip.style.display = "block";
        positionTooltip(event);
    }

    function hideTooltip() {
        if (tooltipElement) {
            tooltipElement.style.display = "none";
        }
    }

    function attachTooltip(element, getHtml) {
        element.addEventListener("mouseenter", function (event) {
            updateTooltip(getHtml, event);
        });

        element.addEventListener("mousemove", function (event) {
            updateTooltip(getHtml, event);
        });

        element.addEventListener("mouseleave", hideTooltip);
    }

    function groupHint(group) {
        if (group.monthIndex !== undefined && !group.future) {
            return "Click to view the days of this month";
        }

        return "";
    }

    function buildGroupTooltip(group, activeIndex, hint) {
        let totalPortions = 0;
        let totalRevenue = 0;
        let anyData = false;

        let rows = group.dishes.map(function (dish, index) {
            totalPortions += dish.portions;
            totalRevenue += dish.revenue;

            if (!dish.noData) {
                anyData = true;
            }

            let value;

            if (group.future) {
                value = "Upcoming";
            } else if (dish.noData) {
                value = "No stock count";
            } else {
                value =
                    formatPortions(dish.portions) + " portions · " +
                    formatCurrency(dish.revenue);
            }

            let note = "";

            if (!group.future && dish.partial) {
                note = `<div class="rt-note">Counted on ${dish.counted} of ${dish.pastDays} days</div>`;
            }

            return `
                <div class="rt-row${index === activeIndex ? " rt-active" : ""}">
                    <span class="rt-dot" style="background:${getDishColor(index)}"></span>
                    <span class="rt-name">${escapeHtmlReports(dish.dishName)}</span>
                    <span class="rt-val">${value}</span>
                </div>${note}`;
        }).join("");

        let total = "";

        if (!group.future && anyData && group.dishes.length > 1) {
            total = `
                <div class="rt-row rt-total">
                    <span class="rt-name">Total</span>
                    <span class="rt-val">${formatPortions(totalPortions)} portions · ${formatCurrency(totalRevenue)}</span>
                </div>`;
        }

        return `
            <div class="rt-title">${escapeHtmlReports(group.title)}</div>
            ${rows}
            ${total}
            ${hint ? `<div class="rt-hint">${escapeHtmlReports(hint)}</div>` : ""}
        `;
    }


    /* =========================================================
       CHART TOOLBAR (back button, metric + mode toggles)
       ========================================================= */

    function createSegmentedToggle(options, current, onSelect) {
        let group = document.createElement("div");

        group.className = "btn-group btn-group-sm report-chart-toggle";
        group.setAttribute("role", "group");

        options.forEach(function (option) {
            let button = document.createElement("button");

            button.type = "button";
            button.className = "btn " + (
                option.value === current
                    ? "btn-danger"
                    : "btn-outline-danger"
            );
            button.textContent = option.label;

            button.addEventListener("click", function () {
                if (option.value !== current) {
                    onSelect(option.value);
                }
            });

            group.appendChild(button);
        });

        return group;
    }

    function redrawChartOnly() {
        if (lastRender) {
            renderBestSellerChart(
                lastRender.range,
                lastRender.reportData,
                lastRender.matrix
            );
        }
    }

    function renderChartNav(navElement, range, canStack) {
        if (!navElement) {
            return;
        }

        navElement.innerHTML = "";

        let left = document.createElement("div");
        let right = document.createElement("div");

        left.className = "report-chart-nav-left";
        right.className = "report-chart-nav-right";

        if (range.period === "monthly") {
            let year = parseDate(range.from).getFullYear();

            if (range.view === "year") {
                left.innerHTML =
                    `<span class="text-muted">${year} &ndash; click a month to see its daily breakdown</span>`;
            } else {
                let back = document.createElement("button");

                back.type = "button";
                back.className = "btn btn-sm btn-outline-secondary";
                back.textContent = "← Back to " + year;

                back.addEventListener("click", function () {
                    selectedMonth = null;
                    renderReports();
                });

                let title = document.createElement("strong");

                title.textContent =
                    formatMonthYear(parseDate(range.from));

                left.appendChild(back);
                left.appendChild(title);
            }
        }

        right.appendChild(
            createSegmentedToggle(
                [
                    { value: "portions", label: "Portions" },
                    { value: "revenue", label: "Revenue (₱)" }
                ],
                chartMetric,
                function (value) {
                    chartMetric = value;
                    redrawChartOnly();
                }
            )
        );

        if (canStack) {
            right.appendChild(
                createSegmentedToggle(
                    [
                        { value: "grouped", label: "Grouped" },
                        { value: "stacked", label: "Stacked" }
                    ],
                    chartMode,
                    function (value) {
                        chartMode = value;
                        redrawChartOnly();
                    }
                )
            );
        }

        navElement.appendChild(left);
        navElement.appendChild(right);
    }


    /* =========================================================
       CHART GROUPS (what appears on the X axis)
       ========================================================= */

    /*
        - Daily:               1 group, one column per dish
        - Monthly (year view): 12 groups, one per month
        - Everything else:     one group per day, labelled with
                               the weekday (Mon, Tue, ...)
    */
    function buildChartGroups(range, overallData, matrix) {
        if (range.period === "daily") {
            let day = matrix[0];

            return [{
                title: formatWeekdayDate(day.date),
                future: day.isFuture,
                dishes: aggregateDays([day], overallData)
            }];
        }

        if (range.period === "monthly" && range.view === "year") {
            let year = Number(range.from.slice(0, 4));

            return MONTH_SHORT_NAMES.map(function (name, monthIndex) {
                let days = matrix.filter(function (day) {
                    return Number(day.date.slice(5, 7)) - 1 === monthIndex;
                });

                return {
                    monthIndex: monthIndex,
                    label: name,
                    title: MONTH_LONG_NAMES[monthIndex] + " " + year,
                    future: days.length > 0 && days.every(function (day) {
                        return day.isFuture;
                    }),
                    dishes: aggregateDays(days, overallData)
                };
            });
        }

        return matrix.map(function (day) {
            let d = parseDate(day.date);

            let weekday = d.toLocaleDateString("en-US", {
                weekday: "short"
            });

            let label;

            if (range.period === "monthly") {
                label = `${weekday}<br>${d.getDate()}`;
            } else {
                let month = d.toLocaleDateString("en-US", {
                    month: "short"
                });

                label = `${weekday}<br>${month} ${d.getDate()}`;
            }

            return {
                label: label,
                title: formatWeekdayDate(day.date),
                future: day.isFuture,
                dishes: aggregateDays([day], overallData)
            };
        });
    }


    /* =========================================================
       BUILDING THE BARS
       ========================================================= */

    /* Daily view: one column per dish */
    function createBarColumn(group, dish, index, maxValue) {
        let column = document.createElement("div");

        column.className = "report-chart-single-column";

        let value = metricOf(dish);

        let height = 0;

        if (!group.future && !dish.noData && maxValue > 0) {
            height = (Math.max(0, value) / maxValue) * CHART_PLOT_HEIGHT;
        }

        let valueText;

        if (group.future) {
            valueText = "–";
        } else if (dish.noData) {
            valueText = "No count";
        } else {
            valueText = formatMetricValue(value);
        }

        column.innerHTML = `
            <div class="report-chart-single-bar-area">
                <div class="report-chart-single-value${dish.noData ? " is-nodata" : ""}">
                    ${valueText}
                </div>
                <div
                    class="report-chart-single-bar"
                    style="height:${height}px; background:${getDishColor(index)};"
                ></div>
            </div>

            <div class="report-chart-single-label">
                ${formatChartLabel(dish.dishName)}
            </div>
        `;

        attachTooltip(column, function () {
            return buildGroupTooltip(group, index, "");
        });

        return column;
    }


    /* Weekly / monthly / custom: one narrow bar per dish */
    function createGroupedBar(group, dish, index, maxValue) {
        let wrapper = document.createElement("div");

        wrapper.className = "report-chart-bar-wrapper";

        let valueLabel = document.createElement("div");

        valueLabel.className = "report-chart-bar-value";

        let text;

        if (group.future) {
            text = "";
        } else if (dish.noData) {
            text = "–";
            valueLabel.classList.add("is-nodata");
        } else {
            text = formatMetricValue(metricOf(dish));
        }

        valueLabel.textContent = text;

        /* Long numbers (e.g. ₱1,680) are written sideways so they
           never overlap the neighbouring bars. */
        if (text.length > 2) {
            valueLabel.classList.add("is-vertical");
        }

        let height = 0;

        if (!group.future && !dish.noData && maxValue > 0) {
            height = (metricOf(dish) / maxValue) * CHART_PLOT_HEIGHT;
        }

        let bar = document.createElement("div");

        bar.className = "report-chart-bar";
        bar.style.height = height + "px";
        bar.style.background = getDishColor(index);

        wrapper.appendChild(valueLabel);
        wrapper.appendChild(bar);

        attachTooltip(wrapper, function () {
            return buildGroupTooltip(group, index, groupHint(group));
        });

        return wrapper;
    }


    /* Stacked view: all dishes of a day stacked in one column */
    function createStack(group, maxValue) {
        let stack = document.createElement("div");

        stack.className = "report-stack";

        let total = 0;
        let anyData = false;

        group.dishes.forEach(function (dish) {
            total += metricOf(dish);

            if (!dish.noData) {
                anyData = true;
            }
        });

        let totalLabel = document.createElement("div");

        totalLabel.className = "report-chart-bar-value report-stack-total";

        if (group.future) {
            totalLabel.textContent = "";
        } else if (!anyData) {
            totalLabel.textContent = "–";
            totalLabel.classList.add("is-nodata");
        } else {
            totalLabel.textContent = formatMetricValue(total);
        }

        let segments = document.createElement("div");

        segments.className = "report-stack-segments";

        group.dishes.forEach(function (dish, index) {
            let value = metricOf(dish);

            if (group.future || dish.noData || value <= 0) {
                return;
            }

            let segment = document.createElement("div");

            segment.className = "report-stack-segment";
            segment.style.height =
                (value / maxValue) * CHART_PLOT_HEIGHT + "px";
            segment.style.background = getDishColor(index);
            segment.setAttribute("data-index", String(index));

            segments.appendChild(segment);
        });

        stack.appendChild(totalLabel);
        stack.appendChild(segments);

        attachTooltip(stack, function (event) {
            let index = -1;

            if (event.target && event.target.getAttribute) {
                let attribute = event.target.getAttribute("data-index");

                if (attribute !== null) {
                    index = Number(attribute);
                }
            }

            return buildGroupTooltip(group, index, groupHint(group));
        });

        return stack;
    }


    function createDayGroup(group, mode, maxValue) {
        let dayGroup = document.createElement("div");

        dayGroup.className = "report-chart-day-group";

        if (group.future) {
            dayGroup.classList.add("is-future");
        }

        let barsContainer = document.createElement("div");

        barsContainer.className = "report-chart-day-bars";

        if (mode === "stacked") {
            barsContainer.appendChild(createStack(group, maxValue));
        } else {
            group.dishes.forEach(function (dish, index) {
                barsContainer.appendChild(
                    createGroupedBar(group, dish, index, maxValue)
                );
            });
        }

        let dateLabel = document.createElement("div");

        dateLabel.className = "report-chart-date-label";
        dateLabel.innerHTML = group.label;

        dayGroup.appendChild(barsContainer);
        dayGroup.appendChild(dateLabel);

        /* Year view: click a month to see its days */
        if (group.monthIndex !== undefined && !group.future) {
            dayGroup.classList.add("is-clickable");
            dayGroup.setAttribute("role", "button");
            dayGroup.setAttribute("tabindex", "0");

            let openMonth = function () {
                hideTooltip();
                selectedMonth = group.monthIndex;
                renderReports();
            };

            dayGroup.addEventListener("click", openMonth);

            dayGroup.addEventListener("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openMonth();
                }
            });
        }

        return dayGroup;
    }


    /* =========================================================
       CHART
       ========================================================= */

    function renderBestSellerChart(range, overallData, matrix) {
        hideTooltip();

        let chart = document.getElementById("bestSellerChart");

        if (!chart) {
            return;
        }

        chart.innerHTML = "";

        let subtitle = document.getElementById("bestSellerChartSubtitle");

        if (subtitle) {
            subtitle.textContent = chartMetric === "revenue"
                ? "Gross revenue (₱) during the selected period"
                : "Portions sold during the selected period";
        }

        if (!range) {
            chart.innerHTML = `
                <div class="text-center text-muted py-4">
                    Select a valid report date range.
                </div>
            `;

            return;
        }

        if (!overallData.length) {
            chart.innerHTML = `
                <div class="text-center text-muted py-4">
                    No chart data available for this period.
                </div>
            `;

            return;
        }

        let groups = buildChartGroups(range, overallData, matrix);

        let isDaily = range.period === "daily";
        let mode = isDaily ? "grouped" : chartMode;

        let wrapper = document.createElement("div");

        wrapper.className = "report-chart-wrapper";

        wrapper.innerHTML = `
            <div class="report-chart-nav"></div>

            <div class="report-chart-legend mb-3"></div>

            <div class="report-chart-area">

                <div class="report-chart-y-axis"></div>

                <div class="report-chart-scroll">
                    <div class="report-chart"></div>
                </div>

            </div>

            <div class="report-chart-note d-none"></div>
        `;

        chart.appendChild(wrapper);

        let chartElement = wrapper.querySelector(".report-chart");
        let legendElement = wrapper.querySelector(".report-chart-legend");
        let yAxisElement = wrapper.querySelector(".report-chart-y-axis");
        let noteElement = wrapper.querySelector(".report-chart-note");

        renderChartNav(
            wrapper.querySelector(".report-chart-nav"),
            range,
            !isDaily
        );

        /*
            Y-axis maximum:
              grouped -> tallest single bar
              stacked -> tallest stack
        */
        let maxValue = 0;

        groups.forEach(function (group) {
            if (mode === "stacked") {
                let sum = 0;

                group.dishes.forEach(function (dish) {
                    sum += metricOf(dish);
                });

                maxValue = Math.max(maxValue, sum);
            } else {
                group.dishes.forEach(function (dish) {
                    maxValue = Math.max(maxValue, metricOf(dish));
                });
            }
        });

        if (maxValue <= 0) {
            maxValue = 1;
        }

        let chartScale = getChartScale(maxValue);

        renderChartYAxis(yAxisElement, chartScale);

        maxValue = chartScale.max;

        renderChartGrid(chartElement, chartScale);

        /* Legend */
        overallData.forEach(function (dish, index) {
            let legendItem = document.createElement("span");

            legendItem.className = "report-chart-legend-item";

            legendItem.innerHTML = `
                <span
                    class="report-chart-legend-color"
                    style="background:${getDishColor(index)}"
                ></span>
                <span>${escapeHtmlReports(dish.dishName)}</span>
            `;

            legendElement.appendChild(legendItem);
        });

        let hasMissingData = false;

        if (isDaily) {
            chartElement.classList.add("report-chart-daily");

            groups[0].dishes.forEach(function (dish, index) {
                if (dish.noData) {
                    hasMissingData = true;
                }

                chartElement.appendChild(
                    createBarColumn(groups[0], dish, index, maxValue)
                );
            });
        } else {
            chartElement.classList.add("report-chart-multi-day");

            groups.forEach(function (group) {
                if (
                    !group.future &&
                    group.dishes.some(function (dish) {
                        return dish.noData;
                    })
                ) {
                    hasMissingData = true;
                }

                chartElement.appendChild(
                    createDayGroup(group, mode, maxValue)
                );
            });
        }

        if (hasMissingData) {
            noteElement.classList.remove("d-none");
            noteElement.textContent =
                "“–” / “No count” means no stock count was recorded, so sales cannot be calculated. It is not the same as 0 sold.";
        }
    }


    /* =========================================================
       PREVIOUS PERIOD + SUMMARY CARDS
       ========================================================= */

    function getPreviousRange(range) {
        let from = parseDate(range.from);
        let to = parseDate(range.to);

        let prevFrom;
        let prevTo;

        if (range.period === "daily") {
            prevFrom = addDays(from, -1);
            prevTo = new Date(prevFrom);
        }

        else if (range.period === "weekly") {
            prevFrom = addDays(from, -7);
            prevTo = addDays(to, -7);
        }

        else if (range.period === "monthly") {
            if (range.view === "year") {
                prevFrom = new Date(from.getFullYear() - 1, 0, 1);
                prevTo = new Date(from.getFullYear() - 1, 11, 31);
            } else {
                prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
                prevTo = new Date(from.getFullYear(), from.getMonth(), 0);
            }
        }

        else {
            let length = Math.round((to - from) / 86400000) + 1;

            prevTo = addDays(from, -1);
            prevFrom = addDays(prevTo, -(length - 1));
        }

        return {
            period: range.period,
            view: range.view,
            from: getLocalDateString(prevFrom),
            to: getLocalDateString(prevTo)
        };
    }


    function getPreviousWord(range) {
        if (range.period === "daily") {
            return "yesterday";
        }

        if (range.period === "weekly") {
            return "last week";
        }

        if (range.period === "monthly") {
            return range.view === "year" ? "last year" : "last month";
        }

        return "the previous period";
    }


    function buildComparisonHtml(range, dishes, totalRevenue, matrix) {
        return "";
    }

    function renderSummary(range, reportData, matrix, dishes) {
        let element = document.getElementById("reportSummary");

        if (!element) {
            return;
        }

        element.innerHTML = "";

        if (!range || !reportData.length) {
            return;
        }

        let totalRevenue = 0;
        let totalPortions = 0;

        reportData.forEach(function (dish) {
            totalRevenue += dish.revenue;
            totalPortions += dish.portions;
        });

        let bestSeller = reportData.find(function (dish) {
            return dish.portions > 0;
        });

        /* 4th card: best day (multi-day) or data coverage (single day) */
        let fourth;

        if (matrix.length > 1) {
            let bestDay = null;

            matrix.forEach(function (day) {
                if (day.isFuture) {
                    return;
                }

                let revenue = day.dishes.reduce(function (sum, dish) {
                    return sum + dish.revenue;
                }, 0);

                if (revenue > 0 && (!bestDay || revenue > bestDay.revenue)) {
                    bestDay = { date: day.date, revenue: revenue };
                }
            });

            let bestDate = bestDay ? parseDate(bestDay.date) : null;

            fourth = {
                label: "Best Day",
                value: bestDate
                    ? bestDate.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric"
                    })
                    : "—",
                sub: bestDay
                    ? formatCurrency(bestDay.revenue)
                    : "No sales recorded"
            };
        } else {
            let counted = reportData.filter(function (dish) {
                return !dish.noData;
            }).length;

            fourth = {
                label: "Stock Counted",
                value: `${counted} of ${reportData.length}`,
                sub: "dishes have a stock count"
            };
        }

        let issues = reportData
            .filter(function (dish) {
                return dish.noData || dish.partial;
            })
            .map(function (dish) {
                return dish.noData
                    ? `<strong>${escapeHtmlReports(dish.dishName)}</strong>: no stock count recorded`
                    : `<strong>${escapeHtmlReports(dish.dishName)}</strong>: counted on ${dish.counted} of ${dish.pastDays} days`;
            });

        element.innerHTML = `
            <div class="report-summary-grid">
                <div class="report-summary-card">
                    <div class="rs-label">Total Revenue</div>
                    <div class="rs-value">${formatCurrency(totalRevenue)}</div>
                    ${buildComparisonHtml(range, dishes, totalRevenue, matrix)}
                </div>

                <div class="report-summary-card">
                    <div class="rs-label">Total Portions</div>
                    <div class="rs-value">${formatPortions(totalPortions)}</div>
                    <div class="rs-sub rs-flat">across ${reportData.length} dishes</div>
                </div>

                <div class="report-summary-card">
                    <div class="rs-label">Best Seller</div>
                    <div class="rs-value">${bestSeller ? escapeHtmlReports(bestSeller.dishName) : "—"}</div>
                    <div class="rs-sub rs-flat">${bestSeller ? formatPortions(bestSeller.portions) + " portions" : "No sales recorded"}</div>
                </div>

                <div class="report-summary-card">
                    <div class="rs-label">${fourth.label}</div>
                    <div class="rs-value">${fourth.value}</div>
                    <div class="rs-sub rs-flat">${fourth.sub}</div>
                </div>
            </div>

            ${issues.length ? `
                <div class="alert alert-warning py-2 px-3 mt-3 mb-0 small">
                    ⚠ Incomplete stock counts — sales for these dishes may be understated:
                    ${issues.join(" · ")}
                </div>` : ""}
        `;
    }


    /* =========================================================
       PERIOD NAVIGATION (previous / next)
       ========================================================= */

    function isDrilledMonth(period) {
        return period === "monthly" && selectedMonth !== null;
    }

    function canGoNext(period) {
        if (isDrilledMonth(period)) {
            let now = new Date();
            let year = now.getFullYear() + periodOffset;

            return year < now.getFullYear() ||
                (year === now.getFullYear() &&
                 selectedMonth < now.getMonth());
        }

        return periodOffset < 0;
    }

    function isCurrentPeriod(period) {
        if (isDrilledMonth(period)) {
            return periodOffset === 0 &&
                   selectedMonth === new Date().getMonth();
        }

        return periodOffset === 0;
    }

    function navigatePeriod(direction) {
        let select = document.getElementById("bestSellerPeriod");
        let period = select ? select.value : "daily";

        if (isDrilledMonth(period)) {
            let month = selectedMonth + direction;

            if (month < 0) {
                month = 11;
                periodOffset--;
            } else if (month > 11) {
                month = 0;
                periodOffset++;
            }

            selectedMonth = month;
        } else {
            periodOffset += direction;
        }

        if (periodOffset > 0) {
            periodOffset = 0;
        }

        renderReports();
    }

    function goToCurrentPeriod() {
        let select = document.getElementById("bestSellerPeriod");
        let period = select ? select.value : "daily";

        periodOffset = 0;

        if (isDrilledMonth(period)) {
            selectedMonth = new Date().getMonth();
        }

        renderReports();
    }

    function setDailyOffsetFromDate(value) {
        if (!value) {
            return;
        }

        let picked = new Date(value + "T00:00:00");
        let today = new Date();

        today.setHours(0, 0, 0, 0);

        if (isNaN(picked.getTime())) {
            return;
        }

        periodOffset = Math.min(
            0,
            Math.round((picked - today) / 86400000)
        );

        renderReports();
    }

    function createNavButton(text, disabled, handler) {
        let button = document.createElement("button");

        button.type = "button";
        button.className = "btn btn-sm btn-outline-secondary";
        button.textContent = text;
        button.disabled = disabled;

        button.addEventListener("click", handler);

        return button;
    }

    function renderReportNav(range) {
        let nav = document.getElementById("reportNav");

        if (!nav) {
            return;
        }

        let select = document.getElementById("bestSellerPeriod");
        let period = select ? select.value : "daily";

        nav.innerHTML = "";

        if (period === "custom") {
            nav.classList.add("d-none");
            return;
        }

        nav.classList.remove("d-none");

        let currentLabel;

        if (period === "daily") {
            currentLabel = "Today";
        } else if (period === "weekly") {
            currentLabel = "This week";
        } else if (isDrilledMonth(period)) {
            currentLabel = "This month";
        } else {
            currentLabel = "This year";
        }

        nav.appendChild(
            createNavButton("‹ Previous", false, function () {
                navigatePeriod(-1);
            })
        );

        nav.appendChild(
            createNavButton(
                currentLabel,
                isCurrentPeriod(period),
                goToCurrentPeriod
            )
        );

        nav.appendChild(
            createNavButton("Next ›", !canGoNext(period), function () {
                navigatePeriod(1);
            })
        );

        if (period === "daily") {
            let input = document.createElement("input");

            input.type = "date";
            input.className = "form-control form-control-sm report-nav-date";
            input.max = getLocalDateString(new Date());
            input.value = range ? range.from : "";

            input.addEventListener("change", function () {
                setDailyOffsetFromDate(input.value);
            });

            nav.appendChild(input);
        }
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
                range.view === "year"
                    ? "Report year: " + fromDate.getFullYear()
                    : "Report month: " + formatMonthYear(fromDate);
        }

        else {
            label.textContent =
                `Report range: ${formatLongDate(range.from)} – ${formatLongDate(range.to)}`;
        }
    }


    /* =========================================================
       MAIN REPORT RENDER
       ========================================================= */

    async function renderReports() {
        let range = getReportRange();
        updateReportPeriodLabel(range);
        renderReportNav(range);
        if (!range) { lastRender = null; renderRankingTable([]); renderSummary(null, [], [], []); renderBestSellerChart(null, [], []); return; }
        const tbody = document.getElementById("bestSellerTable");
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading report...</td></tr>';
        try {
            const url = "../api/reports.php?from=" + encodeURIComponent(range.from) + "&to=" + encodeURIComponent(range.to) + "&period=" + encodeURIComponent(range.period);
            const response = await fetch(url, { method: "GET", credentials: "same-origin", headers: { "Accept": "application/json" } });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to load report.");
            lastRender = { range: payload.range, reportData: payload.reportData || [], matrix: payload.matrix || [], dishes: payload.dishes || [] };
            renderRankingTable(lastRender.reportData);
            renderSummary(lastRender.range, lastRender.reportData, lastRender.matrix, lastRender.dishes);
            renderBestSellerChart(lastRender.range, lastRender.reportData, lastRender.matrix);
        } catch (error) {
            console.error("Reports API error:", error);
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">' + escapeHtmlReports(error.message || "Unable to load report.") + '</td></tr>';
            const summary = document.getElementById("reportSummary"); if (summary) summary.innerHTML = "";
            const chart = document.getElementById("bestSellerChart"); if (chart) chart.innerHTML = '<div class="text-center text-muted py-4">Report data could not be loaded.</div>';
        }
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

                    selectedMonth = null;
                    periodOffset = 0;

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

    function exportReport(format) {
        const range = getReportRange();
        if (!range) { alert("Choose a valid start and end date first."); return; }
        const url = "../api/reports.php?from=" + encodeURIComponent(range.from) + "&to=" + encodeURIComponent(range.to) + "&period=" + encodeURIComponent(range.period) + "&format=" + encodeURIComponent(format);
        fetch(url, { credentials: "same-origin" }).then(async response => {
            if (!response.ok) { let message = "Unable to export report."; try { const data = await response.json(); message = data.error || message; } catch (_) {} throw new Error(message); }
            const blob = await response.blob();
            const disposition = response.headers.get("Content-Disposition") || "";
            const match = disposition.match(/filename="?([^";]+)"?/i);
            const filename = match ? match[1] : ("tapsihan-best-seller." + (format === "xlsx" ? "xlsx" : "pdf"));
            const link = document.createElement("a"); const objectUrl = URL.createObjectURL(blob);
            link.href = objectUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
        }).catch(error => alert(error.message));
    }
    function initializeExportButtons() {
        const excelButton = document.getElementById("exportExcelButton");
        const pdfButton = document.getElementById("exportPdfButton");
        if (excelButton) excelButton.addEventListener("click", function () { exportReport("xlsx"); });
        if (pdfButton) pdfButton.addEventListener("click", function () { exportReport("pdf"); });
    }

    /* =========================================================
       LIVE REFRESH
       ========================================================= */

    // Reports refresh from MySQL through the shared PHP API.

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