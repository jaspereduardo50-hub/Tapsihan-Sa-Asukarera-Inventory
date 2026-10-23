/* ==========================================
   PORTION MAPPING
   Frontend-only JavaScript
   ========================================== */


/* ------------------------------------------
   Local Storage
   ------------------------------------------ */

const STORAGE_KEY = "portionMappings";
const PORTION_MAPPING_API = "portionmapping.php";

async function portionMappingRequest(method, payload = null) {
  const headers = { "Accept": "application/json" };
  const options = {
    method: method,
    credentials: "same-origin",
    cache: "no-store",
    headers: headers
  };

  if (payload !== null) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = sessionStorage.getItem("csrfToken") || "";
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(PORTION_MAPPING_API, options);
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("The server returned an invalid response. Check the PHP endpoint.");
  }
  if (!response.ok || !data || !data.ok) {
    throw new Error(data && data.error ? data.error : "Unable to save portion mapping.");
  }
  return data;
}

function showPortionMappingError(message) {
  alert(message || "Unable to connect to the database. Please try again.");
}

function showPortionMappingStatus(message, isError) {
  const table = document.getElementById("mappingTableBody");
  if (!table) return;
  const tableElement = table.closest("table") || table;
  const container = tableElement.parentElement;
  let box = document.getElementById("portionMappingDbStatus");
  if (!message) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "portionMappingDbStatus";
    box.setAttribute("role", "status");
    container.insertBefore(box, container.firstChild);
  }
  box.className = "alert " + (isError ? "alert-danger" : "alert-success") + " py-2 small";
  box.textContent = message;
}


/* ------------------------------------------
   DOM Elements
   ------------------------------------------ */

const dishNameInput = document.getElementById("dishName");
const sellingPriceInput = document.getElementById("sellingPrice");

const addIngredientBtn = document.getElementById("addIngredientBtn");
const ingredientsContainer = document.getElementById("ingredientsContainer");
const emptyIngredients = document.getElementById("emptyIngredients");

