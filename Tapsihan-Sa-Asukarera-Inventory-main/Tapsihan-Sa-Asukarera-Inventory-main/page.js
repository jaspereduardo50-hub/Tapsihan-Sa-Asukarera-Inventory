const user = JSON.parse(sessionStorage.getItem("currentUser")) || { role: "owner", name: "Owner" };
const access = {
    owner: ["dashboard", "inventory", "stock", "restock", "waste", "suppliers", "reconciliation", "reports", "history"],
    staff: ["dashboard", "inventory", "stock", "restock", "waste"]
};
const seed = [
    { id: "RM-001", name: "Beef Tapa", category: "Meats", unit: "portions", stock: 38, minimum: 20 },
    { id: "RM-002", name: "Chicken Fillet", category: "Meats", unit: "portions", stock: 28, minimum: 15 },
    { id: "RM-003", name: "Hotdog", category: "Meats", unit: "pieces", stock: 12, minimum: 20 },
    { id: "RM-004", name: "Rice", category: "Rice", unit: "kilograms", stock: 18, minimum: 10 },
    { id: "RM-005", name: "Eggs", category: "Eggs", unit: "pieces", stock: 34, minimum: 30 },
    { id: "RM-006", name: "Soy Sauce", category: "Condiments", unit: "packs", stock: 8, minimum: 5 },
    { id: "RM-007", name: "Calamansi", category: "Other", unit: "pieces", stock: 16, minimum: 10 }
];
const state = JSON.parse(localStorage.getItem("inventoryState")) || { inventory: seed, restocks: [], wastes: [], stockCounts: [] };
const today = new Date().toISOString().split("T")[0];
const $ = id => document.getElementById(id);
const save = () => localStorage.setItem("inventoryState", JSON.stringify(state));
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
const badge = item => `<span class="badge ${item.stock < item.minimum ? "bg-danger" : "bg-success"}">${item.stock < item.minimum ? "LOW STOCK" : "IN STOCK"}</span>`;

document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.page === document.body.dataset.page);
    link.classList.toggle("d-none", !(access[user.role] || access.staff).includes(link.dataset.page));
});
text("userName", user.name);
text("userRole", user.role === "owner" ? "Administrator" : "Staff");
text("userAvatar", user.role === "owner" ? "O" : "S");
text("ownerBadge", user.role.toUpperCase());
text("currentDate", new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }));
$("logoutButton")?.addEventListener("click", () => { sessionStorage.removeItem("currentUser"); location.href = "Login/login.html"; });
$("menuButton")?.addEventListener("click", () => $("sidebar")?.classList.toggle("show"));
document.querySelectorAll("input[type=date]").forEach(input => { if (!input.value) input.value = today; });

function renderInventory() {
    const table = $("inventoryTable");
    if (!table) return;
    const search = ($("searchInventory")?.value || "").toLowerCase();
    const category = $("categoryFilter")?.value || "";
    const status = $("statusFilter")?.value || "";
    table.innerHTML = state.inventory.filter(item => item.name.toLowerCase().includes(search) && (!category || item.category === category) && (!status || (status === "low" ? item.stock < item.minimum : item.stock >= item.minimum))).map(item => `<tr><td>${item.id}</td><td>${item.name}</td><td>${item.category}</td><td>${item.unit}</td><td>${item.stock}</td><td>${item.minimum}</td><td>${badge(item)}</td><td><button class="btn btn-sm btn-outline-danger" data-archive="${item.id}">Archive</button></td></tr>`).join("");
}

function updateSummary() {
    const low = state.inventory.filter(item => item.stock < item.minimum).length;
    const waste = state.wastes.filter(item => item.date === today).reduce((sum, item) => sum + Number(item.quantity), 0);
    const restocked = state.restocks.filter(item => item.date === today).reduce((sum, item) => sum + Number(item.quantity), 0);
    text("totalItems", state.inventory.length);
    text("lowStock", low);
    text("wasteToday", waste);
    text("restockedToday", restocked);
    text("reportTotalItems", state.inventory.length);
    text("reportLowStock", low);
    text("reportWasteToday", waste);
    text("reportRestockedToday", restocked);
}

renderInventory();
updateSummary();