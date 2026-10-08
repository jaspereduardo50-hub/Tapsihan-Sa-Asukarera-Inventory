function loadSupplierFields() {
    let itemSelect = document.getElementById("supplierItem");
    if (!itemSelect) return;

    let item = inventory.find(function(entry) {
        return entry.id === itemSelect.value;
    });

    let suppliers = item && Array.isArray(item.suppliers)
        ? item.suppliers
        : [];

    let slots = ["primary", "secondary", "backup"];

    slots.forEach(function(slot, index) {
        let supplier = suppliers[index] || {};

        let nameInput =
            document.getElementById(`${slot}SupplierName`);

        let contactInput =
            document.getElementById(`${slot}SupplierContact`);

        if (!nameInput || !contactInput) return;

        nameInput.value = supplier.name || "";
        contactInput.value = supplier.contact || "";

        nameInput.readOnly = Boolean(supplier.name);
        contactInput.readOnly = Boolean(supplier.contact);

        renderSupplierActions(
            slot,
            Boolean(supplier.name || supplier.contact)
        );
    });
}


function renderSupplierActions(slot, assigned) {
    let actions =
        document.querySelector(`[data-actions="${slot}"]`);

    if (!actions) return;

    actions.innerHTML = assigned
        ? `<button type="button"
                class="btn btn-outline-primary btn-sm edit-supplier"
                data-slot="${slot}">
                Edit
           </button>
           <button type="button"
                class="btn btn-outline-danger btn-sm remove-supplier"
                data-slot="${slot}">
                Remove
           </button>`
        : "";

    let editButton =
        actions.querySelector(".edit-supplier");

    if (editButton) {
        editButton.addEventListener("click", function() {

            let nameInput =
                document.getElementById(`${slot}SupplierName`);

            let contactInput =
                document.getElementById(`${slot}SupplierContact`);

            if (nameInput) {
                nameInput.readOnly = false;
            }

            if (contactInput) {
                contactInput.readOnly = false;
            }

            if (nameInput) {
                nameInput.focus();
            }

            showSupplierMessage(
                `Edit the ${slot} supplier details, then click Save Suppliers.`,
                "warning"
            );
        });
    }

    let removeButton =
        actions.querySelector(".remove-supplier");

    if (removeButton) {
        removeButton.addEventListener("click", function() {

            let item = inventory.find(function(entry) {
                return entry.id ===
                    document.getElementById("supplierItem").value;
            });

            if (!item) return;

            if (!Array.isArray(item.suppliers)) {
                item.suppliers = [null, null, null];
            }

            let slotIndex =
                ["primary", "secondary", "backup"].indexOf(slot);

            item.suppliers[slotIndex] = null;

            saveInventory();

            addAuditLog(
                "Suppliers",
                "Supplier Removed",
                `${item.id} - ${item.name}`,
                `Removed the ${slot} supplier assignment from ${item.name}.`
            );
            loadSupplierFields();
            displaySupplierProfiles();
            updateRestockSuppliers();

            showSupplierMessage(
                `${slot[0].toUpperCase() + slot.slice(1)} supplier removed.`,
                "success"
            );
        });
    }
}


function displaySupplierProfiles() {
    let table =
        document.getElementById("supplierProfilesTable");

    if (!table) return;

    table.innerHTML = "";

    if (!inventory.length) {
        table.innerHTML =
            `<tr>
                <td colspan="5"
                    class="text-center text-muted">
                    No raw materials found.
                </td>
            </tr>`;

        return;
    }

    inventory.forEach(function(item) {

        let suppliers =
            Array.isArray(item.suppliers)
                ? item.suppliers
                : [];

        let cells =
            ["Primary", "Secondary", "Backup"].map(
                function(role, index) {

                    let supplier = suppliers[index];

                    return supplier
                        ? `${escapeHtml(supplier.name)}
                           ${supplier.contact
                               ? `<br><small>${escapeHtml(supplier.contact)}</small>`
                               : ""}`
                        : `<span class="text-muted">
                            Not assigned
                           </span>`;
                }
            );

        let row = document.createElement("tr");

        row.innerHTML = `
            <td>
                ${escapeHtml(item.name)}<br>
                <small>
                    ${escapeHtml(displayItemId(item.id))}
                </small>
            </td>

            <td>${cells[0]}</td>
            <td>${cells[1]}</td>
            <td>${cells[2]}</td>

            <td class="text-nowrap">
                <button
                    type="button"
                    class="btn btn-sm btn-outline-primary edit-item-suppliers"
                    data-item-id="${escapeHtml(item.id)}">
                    Edit
                </button>

                <button
                    type="button"
                    class="btn btn-sm btn-outline-danger remove-item-suppliers"
                    data-item-id="${escapeHtml(item.id)}">
                    Remove
                </button>
            </td>
        `;

        table.appendChild(row);
    });
}


