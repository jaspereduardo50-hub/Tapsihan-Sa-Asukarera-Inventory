const defaultAccounts = {
    owner: {
        username: "owner",
        email: "owner@tapsihan.local",
        password: "owner123",
        name: "Owner",
        role: "owner",
        active: true
    },
    staff: {
        username: "staff",
        email: "staff@tapsihan.local",
        password: "staff123",
        name: "Staff",
        role: "staff",
        active: true
    }
};

let accounts = { ...defaultAccounts };
try {
    let savedAccounts = JSON.parse(localStorage.getItem("tapsihanAccounts") || "{}");
    if (savedAccounts && typeof savedAccounts === "object") accounts = { ...accounts, ...savedAccounts };
} catch (error) {
    localStorage.removeItem("tapsihanAccounts");
}

async function hashPassword(password) {
    let bytes = new TextEncoder().encode(password);
    let digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function(byte) {
        return byte.toString(16).padStart(2, "0");
    }).join("");
}

const passwordToggle = document.getElementById("toggleLoginPassword");
const passwordInput = document.getElementById("loginPassword");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

passwordToggle.addEventListener("click", function() {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    this.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    this.setAttribute("aria-pressed", String(!isVisible));
});

loginForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    if (!loginForm.checkValidity()) {
        loginForm.reportValidity();
        return;
    }

    const identifier = document.getElementById("loginIdentifier").value.trim().toLowerCase();
    let password = document.getElementById("loginPassword").value;
    let error = document.getElementById("loginError");
    let account = Object.values(accounts).find(function(entry) {
        return identifier === entry.username.toLowerCase() || identifier === entry.email.toLowerCase();
    });

    let passwordHash = await hashPassword(password);

    if (account && !account.passwordHash && account.password) {
        account.passwordHash = await hashPassword(account.password);
    }

    if (account && account.active === false) {
        error.textContent = "This account is inactive. Please contact the administrator.";
        error.classList.remove("d-none");
        return;
    }

    if (account && passwordHash === account.passwordHash) {
        sessionStorage.setItem("currentUser", JSON.stringify({
            role: account.role,
            name: account.name,
            email: account.email,
            active: account.active !== false,
            authenticatedAt: Date.now()
        }));

        window.location.href = "../Dashboard/dashboard.html";
    } else {
        error.textContent = "Invalid username or password.";
        error.classList.remove("d-none");
    }
});

