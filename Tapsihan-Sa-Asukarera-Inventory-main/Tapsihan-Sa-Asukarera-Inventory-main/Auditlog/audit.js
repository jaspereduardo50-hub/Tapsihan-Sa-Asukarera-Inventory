function renderAuditTable() {
    let table = document.getElementById("systemAuditTable");
    if (!table) return;

    table.innerHTML = "";

    let from = document.getElementById("auditFrom")?.value || "";
    let to = document.getElementById("auditTo")?.value || "";
    let module = document.getElementById("auditModule")?.value || "";
    let search = (document.getElementById("auditSearch")?.value || "").toLowerCase();

    let filtered = systemAuditLogs.filter(function(log) {
        let logDate = new Date(log.timestamp).toISOString().slice(0, 10);
        let matchesDate = (!from || logDate >= from) && (!to || logDate <= to);
        let matchesModule = !module || log.module === module;
        let searchText = `${log.module} ${log.action} ${log.target} ${log.details}`.toLowerCase();
        let matchesSearch = !search || searchText.includes(search);
        return matchesDate && matchesModule && matchesSearch;
    });

    if (!filtered.length) {
        table.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    No audit entries found.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(function(log) {
        let row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(log.timestamp)}</td>
            <td>${escapeHtml(log.module)}</td>
            <td>${escapeHtml(log.action)}</td>
            <td>${escapeHtml(log.target)}</td>
            <td>${escapeHtml(log.user)}</td>
            <td>${escapeHtml(log.details)}</td>
        `;
        table.appendChild(row);
    });
}

["auditFrom", "auditTo", "auditModule", "auditSearch"].forEach(function(id) {
    let element = document.getElementById(id);
    if (element) {
        element.addEventListener("input", renderAuditTable);
        element.addEventListener("change", renderAuditTable);
    }
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderAuditTable);
} else {
    renderAuditTable();
}
