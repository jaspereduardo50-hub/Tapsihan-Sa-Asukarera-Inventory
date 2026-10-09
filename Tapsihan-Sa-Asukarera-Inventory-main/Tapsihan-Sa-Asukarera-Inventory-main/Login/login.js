/* ==========================================
   LOGIN - talks to the PHP server (api/auth/*.php).
   No passwords or accounts are stored in the browser anymore.
   ========================================== */

// Remove the old browser-stored accounts from earlier versions
localStorage.removeItem("tapsihanAccounts");

const passwordToggle = document.getElementById("toggleLoginPassword");
const passwordInput = document.getElementById("loginPassword");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const submitButton = loginForm.querySelector('button[type="submit"]');

// sessionStorage only caches the name/role for display. The PHP session is the real login.
function cacheLogin(data) {
    sessionStorage.setItem("currentUser", JSON.stringify({
        role: data.user.role,
        name: data.user.name,
        email: data.user.email,
        active: true,
        authenticatedAt: Date.now()
    }));
    sessionStorage.setItem("csrfToken", data.csrf);
}

function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.remove("d-none");
}

// Already logged in (for example in a new tab)? Go straight to the dashboard.
(async function checkExistingSession() {
    try {
        let response = await fetch("../api/auth/me.php", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        let data = await response.json();
        if (data && data.ok) {
            cacheLogin(data);
            window.location.replace("../Dashboard/dashboard.html");
        }
    } catch (error) {
        /* server unreachable: stay on the login page */
    }
})();

document.getElementById("loginIdentifier").addEventListener("input", function() {
    if (!this.value) return;
    this.value = this.value.charAt(0).toUpperCase() + this.value.slice(1);
});

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

    loginError.classList.add("d-none");
    if (submitButton) submitButton.disabled = true;

    try {
        let response = await fetch("../api/auth/login.php", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                identifier: document.getElementById("loginIdentifier").value.trim(),
                password: passwordInput.value
            })
        });

        let data = null;
        try {
            data = await response.json();
        } catch (parseError) {
            data = null;
        }

        if (response.ok && data && data.ok) {
            cacheLogin(data);
            window.location.href = "../Dashboard/dashboard.html";
            return;
        }

        showLoginError(data && data.error ? data.error : "Login failed. Please try again.");
    } catch (error) {
        showLoginError("Cannot reach the server. Open the system through your web server (for example http://localhost/...), not by double-clicking the file.");
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
});