function editItemSuppliers(id) {
    let itemSelect =
        document.getElementById("supplierItem");

    if (
        !itemSelect ||
        !inventory.some(function(item) {
            return item.id === id;
        })
    ) {
        return;
    }

    itemSelect.value = id;

    loadSupplierFields();

    document.getElementById("supplierForm")
        ?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    showSupplierMessage(
        "Edit the supplier details, then select Save Suppliers Info.",
        "warning"
    );
}


function removeItemSuppliers(id) {
    let item = inventory.find(function(entry) {
        return entry.id === id;
    });

    if (
        !item ||
        !Array.isArray(item.suppliers) ||
        !item.suppliers.some(Boolean)
    ) {
        return;
    }

    if (
        !confirm(
            `Remove all suppliers from ${item.name}? Historical restock records will remain unchanged.`
        )
    ) {
        return;
    }

    item.suppliers = [null, null, null];

    saveInventory();
    addAuditLog(
        "Suppliers",
        "Suppliers Removed",
        `${item.id} - ${item.name}`,
        `Removed all assigned suppliers from ${item.name}. Historical restock records preserved.`
    );
    loadSupplierFields();
    displaySupplierProfiles();
    updateRestockSuppliers();

    showSupplierMessage(
        `Suppliers removed from ${item.name}. Historical restock records were preserved.`,
        "success"
    );
}


function showSupplierMessage(message, type) {
    let messageEl =
        document.getElementById("supplierMessage");

    if (!messageEl) return;

    messageEl.textContent = message;

    messageEl.className =
        `alert alert-${type} mt-3 mb-0`;
}


let supplierProfilesTable =
    document.getElementById("supplierProfilesTable");

if (supplierProfilesTable) {
    supplierProfilesTable.addEventListener(
        "click",
        function(event) {

            let editButton =
                event.target.closest(
                    ".edit-item-suppliers"
                );

            let removeButton =
                event.target.closest(
                    ".remove-item-suppliers"
                );

            if (editButton) {
                editItemSuppliers(
                    editButton.dataset.itemId
                );
            }

            if (removeButton) {
                removeItemSuppliers(
                    removeButton.dataset.itemId
                );
            }
        }
    );
}


let supplierItemSelect =
    document.getElementById("supplierItem");

if (supplierItemSelect) {
    supplierItemSelect.addEventListener(
        "change",
        function() {

            loadSupplierFields();
            displaySupplierProfiles();

        }
    );
}


let supplierForm =
    document.getElementById("supplierForm");

if (supplierForm) {
    supplierForm.addEventListener(
        "submit",
        function(event) {

            event.preventDefault();

            let item = inventory.find(function(entry) {
                return entry.id ===
                    document.getElementById(
                        "supplierItem"
                    ).value;
            });

            let slots =
                ["primary", "secondary", "backup"];

            let suppliers = [];

            for (
                let index = 0;
                index < slots.length;
                index++
            ) {

                let slot = slots[index];

                let name =
                    document.getElementById(
                        `${slot}SupplierName`
                    ).value.trim();

                let contact =
                    document.getElementById(
                        `${slot}SupplierContact`
                    ).value.trim();


                // Contact cannot exist without supplier name
                if (!name && contact) {

                    showSupplierMessage(
                        `${slot[0].toUpperCase() + slot.slice(1)} contact requires a supplier name.`,
                        "danger"
                    );

                    return;
                }


                // Contact validation
                if (contact) {

                    let isPhone =
                        /^0\d{10}$/.test(contact);

                    let isLink =
                        /^https?:\/\/.+/i.test(contact);

                    if (!isPhone && !isLink) {

                        showSupplierMessage(
                            `${slot[0].toUpperCase() + slot.slice(1)} contact must be an 11-digit phone number starting with 0 or a valid URL.`,
                            "danger"
                        );

                        return;
                    }
                }


                suppliers.push(
                    name
                        ? {
                            name: name,
                            contact: contact
                        }
                        : null
                );
            }


            if (!item) {

                showSupplierMessage(
                    "Select a raw material before saving suppliers.",
                    "danger"
                );

                return;
            }


            if (!suppliers.some(Boolean)) {

                showSupplierMessage(
                    "Assign at least one supplier.",
                    "danger"
                );

                return;
            }


            item.suppliers = suppliers;

            saveInventory();
            addAuditLog(
                "Suppliers",
                "Supplier Updated",
                `${item.id} - ${item.name}`,
                `Saved supplier assignments for ${item.name}.`
            );

            displaySupplierProfiles();
            updateRestockSuppliers();

            showSupplierMessage(
                `Suppliers saved for ${item.name}.`,
                "success"
            );
        }
    );
}


// Initialize Supplier page
if (document.getElementById("supplierProfilesTable")) {
    displaySupplierProfiles();
}

if (document.getElementById("supplierItem")) {
    loadSupplierFields();
}