const saveMappingBtn = document.getElementById("saveMappingBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const mappingTableBody = document.getElementById("mappingTableBody");
const emptyMappings = document.getElementById("emptyMappings");


/* ------------------------------------------
   Edit State
   ------------------------------------------ */

let editingMappingId = null;


/* ------------------------------------------
   Load Existing Mappings
   ------------------------------------------ */

function getMappings() {
  const savedMappings = localStorage.getItem(STORAGE_KEY);

  if (!savedMappings) {
    return [];
  }

  try {
    return JSON.parse(savedMappings);
  } catch (error) {
    console.error("Unable to load portion mappings:", error);
    return [];
  }
}


/* ------------------------------------------
   Save Mappings
   ------------------------------------------ */

function saveMappings(mappings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
}


/* ------------------------------------------
   Generate ID
   ------------------------------------------ */

function generateId() {
  return Date.now().toString();
}


/* ------------------------------------------
   Update Empty Ingredient Message
   ------------------------------------------ */

function updateIngredientEmptyState() {
  if (ingredientsContainer.children.length === 0) {
    emptyIngredients.classList.remove("d-none");
  } else {
    emptyIngredients.classList.add("d-none");
  }
}


/* ------------------------------------------
   Add Ingredient Row
   ------------------------------------------ */

/* ------------------------------------------
   Add Ingredient Row
   ------------------------------------------ */

function addIngredientRow(ingredient = null) {

  const row = document.createElement("div");

  row.className = "ingredient-row";

  /*
     Find the inventory item saved in the mapping.
     This also supports older mappings that only
     have the ingredient name.
  */

  let selectedItem = null;

  if (ingredient) {

    selectedItem =
      inventory.find(function(item) {

        return (
          item.id === ingredient.itemId ||
          item.name === ingredient.name
        );

      }) || null;
  }


  /*
     Build ingredient options from the full inventory so measured staples
     such as rice can be mapped to dishes too.
  */

  let ingredientOptions = `
  <option value="">Select raw material</option>
  `;

  inventory
    .filter(function(item) {
      let category = String(item.category || "")
        .trim()
        .toLowerCase();

      return category === "meats" || category === "fish";
    })
    .forEach(function(item) {

      ingredientOptions += `
        <option
          value="${escapeHTML(item.id)}"
          ${selectedItem && selectedItem.id === item.id ? "selected" : ""}
        >
          ${escapeHTML(item.name)}
        </option>
      `;

    });

  /*
     Determine the stock unit.
     Existing mappings keep their saved unit.
     New mappings get the selected inventory unit.
  */

  let selectedUnit =
    selectedItem
      ? selectedItem.unit
      : (ingredient ? ingredient.unit : "");

  let availableUnits = Array.from(new Set(inventory
    .map(function(item) {
      return String(item.unit || "").trim();
    })
    .filter(Boolean)));

  if (selectedUnit && !availableUnits.includes(selectedUnit)) {
    availableUnits.push(selectedUnit);
  }

  let unitOptions = `
    <option value="">Select unit</option>
  `;

  availableUnits.forEach(function(unit) {
    unitOptions += `
      <option value="${escapeHTML(unit)}" ${selectedUnit === unit ? "selected" : ""}>
        ${escapeHTML(unit)}
      </option>
    `;
  });


  row.innerHTML = `
    <div class="row g-3 align-items-start">

      <!-- Ingredient Name -->
      <div class="col-md-3">

        <label class="form-label fw-semibold">
          Ingredient
        </label>

        <select
          class="form-select ingredient-name"
          required
        >

          ${ingredientOptions}

        </select>

      </div>


      <!-- Stock Unit -->
      <div class="col-md-2">

        <label class="form-label fw-semibold">
          Stock Unit
        </label>

        <select class="form-select ingredient-unit" required>
          ${unitOptions}
        </select>

      </div>


      <!-- Contains -->
      <div class="col-md-2">

        <label class="form-label fw-semibold">
          Contains
        </label>

        <input
          type="number"
          class="form-control ingredient-contains"
          min="0.01"
          step="0.01"
          placeholder="50"
          required
          value="${ingredient ? ingredient.contains : ""}"
        />

        <small class="text-muted">
          Per stock unit
        </small>

      </div>


      <!-- Used Per Order -->
      <div class="col-md-2">

        <label class="form-label fw-semibold">
          Used / Order
        </label>

        <input
          type="number"
          class="form-control ingredient-used"
          min="0.01"
          step="0.01"
          placeholder="2"
          required
          value="${ingredient ? ingredient.usedPerOrder : ""}"
        />

      </div>


      <!-- Estimated Servings -->
      <div class="col-md-2">

        <div class="estimated-servings">

          <span class="label">
            Servings
          </span>

          <span class="value ingredient-servings">
            ${
              ingredient
                ? calculateServings(
                    ingredient.contains,
                    ingredient.usedPerOrder
                  )
                : "0"
            }
          </span>

        </div>

      </div>


      <!-- Remove -->
      <div class="col-md-1 d-flex align-items-center justify-content-center">

        <button
          type="button"
          class="btn btn-outline-danger remove-ingredient-btn w-100"
          title="Remove ingredient"
        >
          ×
        </button>

      </div>

    </div>
  `;


  ingredientsContainer.appendChild(row);

  updateIngredientEmptyState();

  attachIngredientEvents(row);
}


/* ------------------------------------------
   Attach Ingredient Events
   ------------------------------------------ */

function attachIngredientEvents(row) {

  const ingredientSelect =
    row.querySelector(".ingredient-name");

  const unitSelect =
    row.querySelector(".ingredient-unit");

  const containsInput =
    row.querySelector(".ingredient-contains");

  const usedInput =
    row.querySelector(".ingredient-used");

  const servingsDisplay =
    row.querySelector(".ingredient-servings");

  const removeButton =
    row.querySelector(".remove-ingredient-btn");


  /* Calculate servings when values change */

  function updateServings() {

    const contains = parseFloat(containsInput.value);
    const used = parseFloat(usedInput.value);

    const servings = calculateServings(contains, used);

    servingsDisplay.textContent = servings;
  }


  containsInput.addEventListener("input", updateServings);

  usedInput.addEventListener("input", updateServings);

  /* Remove ingredient */

  removeButton.addEventListener("click", function () {

    row.remove();

    updateIngredientEmptyState();

  });
}


/* ------------------------------------------
   Calculate Estimated Servings
   ------------------------------------------ */

function calculateServings(contains, usedPerOrder) {

  const containsNumber = parseFloat(contains);
  const usedNumber = parseFloat(usedPerOrder);

  if (
    isNaN(containsNumber) ||
    isNaN(usedNumber) ||
    containsNumber <= 0 ||
    usedNumber <= 0
  ) {
    return 0;
  }

  const servings = containsNumber / usedNumber;

  return Math.floor(servings);
}


/* ------------------------------------------
   Collect Ingredients
   ------------------------------------------ */

/* ------------------------------------------
   Collect Ingredients
   ------------------------------------------ */

function collectIngredients() {

  const rows =
    ingredientsContainer.querySelectorAll(".ingredient-row");

  const ingredients = [];

  rows.forEach(function (row) {

    const ingredientSelect =
      row.querySelector(".ingredient-name");

    const unit =
      row.querySelector(".ingredient-unit").value;

    const contains =
      parseFloat(
        row.querySelector(".ingredient-contains").value
      );

    const usedPerOrder =
      parseFloat(
        row.querySelector(".ingredient-used").value
      );


    const itemId =
      ingredientSelect.value;


    const selectedOption =
      ingredientSelect.options[
        ingredientSelect.selectedIndex
      ];


    const name =
      selectedOption
        ? selectedOption.textContent.trim()
        : "";


    const servings =
      calculateServings(
        contains,
        usedPerOrder
      );


    ingredients.push({

      itemId: itemId,

      name: name,

      unit: unit,

      contains: contains,

      usedPerOrder: usedPerOrder,

      servings: servings

    });

  });

  return ingredients;
}


/* ------------------------------------------
   Validate Mapping
   ------------------------------------------ */

function validateMapping(dishName, sellingPrice, ingredients) {

  if (!dishName) {
    alert("Please enter the dish name.");
    dishNameInput.focus();
    return false;
  }


  if (
    isNaN(sellingPrice) ||
    sellingPrice <= 0
  ) {
    alert("Please enter a valid selling price.");
    sellingPriceInput.focus();
    return false;
  }


  if (ingredients.length === 0) {
    alert("Please add at least one portion-controlled ingredient.");
    return false;
  }


  for (let i = 0; i < ingredients.length; i++) {

    const ingredient = ingredients[i];

    if (!ingredient.itemId) {
      alert(
        `Please select an ingredient for ingredient ${i + 1}.`
      );
      return false;
    }


    if (!ingredient.unit) {
      alert(
        `Please select a stock unit for ${ingredient.name}.`
      );
      return false;
    }


    if (
      isNaN(ingredient.contains) ||
      ingredient.contains <= 0
    ) {
      alert(
        `Please enter a valid "Contains" quantity for ${ingredient.name}.`
      );
      return false;
    }


    if (
      isNaN(ingredient.usedPerOrder) ||
      ingredient.usedPerOrder <= 0
    ) {
      alert(
        `Please enter a valid "Used / Order" quantity for ${ingredient.name}.`
      );
      return false;
    }


    if (ingredient.servings <= 0) {
      alert(
        `The "Used / Order" quantity for ${ingredient.name} is too high.`
      );
      return false;
    }

  }


  return true;
}


/* ------------------------------------------
   Calculate Dish Estimated Servings
   ------------------------------------------ */

function calculateDishServings(ingredients) {

  if (ingredients.length === 0) {
    return 0;
  }

  const servings = ingredients.map(function (ingredient) {
    return ingredient.servings;
  });

  return Math.min(...servings);
}


/* ------------------------------------------
   Save Mapping
   ------------------------------------------ */

async function saveMapping() {
  const dishName = dishNameInput.value.trim();
  const sellingPrice = parseFloat(sellingPriceInput.value);
  const ingredients = collectIngredients();

  if (!validateMapping(dishName, sellingPrice, ingredients)) return;

  const wasEditing = editingMappingId !== null;
  const mappings = getMappings();
  const estimatedServings = calculateDishServings(ingredients);
  const existingIndex = editingMappingId === null
    ? -1
    : mappings.findIndex(mapping => String(mapping.id) === String(editingMappingId));

  if (existingIndex === -1 && mappings.some(mapping =>
      String(mapping.dishName).trim().toLowerCase() === dishName.toLowerCase())) {
    alert("A portion mapping for this dish already exists.");
    dishNameInput.focus();
    return;
  }
  if (existingIndex !== -1 && mappings.some((mapping, index) =>
      index !== existingIndex && String(mapping.dishName).trim().toLowerCase() === dishName.toLowerCase())) {
    alert("A portion mapping for this dish already exists.");
    dishNameInput.focus();
    return;
  }

  const payloadMapping = {
    dishName: dishName,
    sellingPrice: sellingPrice,
    ingredients: ingredients,
    estimatedServings: estimatedServings
  };
  if (editingMappingId !== null) payloadMapping.id = editingMappingId;

  saveMappingBtn.disabled = true;
  try {
    const data = await portionMappingRequest("POST", {
      action: "save",
      mapping: payloadMapping
    });
    const saved = data.mapping;
    const nextMappings = getMappings().filter(mapping => String(mapping.id) !== String(saved.id));
    nextMappings.push(saved);
    nextMappings.sort((a, b) => String(a.dishName).localeCompare(String(b.dishName)));
    saveMappings(nextMappings);
    resetForm();
    renderMappings();
    alert(wasEditing ? "Portion mapping updated in the database." : "Portion mapping saved to the database.");
  } catch (error) {
    showPortionMappingError(error.message);
  } finally {
    saveMappingBtn.disabled = false;
  }
}/* ------------------------------------------
   Render Existing Mappings
   ------------------------------------------ */

function renderMappings() {

  const mappings = getMappings();

  mappingTableBody.innerHTML = "";


  if (mappings.length === 0) {

    emptyMappings.classList.remove("d-none");

    return;
  }


  emptyMappings.classList.add("d-none");


  mappings.forEach(function (mapping) {

    const row =
      document.createElement("tr");


    const ingredientsHTML =
      mapping.ingredients
        .map(function (ingredient) {

          return `
            <div class="ingredient-item">
              <strong>${escapeHTML(ingredient.name)}</strong>
              -
              ${formatNumber(ingredient.usedPerOrder)}
              ${escapeHTML(ingredient.unit)}
              / Order
            </div>
          `;

        })
        .join("");


    row.innerHTML = `

      <td>
        <strong>
          ${escapeHTML(mapping.dishName)}
        </strong>
      </td>


      <td>
        ₱${formatCurrency(mapping.sellingPrice)}
      </td>


      <td>

        <div class="ingredient-list">
          ${ingredientsHTML}
        </div>

      </td>


      <td>
        <strong>
          ${mapping.estimatedServings}
        </strong>
      </td>


      <td>

        <div class="mapping-action-buttons">

          <button
            type="button"
            class="btn btn-sm btn-outline-primary edit-mapping-btn"
            data-id="${mapping.id}"
          >
            Edit
          </button>

          <button
            type="button"
            class="btn btn-sm btn-outline-danger delete-mapping-btn"
            data-id="${mapping.id}"
          >
            Delete
          </button>

        </div>

      </td>

    `;


    mappingTableBody.appendChild(row);

  });


  attachMappingActions();
}


/* ------------------------------------------
   Attach Table Actions
   ------------------------------------------ */

function attachMappingActions() {

  const editButtons =
    document.querySelectorAll(".edit-mapping-btn");

  const deleteButtons =
    document.querySelectorAll(".delete-mapping-btn");


  /* ------------------------------------------
     Edit
     ------------------------------------------ */

  editButtons.forEach(function (button) {

    button.addEventListener("click", function () {

      const id = button.dataset.id;

      editMapping(id);

    });

  });


  /* ------------------------------------------
     Delete
     ------------------------------------------ */

  deleteButtons.forEach(function (button) {

    button.addEventListener("click", function () {

      const id = button.dataset.id;

      deleteMapping(id);

    });

  });
}


/* ------------------------------------------
   Edit Mapping
   ------------------------------------------ */

function editMapping(id) {

  const mappings = getMappings();

  const mapping =
    mappings.find(
      mapping => mapping.id === id
    );


  if (!mapping) {
    return;
  }


  editingMappingId = id;


  /* Fill dish information */

  dishNameInput.value =
    mapping.dishName;

  sellingPriceInput.value =
    mapping.sellingPrice;


  /* Clear existing ingredient rows */

  ingredientsContainer.innerHTML = "";


  /* Add saved ingredients */

  mapping.ingredients.forEach(function (ingredient) {

    addIngredientRow(ingredient);

  });


  updateIngredientEmptyState();


  /* Change buttons */

  saveMappingBtn.textContent =
    "Update Mapping";

  cancelEditBtn.classList.remove("d-none");


  /* Scroll back to form */

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* ------------------------------------------
   Delete Mapping
   ------------------------------------------ */

async function deleteMapping(id) {
  const mappings = getMappings();
  const mapping = mappings.find(mapping => String(mapping.id) === String(id));
  if (!mapping) return;

  const confirmed = confirm(`Are you sure you want to delete the portion mapping for "${mapping.dishName}"?`);
  if (!confirmed) return;

  try {
    await portionMappingRequest("POST", { action: "delete", id: id });
    const updatedMappings = getMappings().filter(mapping => String(mapping.id) !== String(id));
    saveMappings(updatedMappings);
    if (String(editingMappingId) === String(id)) resetForm();
    renderMappings();
  } catch (error) {
    showPortionMappingError(error.message);
  }
}/* ------------------------------------------
   Reset Form
   ------------------------------------------ */

function resetForm() {

  editingMappingId = null;


  dishNameInput.value = "";

  sellingPriceInput.value = "";


  ingredientsContainer.innerHTML = "";


  updateIngredientEmptyState();


  saveMappingBtn.textContent =
    "Save Mapping";

  cancelEditBtn.classList.add("d-none");

}


/* ------------------------------------------
   Cancel Edit
   ------------------------------------------ */

function cancelEdit() {

  resetForm();

}


/* ------------------------------------------
   Number Formatting
   ------------------------------------------ */

function formatCurrency(value) {

  return Number(value).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

}


function formatNumber(value) {

  return Number(value).toLocaleString(
    "en-PH",
    {
      maximumFractionDigits: 2
    }
  );

}


/* ------------------------------------------
   Escape HTML
   Prevents HTML injection when displaying
   user-entered ingredient/dish names.
   ------------------------------------------ */

function escapeHTML(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


/* ------------------------------------------
   Event Listeners
   ------------------------------------------ */

addIngredientBtn.addEventListener(
  "click",
  function () {

    addIngredientRow();

  }
);


saveMappingBtn.addEventListener(
  "click",
  function () {

    saveMapping();

  }
);


cancelEditBtn.addEventListener(
  "click",
  function () {

    cancelEdit();

  }
);


/* ------------------------------------------
   Initial Load
   ------------------------------------------ */

updateIngredientEmptyState();

async function initializePortionMappings() {
  try {
    let data = await portionMappingRequest("GET");
    let databaseMappings = Array.isArray(data.mappings) ? data.mappings : [];
    const cachedMappings = getMappings();

    // Never automatically upload browser cache into an empty database: it may be stale.
    if (databaseMappings.length === 0 && cachedMappings.length > 0) {
      showPortionMappingStatus(
        "The database has no portion mappings, but this browser has a saved copy. It was NOT uploaded automatically because it may be outdated. Verify the database before recreating any mappings.",
        true
      );
      renderMappings();
      return;
    }

    saveMappings(databaseMappings);
    showPortionMappingStatus("", false);
    renderMappings();
  } catch (error) {
    renderMappings();
    showPortionMappingStatus("Could not refresh portion mappings from MySQL (" + error.message + "). The browser copy may be outdated; changes are not confirmed until the database connection works.", true);
  }
}

renderMappings();
initializePortionMappings();