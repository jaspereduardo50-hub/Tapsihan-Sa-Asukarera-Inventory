/* ==========================================
   PORTION MAPPING
   Frontend-only JavaScript
   ========================================== */


/* ------------------------------------------
   Local Storage
   ------------------------------------------ */

const STORAGE_KEY = "portionMappings";


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
     Build Meat / Fish inventory options
  */

  let ingredientOptions = `
    <option value="">Select raw material</option>
  `;

  inventory
    .filter(function(item) {

      return (
        item.category === "Meats" ||
        item.category === "Fish"
      );

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

          <option value="">Select unit</option>

          <option value="Piece"
            ${selectedUnit === "Piece" ? "selected" : ""}>
            Piece
          </option>

          <option value="Portion"
            ${selectedUnit === "Portion" ? "selected" : ""}>
            Portion
          </option>

          <option value="Pack"
            ${selectedUnit === "Pack" ? "selected" : ""}>
            Pack
          </option>

          <option value="Tray"
            ${selectedUnit === "Tray" ? "selected" : ""}>
            Tray
          </option>

          <option value="Box"
            ${selectedUnit === "Box" ? "selected" : ""}>
            Box
          </option>

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

function saveMapping() {

  const dishName =
    dishNameInput.value.trim();

  const sellingPrice =
    parseFloat(sellingPriceInput.value);

  const ingredients =
    collectIngredients();


  if (
    !validateMapping(
      dishName,
      sellingPrice,
      ingredients
    )
  ) {
    return;
  }


  const mappings = getMappings();

  const estimatedServings =
    calculateDishServings(ingredients);


  /* ------------------------------------------
     Edit Existing Mapping
     ------------------------------------------ */

  if (editingMappingId !== null) {

    const index =
      mappings.findIndex(
        mapping => mapping.id === editingMappingId
      );


    if (index !== -1) {

      mappings[index] = {
        ...mappings[index],
        dishName: dishName,
        sellingPrice: sellingPrice,
        ingredients: ingredients,
        estimatedServings: estimatedServings
      };

    }

    saveMappings(mappings);
    addAuditLog(
      "Portion Mapping",
      "Mapping Updated",
      dishName,
      `Updated portion mapping for ${dishName} with ${ingredients.length} ingredients and selling price ₱${formatCurrency(sellingPrice)}.`
    );

    alert("Portion mapping updated successfully.");

  }


  /* ------------------------------------------
     Add New Mapping
     ------------------------------------------ */

  else {

    const newMapping = {

      id: generateId(),

      dishName: dishName,

      sellingPrice: sellingPrice,

      ingredients: ingredients,

      estimatedServings: estimatedServings

    };


    mappings.push(newMapping);

    saveMappings(mappings);
    addAuditLog(
      "Portion Mapping",
      "Mapping Created",
      dishName,
      `Created portion mapping for ${dishName} with ${ingredients.length} ingredients and selling price ₱${formatCurrency(sellingPrice)}.`
    );

    alert("Portion mapping saved successfully.");

  }


  resetForm();

  renderMappings();
}


/* ------------------------------------------
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
              / order
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

function deleteMapping(id) {

  const mappings = getMappings();

  const mapping =
    mappings.find(
      mapping => mapping.id === id
    );


  if (!mapping) {
    return;
  }


  const confirmed =
    confirm(
      `Are you sure you want to delete the portion mapping for "${mapping.dishName}"?`
    );


  if (!confirmed) {
    return;
  }


  const updatedMappings =
    mappings.filter(
      mapping => mapping.id !== id
    );


  saveMappings(updatedMappings);
  addAuditLog(
    "Portion Mapping",
    "Mapping Deleted",
    mapping.dishName,
    `Deleted portion mapping for ${mapping.dishName}.`
  );


  if (editingMappingId === id) {
    resetForm();
  }


  renderMappings();

}


/* ------------------------------------------
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

renderMappings();