// ============================================================
// POULTRY MEDICINE MANAGER
// Version 1.0.0
// Main Application
// ============================================================

import {
  auth,
  db
} from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


// ============================================================
// CONFIG
// ============================================================

const APP_VERSION = "1.0.0";

const EXPIRY_WARNING_DAYS = 30;

const DEFAULT_MIN_STOCK = 5;


// ============================================================
// STATE
// ============================================================

let currentUser = null;

let userProfile = null;

let medicines = [];

let sales = [];

let historyRecords = [];

let pendingConfirmAction = null;

let notificationPermissionAsked = false;


// ============================================================
// DOM
// ============================================================

const $ = (id) => document.getElementById(id);

const loadingScreen = $("loadingScreen");

const authSection = $("authSection");

const appSection = $("appSection");


// ============================================================
// UTILITY
// ============================================================

function todayISO() {

  const date = new Date();

  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function formatDate(value) {

  if (!value) return "—";

  let date;

  if (
    typeof value === "object" &&
    typeof value.toDate === "function"
  ) {

    date = value.toDate();

  } else {

    date = new Date(`${value}T00:00:00`);

  }

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}


function formatNumber(value) {

  const number = Number(value || 0);

  return number.toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}


function escapeHTML(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function daysUntil(dateString) {

  if (!dateString) return Infinity;

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const expiry = new Date(`${dateString}T00:00:00`);

  expiry.setHours(0, 0, 0, 0);

  return Math.ceil(
    (expiry - today) / 86400000
  );
}


function isExpired(dateString) {

  return daysUntil(dateString) < 0;
}


function isExpiringSoon(dateString) {

  const days = daysUntil(dateString);

  return days >= 0 && days <= EXPIRY_WARNING_DAYS;
}


function getInitial(name) {

  if (!name) return "U";

  return name.trim().charAt(0).toUpperCase();
}


function normalizeQuantity(value) {

  return Number(
    Number(value || 0).toFixed(2)
  );

}


function getTotalStock(medicine) {

  return (medicine.batches || [])
    .reduce(
      (total, batch) =>
        total + Number(batch.quantity || 0),
      0
    );

}


function getActiveBatches(medicine) {

  return (medicine.batches || [])
    .filter(batch =>
      Number(batch.quantity || 0) > 0
    );

}


function getMedicineStatus(medicine) {

  const total = getTotalStock(medicine);

  const batches = getActiveBatches(medicine);

  if (total <= 0) {
    return "out";
  }

  if (
    batches.some(batch =>
      isExpired(batch.expiryDate)
    )
  ) {

    const nonExpiredStock =
      batches
        .filter(batch =>
          !isExpired(batch.expiryDate)
        )
        .reduce(
          (sum, batch) =>
            sum + Number(batch.quantity || 0),
          0
        );

    if (nonExpiredStock <= 0) {
      return "expired";
    }
  }


  if (
    batches.some(batch =>
      isExpiringSoon(batch.expiryDate)
    )
  ) {
    return "expiring";
  }


  if (
    total <=
    Number(medicine.minStock ?? DEFAULT_MIN_STOCK)
  ) {
    return "low";
  }


  return "available";
}


function getStatusLabel(status) {

  const labels = {
    available: "Available",
    low: "Low Stock",
    out: "Out of Stock",
    expired: "Expired",
    expiring: "Expiring Soon"
  };

  return labels[status] || status;
}


function getStatusClass(status) {

  return {
    available: "status-available",
    low: "status-low",
    out: "status-out",
    expired: "status-expired",
    expiring: "status-expiring"
  }[status] || "status-available";

}


function getNextExpiry(medicine) {

  const batches = getActiveBatches(medicine);

  if (!batches.length) return null;

  return batches
    .sort((a, b) =>
      String(a.expiryDate)
        .localeCompare(String(b.expiryDate))
    )[0];

}


// ============================================================
// TOAST
// ============================================================

function toast(message, type = "success") {

  const container = $("toastContainer");

  const item = document.createElement("div");

  item.className = `toast ${type}`;

  item.textContent = message;

  container.appendChild(item);

  setTimeout(() => {

    item.style.opacity = "0";

    item.style.transform = "translateY(8px)";

    setTimeout(() => item.remove(), 250);

  }, 3500);

}


// ============================================================
// AUTH UI
// ============================================================

function showLogin() {

  $("loginCard").classList.remove("hidden");

  $("registerCard").classList.add("hidden");

}


function showRegister() {

  $("loginCard").classList.add("hidden");

  $("registerCard").classList.remove("hidden");

}


$("showRegisterBtn").addEventListener(
  "click",
  showRegister
);


$("showLoginBtn").addEventListener(
  "click",
  showLogin
);


// ============================================================
// REGISTER
// ============================================================

$("registerForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    const name =
      $("registerName").value.trim();

    const business =
      $("registerBusiness").value.trim();

    const email =
      $("registerEmail").value.trim();

    const password =
      $("registerPassword").value;

    if (name.length < 2) {

      toast(
        "Please enter your full name.",
        "error"
      );

      return;
    }


    if (password.length < 6) {

      toast(
        "Password must contain at least 6 characters.",
        "error"
      );

      return;
    }


    const button =
      event.submitter;

    button.disabled = true;

    button.textContent = "Creating account...";


    try {

      const credential =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      const user =
        credential.user;


      await updateProfile(
        user,
        {
          displayName: name
        }
      );


      await setDoc(
        doc(
          db,
          "users",
          user.uid
        ),
        {
          name,
          businessName: business,
          email: user.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );


      toast(
        "Account created successfully."
      );


      $("registerForm").reset();

    } catch (error) {

      handleFirebaseError(error);

    } finally {

      button.disabled = false;

      button.textContent =
        "Create Account";

    }

  }
);


// ============================================================
// LOGIN
// ============================================================

$("loginForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    const email =
      $("loginEmail").value.trim();

    const password =
      $("loginPassword").value;

    const button =
      event.submitter;

    button.disabled = true;

    button.textContent = "Signing in...";


    try {

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      $("loginForm").reset();

    } catch (error) {

      handleFirebaseError(error);

    } finally {

      button.disabled = false;

      button.textContent = "Sign In";

    }

  }
);


// ============================================================
// FORGOT PASSWORD
// ============================================================

$("forgotPasswordBtn").addEventListener(
  "click",
  async () => {

    const email =
      $("loginEmail").value.trim();

    if (!email) {

      toast(
        "Enter your email address first.",
        "warning"
      );

      $("loginEmail").focus();

      return;
    }


    try {

      await sendPasswordResetEmail(
        auth,
        email
      );

      toast(
        "Password reset email sent."
      );

    } catch (error) {

      handleFirebaseError(error);

    }

  }
);


// ============================================================
// FIREBASE ERROR HANDLING
// ============================================================

function handleFirebaseError(error) {

  console.error(error);

  const code =
    error?.code || "";

  const messages = {

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/user-not-found":
      "No account was found with this email.",

    "auth/wrong-password":
      "Incorrect email or password.",

    "auth/invalid-credential":
      "Incorrect email or password.",

    "auth/email-already-in-use":
      "This email is already registered.",

    "auth/weak-password":
      "Password is too weak. Use at least 6 characters.",

    "auth/network-request-failed":
      "Network error. Please check your internet connection.",

    "auth/too-many-requests":
      "Too many attempts. Please try again later.",

    "permission-denied":
      "You do not have permission to perform this action."

  };


  toast(
    messages[code] ||
    error?.message ||
    "Something went wrong.",
    "error"
  );

}


// ============================================================
// AUTH STATE
// ============================================================

onAuthStateChanged(
  auth,
  async (user) => {

    currentUser = user;


    if (user) {

      authSection.classList.add("hidden");

      appSection.classList.remove("hidden");

      await loadUserWorkspace();

    } else {

      appSection.classList.add("hidden");

      authSection.classList.remove("hidden");

      showLogin();

    }


    loadingScreen.classList.add("hidden");

  }
);


// ============================================================
// USER WORKSPACE
// ============================================================

async function loadUserWorkspace() {

  await loadProfile();

  await loadAllData();

  setDefaultDates();

  renderEverything();

}


// ============================================================
// PROFILE
// ============================================================

async function loadProfile() {

  if (!currentUser) return;

  const reference =
    doc(
      db,
      "users",
      currentUser.uid
    );

  const snapshot =
    await getDoc(reference);


  if (snapshot.exists()) {

    userProfile =
      {
        id: snapshot.id,
        ...snapshot.data()
      };

  } else {

    userProfile = {

      id: currentUser.uid,

      name:
        currentUser.displayName ||
        "User",

      businessName: "",

      email:
        currentUser.email || ""

    };

  }


  renderProfile();

}


function renderProfile() {

  if (!currentUser) return;

  const name =
    userProfile?.name ||
    currentUser.displayName ||
    "User";

  const email =
    currentUser.email || "";

  $("welcomeTitle").textContent =
    `Welcome, ${name.split(" ")[0]}`;

  $("profileAvatar").textContent =
    getInitial(name);

  $("profileName").textContent =
    name;

  $("profileEmail").textContent =
    email;

  $("profileNameInput").value =
    name;

  $("profileBusinessInput").value =
    userProfile?.businessName || "";

  $("profileEmailInput").value =
    email;

}


// ============================================================
// PROFILE SAVE
// ============================================================

$("profileForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    if (!currentUser) return;

    const name =
      $("profileNameInput").value.trim();

    const businessName =
      $("profileBusinessInput").value.trim();


    if (name.length < 2) {

      toast(
        "Please enter a valid name.",
        "error"
      );

      return;
    }


    try {

      await updateProfile(
        currentUser,
        {
          displayName: name
        }
      );


      await setDoc(
        doc(
          db,
          "users",
          currentUser.uid
        ),
        {
          name,
          businessName,
          email: currentUser.email,
          updatedAt: serverTimestamp()
        },
        {
          merge: true
        }
      );


      userProfile = {

        ...userProfile,

        name,

        businessName

      };


      renderProfile();

      toast(
        "Profile updated successfully."
      );

    } catch (error) {

      handleFirebaseError(error);

    }

  }
);


// ============================================================
// LOAD DATA
// ============================================================

async function loadAllData() {

  if (!currentUser) return;


  try {

    const medicinesRef =
      collection(
        db,
        "users",
        currentUser.uid,
        "medicines"
      );


    const salesRef =
      collection(
        db,
        "users",
        currentUser.uid,
        "sales"
      );


    const historyRef =
      collection(
        db,
        "users",
        currentUser.uid,
        "history"
      );


    const [
      medicinesSnapshot,
      salesSnapshot,
      historySnapshot
    ] = await Promise.all([

      getDocs(medicinesRef),

      getDocs(
        query(
          salesRef,
          orderBy(
            "createdAt",
            "desc"
          ),
          limit(200)
        )
      ),

      getDocs(
        query(
          historyRef,
          orderBy(
            "createdAt",
            "desc"
          ),
          limit(300)
        )
      )

    ]);


    medicines =
      medicinesSnapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );


    sales =
      salesSnapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );


    historyRecords =
      historySnapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );


  } catch (error) {

    console.error(error);

    handleFirebaseError(error);

  }

}


// ============================================================
// RENDER EVERYTHING
// ============================================================

function renderEverything() {

  renderDashboard();

  renderMedicines();

  renderSales();

  renderHistory();

  renderAlerts();

  populateSaleMedicineSelect();

  renderProfile();

}


// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {

  const totalMedicines =
    medicines.length;


  const totalStock =
    medicines.reduce(
      (sum, medicine) =>
        sum + getTotalStock(medicine),
      0
    );


  const lowStock =
    medicines.filter(
      medicine =>
        getMedicineStatus(medicine) === "low"
    ).length;


  const expiring =
    medicines.filter(
      medicine =>
        (medicine.batches || [])
          .some(batch =>
            Number(batch.quantity || 0) > 0 &&
            isExpiringSoon(batch.expiryDate)
          )
    ).length;


  $("totalMedicines").textContent =
    formatNumber(totalMedicines);

  $("totalStock").textContent =
    formatNumber(totalStock);

  $("lowStockCount").textContent =
    formatNumber(lowStock);

  $("expiringCount").textContent =
    formatNumber(expiring);


  const alerts =
    getAlertMedicines()
      .slice(0, 5);


  if (!alerts.length) {

    $("dashboardAlerts").innerHTML =
      `<div class="empty-state">
        No expiry alerts.
      </div>`;

  } else {

    $("dashboardAlerts").innerHTML =
      alerts
        .map(renderAlertItem)
        .join("");

  }


  const lowItems =
    medicines
      .filter(
        medicine =>
          getMedicineStatus(medicine) === "low" ||
          getMedicineStatus(medicine) === "out"
      )
      .slice(0, 5);


  if (!lowItems.length) {

    $("dashboardLowStock").innerHTML =
      `<div class="empty-state">
        No low-stock medicines.
      </div>`;

  } else {

    $("dashboardLowStock").innerHTML =
      lowItems
        .map(
          medicine => `
            <div class="batch-row">

              <div class="batch-row-top">

                <span>
                  ${escapeHTML(medicine.name)}
                </span>

                <span>
                  ${formatNumber(
                    getTotalStock(medicine)
                  )}
                  ${escapeHTML(
                    medicine.unit || ""
                  )}
                </span>

              </div>

              <div class="batch-row-bottom">

                <span>
                  ${getStatusLabel(
                    getMedicineStatus(medicine)
                  )}
                </span>

                <span>
                  Minimum:
                  ${formatNumber(
                    medicine.minStock
                  )}
                </span>

              </div>

            </div>
          `
        )
        .join("");

  }


  const recent =
    historyRecords.slice(0, 8);


  if (!recent.length) {

    $("dashboardHistory").innerHTML =
      `<div class="empty-state">
        No activity yet.
      </div>`;

  } else {

    $("dashboardHistory").innerHTML =
      renderHistoryTable(recent);

  }

}


// ============================================================
// ALERT DATA
// ============================================================

function getAlertMedicines() {

  const alerts = [];


  for (const medicine of medicines) {

    for (const batch of medicine.batches || []) {

      const quantity =
        Number(batch.quantity || 0);

      if (quantity <= 0) continue;


      const days =
        daysUntil(batch.expiryDate);


      if (days < 0) {

        alerts.push({

          type: "expired",

          medicine,

          batch,

          days

        });

      } else if (days <= EXPIRY_WARNING_DAYS) {

        alerts.push({

          type: "expiring",

          medicine,

          batch,

          days

        });

      }

    }


    const status =
      getMedicineStatus(medicine);


    if (status === "low") {

      alerts.push({

        type: "low",

        medicine,

        batch: null,

        days: null

      });

    }


    if (status === "out") {

      alerts.push({

        type: "out",

        medicine,

        batch: null,

        days: null

      });

    }

  }


  return alerts.sort(
    (a, b) => {

      const order = {

        expired: 0,

        expiring: 1,

        out: 2,

        low: 3

      };

      return order[a.type] - order[b.type];

    }
  );

}


// ============================================================
// ALERT ITEM
// ============================================================

function renderAlertItem(alert) {

  const medicine =
    alert.medicine;


  if (alert.type === "expired") {

    return `
      <div class="alert-item expired">

        <div class="alert-icon">
          🚨
        </div>

        <div class="alert-content">

          <strong>
            ${escapeHTML(medicine.name)}
          </strong>

          <span>
            Batch ${escapeHTML(
              alert.batch.batchNumber
            )}
            · Expired
            ${formatDate(
              alert.batch.expiryDate
            )}
            · Stock:
            ${formatNumber(
              alert.batch.quantity
            )}
          </span>

        </div>

        <div class="alert-days">
          EXPIRED
        </div>

      </div>
    `;

  }


  if (alert.type === "expiring") {

    return `
      <div class="alert-item">

        <div class="alert-icon">
          ⏰
        </div>

        <div class="alert-content">

          <strong>
            ${escapeHTML(medicine.name)}
          </strong>

          <span>
            Batch ${escapeHTML(
              alert.batch.batchNumber
            )}
            · Expiry:
            ${formatDate(
              alert.batch.expiryDate
            )}
            · Stock:
            ${formatNumber(
              alert.batch.quantity
            )}
          </span>

        </div>

        <div class="alert-days">
          ${
            alert.days === 0
              ? "TODAY"
              : `${alert.days}d`
          }
        </div>

      </div>
    `;

  }


  if (alert.type === "low") {

    return `
      <div class="alert-item low">

        <div class="alert-icon">
          📦
        </div>

        <div class="alert-content">

          <strong>
            ${escapeHTML(medicine.name)}
          </strong>

          <span>
            Current stock:
            ${formatNumber(
              getTotalStock(medicine)
            )}
            ${escapeHTML(
              medicine.unit || ""
            )}
            · Minimum:
            ${formatNumber(
              medicine.minStock
            )}
          </span>

        </div>

        <div class="alert-days">
          LOW
        </div>

      </div>
    `;

  }


  return `
    <div class="alert-item out">

      <div class="alert-icon">
        📭
      </div>

      <div class="alert-content">

        <strong>
          ${escapeHTML(medicine.name)}
        </strong>

        <span>
          This medicine is currently out of stock.
        </span>

      </div>

      <div class="alert-days">
        OUT
      </div>

    </div>
  `;

}


// ============================================================
// MEDICINES
// ============================================================

function renderMedicines() {

  const search =
    $("medicineSearch")
      .value
      .trim()
      .toLowerCase();


  const filter =
    $("medicineFilter").value;


  let filtered =
    medicines.filter(
      medicine => {

        const matchesSearch =
          !search ||
          medicine.name
            ?.toLowerCase()
            .includes(search) ||
          medicine.category
            ?.toLowerCase()
            .includes(search) ||
          (medicine.batches || [])
            .some(
              batch =>
                batch.batchNumber
                  ?.toLowerCase()
                  .includes(search)
            );


        if (!matchesSearch) {
          return false;
        }


        const status =
          getMedicineStatus(medicine);


        if (
          filter !== "all" &&
          status !== filter
        ) {
          return false;
        }


        return true;

      }
    );


  const container =
    $("medicineGrid");


  if (!filtered.length) {

    container.innerHTML =
      `<div class="empty-state large">
        No medicines found.
      </div>`;

    return;

  }


  container.innerHTML =
    filtered
      .map(renderMedicineCard)
      .join("");

}


// ============================================================
// MEDICINE CARD
// ============================================================

function renderMedicineCard(medicine) {

  const total =
    getTotalStock(medicine);


  const status =
    getMedicineStatus(medicine);


  const batches =
    [...(medicine.batches || [])]
      .sort(
        (a, b) =>
          String(a.expiryDate)
            .localeCompare(
              String(b.expiryDate)
            )
      );


  const batchHTML =
    batches
      .map(
        batch => {

          const days =
            daysUntil(
              batch.expiryDate
            );


          let expiryText =
            formatDate(
              batch.expiryDate
            );


          if (batch.quantity > 0) {

            if (days < 0) {

              expiryText +=
                " · Expired";

            } else if (
              days <= EXPIRY_WARNING_DAYS
            ) {

              expiryText +=
                ` · ${days} days`;

            }

          }


          return `
            <div class="batch-row">

              <div class="batch-row-top">

                <span>
                  Batch:
                  ${escapeHTML(
                    batch.batchNumber
                  )}
                </span>

                <span>
                  ${formatNumber(
                    batch.quantity
                  )}
                </span>

              </div>

              <div class="batch-row-bottom">

                <span>
                  Stock:
                  ${formatDate(
                    batch.stockDate
                  )}
                </span>

                <span>
                  Exp:
                  ${expiryText}
                </span>

              </div>

            </div>
          `;

        }
      )
      .join("");


  return `
    <article
      class="medicine-card"
      data-medicine-id="${medicine.id}"
    >

      <div class="medicine-top">

        <div>

          <h3 class="medicine-name">
            ${escapeHTML(
              medicine.name
            )}
          </h3>

          <div class="medicine-category">
            ${escapeHTML(
              medicine.category || "Other"
            )}
            ·
            ${escapeHTML(
              medicine.unit || ""
            )}
          </div>

        </div>


        <span
          class="status-badge
          ${getStatusClass(status)}"
        >
          ${getStatusLabel(status)}
        </span>

      </div>


      <div class="medicine-main-stock">

        <strong>
          ${formatNumber(total)}
        </strong>

        <span>
          ${escapeHTML(
            medicine.unit || "units"
          )}
        </span>

      </div>


      <div class="batch-list">

        ${batchHTML}

      </div>


      <div class="medicine-actions">

        <button
          data-action="add-stock"
          data-id="${medicine.id}"
        >
          + Stock
        </button>

        <button
          class="sell-action"
          data-action="sell"
          data-id="${medicine.id}"
        >
          Sell
        </button>

        <button
          data-action="edit"
          data-id="${medicine.id}"
        >
          Edit
        </button>

        <button
          data-action="delete"
          data-id="${medicine.id}"
        >
          Delete
        </button>

      </div>

    </article>
  `;

}


// ============================================================
// ADD MEDICINE
// ============================================================

$("medicineForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    if (!currentUser) return;


    const id =
      $("medicineId").value.trim();


    const data = {

      name:
        $("medicineName").value.trim(),

      category:
        $("medicineCategory").value,

      unit:
        $("medicineUnit").value,

      minStock:
        normalizeQuantity(
          $("medicineMinStock").value ||
          DEFAULT_MIN_STOCK
        ),

      supplier:
        $("medicineSupplier").value.trim(),

      notes:
        $("medicineNotes").value.trim(),

      purchasePrice:
        normalizeQuantity(
          $("medicinePurchasePrice").value
        ),

      salePrice:
        normalizeQuantity(
          $("medicineSalePrice").value
        )

    };


    const batch = {

      batchNumber:
        $("medicineBatch").value.trim(),

      quantity:
        normalizeQuantity(
          $("medicineQuantity").value
        ),

      stockDate:
        $("medicineStockDate").value,

      expiryDate:
        $("medicineExpiry").value,

      purchasePrice:
        normalizeQuantity(
          $("medicinePurchasePrice").value
        ),

      createdAt:
        new Date().toISOString()

    };


    if (!data.name) {

      toast(
        "Medicine name is required.",
        "error"
      );

      return;

    }


    if (!batch.batchNumber) {

      toast(
        "Batch number is required.",
        "error"
      );

      return;

    }


    if (batch.quantity <= 0) {

      toast(
        "Initial stock must be greater than zero.",
        "error"
      );

      return;

    }


    if (!batch.stockDate) {

      toast(
        "Stock date is required.",
        "error"
      );

      return;

    }


    if (!batch.expiryDate) {

      toast(
        "Expiry date is required.",
        "error"
      );

      return;

    }


    const button =
      event.submitter;

    button.disabled = true;

    button.textContent =
      "Saving...";


    try {

      const medicineRef =
        id
          ? doc(
              db,
              "users",
              currentUser.uid,
              "medicines",
              id
            )
          : doc(
              collection(
                db,
                "users",
                currentUser.uid,
                "medicines"
              )
            );


      if (id) {

        const existing =
          medicines.find(
            item => item.id === id
          );


        if (!existing) {
          throw new Error(
            "Medicine not found."
          );
        }


        const batches =
          Array.isArray(
            existing.batches
          )
            ? existing.batches
            : [];


        await updateDoc(
          medicineRef,
          {
            ...data,
            updatedAt:
              serverTimestamp()
          }
        );


        await addHistory(
          "stock_updated",
          data.name,
          batch.quantity,
          {
            medicineId: id,
            batchNumber:
              batch.batchNumber
          }
        );


        toast(
          "Medicine information updated."
        );


      } else {

        await setDoc(
          medicineRef,
          {
            ...data,

            batches: [
              batch
            ],

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );


        await addHistory(
          "medicine_added",
          data.name,
          batch.quantity,
          {
            medicineId:
              medicineRef.id,

            batchNumber:
              batch.batchNumber,

            expiryDate:
              batch.expiryDate,

            stockDate:
              batch.stockDate
          }
        );


        toast(
          "Medicine added successfully."
        );

      }


      closeModal("medicineModal");

      await loadAllData();

      renderEverything();

    } catch (error) {

      console.error(error);

      toast(
        error.message ||
        "Could not save medicine.",
        "error"
      );

    } finally {

      button.disabled = false;

      button.textContent =
        "Save Medicine";

    }

  }
);


// ============================================================
// ADD STOCK
// ============================================================

$("stockForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    if (!currentUser) return;


    const medicineId =
      $("stockMedicineId").value;


    const quantity =
      normalizeQuantity(
        $("stockQuantity").value
      );


    if (!medicineId || quantity <= 0) {

      toast(
        "Enter a valid stock quantity.",
        "error"
      );

      return;

    }


    const button =
      event.submitter;

    button.disabled = true;

    button.textContent =
      "Adding...";


    try {

      const medicineRef =
        doc(
          db,
          "users",
          currentUser.uid,
          "medicines",
          medicineId
        );


      const newBatch = {

        batchNumber:
          $("stockBatch").value.trim(),

        quantity,

        stockDate:
          $("stockDate").value,

        expiryDate:
          $("stockExpiry").value,

        purchasePrice:
          normalizeQuantity(
            $("stockPurchasePrice").value
          ),

        createdAt:
          new Date().toISOString()

      };


      if (!newBatch.batchNumber) {

        throw new Error(
          "Batch number is required."
        );

      }


      await runTransaction(
        db,
        async (transaction) => {

          const snapshot =
            await transaction.get(
              medicineRef
            );


          if (!snapshot.exists()) {

            throw new Error(
              "Medicine no longer exists."
            );

          }


          const medicine =
            snapshot.data();


          const batches =
            Array.isArray(
              medicine.batches
            )
              ? [...medicine.batches]
              : [];


          batches.push(
            newBatch
          );


          transaction.update(
            medicineRef,
            {
              batches,

              updatedAt:
                serverTimestamp()
            }
          );

        }
      );


      await addHistory(
        "stock_added",
        getMedicineName(medicineId),
        quantity,
        {
          medicineId,

          batchNumber:
            newBatch.batchNumber,

          expiryDate:
            newBatch.expiryDate,

          stockDate:
            newBatch.stockDate
        }
      );


      toast(
        "Stock added successfully."
      );


      closeModal("stockModal");

      await loadAllData();

      renderEverything();

    } catch (error) {

      console.error(error);

      toast(
        error.message ||
        "Could not add stock.",
        "error"
      );

    } finally {

      button.disabled = false;

      button.textContent =
        "Add Stock";

    }

  }
);


// ============================================================
// SALE
// ============================================================

$("saleForm").addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    if (!currentUser) return;


    const medicineId =
      $("saleMedicine").value;


    const quantity =
      normalizeQuantity(
        $("saleQuantity").value
      );


    if (!medicineId) {

      toast(
        "Please select a medicine.",
        "error"
      );

      return;

    }


    if (quantity <= 0) {

      toast(
        "Sale quantity must be greater than zero.",
        "error"
      );

      return;

    }


    const button =
      event.submitter;

    button.disabled = true;

    button.textContent =
      "Processing...";


    try {

      const medicineRef =
        doc(
          db,
          "users",
          currentUser.uid,
          "medicines",
          medicineId
        );


      const saleRef =
        doc(
          collection(
            db,
            "users",
            currentUser.uid,
            "sales"
          )
        );


      const historyRef =
        doc(
          collection(
            db,
            "users",
            currentUser.uid,
            "history"
          )
        );


      const saleDate =
        $("saleDate").value ||
        todayISO();


      const customer =
        $("saleCustomer").value.trim();


      const notes =
        $("saleNotes").value.trim();


      let saleResult = null;


      await runTransaction(
        db,
        async (transaction) => {

          const snapshot =
            await transaction.get(
              medicineRef
            );


          if (!snapshot.exists()) {

            throw new Error(
              "Medicine was not found."
            );

          }


          const medicine =
            snapshot.data();


          let batches =
            Array.isArray(
              medicine.batches
            )
              ? medicine.batches.map(
                  batch => ({
                    ...batch
                  })
                )
              : [];


          const availableBatches =
            batches
              .filter(
                batch =>
                  Number(
                    batch.quantity || 0
                  ) > 0 &&
                  !isExpired(
                    batch.expiryDate
                  )
              )
              .sort(
                (a, b) =>
                  String(
                    a.expiryDate
                  ).localeCompare(
                    String(
                      b.expiryDate
                    )
                  )
              );


          const totalAvailable =
            availableBatches.reduce(
              (sum, batch) =>
                sum +
                Number(
                  batch.quantity || 0
                ),
              0
            );


          if (
            totalAvailable <
            quantity
          ) {

            throw new Error(
              `Insufficient non-expired stock. Available: ${formatNumber(totalAvailable)}`
            );

          }


          let remaining =
            quantity;

          const soldBatches = [];


          for (
            const batch of availableBatches
          ) {

            if (remaining <= 0) {
              break;
            }


            const currentQuantity =
              Number(
                batch.quantity || 0
              );


            const deduction =
              Math.min(
                currentQuantity,
                remaining
              );


            batch.quantity =
              normalizeQuantity(
                currentQuantity -
                deduction
              );


            remaining =
              normalizeQuantity(
                remaining -
                deduction
              );


            soldBatches.push({

              batchNumber:
                batch.batchNumber,

              quantity:
                deduction,

              expiryDate:
                batch.expiryDate

            });

          }


          batches =
            batches.map(
              batch => {

                const sold =
                  soldBatches.find(
                    item =>
                      item.batchNumber ===
                      batch.batchNumber &&
                      item.expiryDate ===
                      batch.expiryDate
                  );


                if (!sold) {
                  return batch;
                }


                return {

                  ...batch,

                  quantity:
                    normalizeQuantity(
                      Number(
                        batch.quantity || 0
                      )
                    )

                };

              }
            );


          transaction.update(
            medicineRef,
            {
              batches,

              updatedAt:
                serverTimestamp()
            }
          );


          const saleData = {

            medicineId,

            medicineName:
              medicine.name,

            quantity,

            customer,

            saleDate,

            notes,

            batches:
              soldBatches,

            createdAt:
              serverTimestamp()

          };


          transaction.set(
            saleRef,
            saleData
          );


          transaction.set(
            historyRef,
            {

              action: "sale",

              medicineId,

              medicineName:
                medicine.name,

              quantity,

              saleDate,

              customer,

              batchDetails:
                soldBatches,

              createdAt:
                serverTimestamp()

            }
          );


          saleResult = {
            medicineName:
              medicine.name,

            quantity,

            batches:
              soldBatches

          };

        }
      );


      toast(
        `${saleResult.medicineName}: ${formatNumber(saleResult.quantity)} sold successfully.`
      );


      closeModal("saleModal");

      await loadAllData();

      renderEverything();


    } catch (error) {

      console.error(error);

      toast(
        error.message ||
        "Sale could not be completed.",
        "error"
      );

    } finally {

      button.disabled = false;

      button.textContent =
        "Complete Sale";

    }

  }
);


// ============================================================
// HISTORY
// ============================================================

async function addHistory(
  action,
  medicineName,
  quantity,
  extra = {}
) {

  if (!currentUser) return;


  await addDoc(
    collection(
      db,
      "users",
      currentUser.uid,
      "history"
    ),
    {

      action,

      medicineName,

      quantity:
        normalizeQuantity(quantity),

      ...extra,

      createdAt:
        serverTimestamp()

    }
  );

}


function renderHistory() {

  const search =
    $("historySearch")
      .value
      .trim()
      .toLowerCase();


  const filter =
    $("historyFilter").value;


  const filtered =
    historyRecords.filter(
      record => {

        const text =
          [
            record.medicineName,
            record.action,
            record.customer,
            record.batchNumber
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();


        const matchesSearch =
          !search ||
          text.includes(search);


        const matchesFilter =
          filter === "all" ||
          record.action === filter;


        return (
          matchesSearch &&
          matchesFilter
        );

      }
    );


  $("historyTable").innerHTML =
    filtered.length
      ? renderHistoryTable(filtered)
      : `<div class="empty-state">
          No matching history found.
        </div>`;

}


function renderHistoryTable(records) {

  return `
    <table class="data-table">

      <thead>

        <tr>

          <th>Date</th>

          <th>Medicine</th>

          <th>Action</th>

          <th>Quantity</th>

          <th>Batch</th>

          <th>Details</th>

        </tr>

      </thead>

      <tbody>

        ${records
          .map(
            record => `

              <tr>

                <td>
                  ${formatTimestamp(
                    record.createdAt
                  )}
                </td>

                <td>
                  <strong>
                    ${escapeHTML(
                      record.medicineName ||
                      "—"
                    )}
                  </strong>
                </td>

                <td>
                  ${formatAction(
                    record.action
                  )}
                </td>

                <td>
                  ${formatNumber(
                    record.quantity
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    record.batchNumber ||
                    record.batchDetails
                      ?.map(
                        item =>
                          item.batchNumber
                      )
                      .join(", ") ||
                    "—"
                  )}
                </td>

                <td>
                  ${historyDetails(
                    record
                  )}
                </td>

              </tr>

            `
          )
          .join("")}

      </tbody>

    </table>
  `;

}


function formatTimestamp(value) {

  if (!value) return "—";


  let date;


  if (
    typeof value.toDate ===
    "function"
  ) {

    date =
      value.toDate();

  } else {

    date =
      new Date(value);

  }


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "—";

  }


  return date.toLocaleString(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short"
    }
  );

}


function formatAction(action) {

  const labels = {

    medicine_added:
      "Medicine Added",

    stock_added:
      "Stock Added",

    stock_updated:
      "Stock Updated",

    sale:
      "Sale",

    medicine_deleted:
      "Medicine Deleted"

  };


  return escapeHTML(
    labels[action] ||
    action ||
    "Activity"
  );

}


function historyDetails(record) {

  if (record.action === "sale") {

    return `
      Sale:
      ${escapeHTML(
        record.saleDate || ""
      )}
      ${
        record.customer
          ? ` · ${escapeHTML(
              record.customer
            )}`
          : ""
      }
    `;

  }


  if (record.expiryDate) {

    return `
      Expiry:
      ${formatDate(
        record.expiryDate
      )}
    `;

  }


  return "—";

}


// ============================================================
// SALES TABLE
// ============================================================

function renderSales() {

  const container =
    $("salesTable");


  if (!sales.length) {

    container.innerHTML =
      `<div class="empty-state">
        No sales recorded yet.
      </div>`;

    return;

  }


  container.innerHTML = `

    <table class="data-table">

      <thead>

        <tr>

          <th>Date</th>

          <th>Medicine</th>

          <th>Quantity</th>

          <th>Customer</th>

          <th>Sale Date</th>

        </tr>

      </thead>

      <tbody>

        ${sales
          .map(
            sale => `

              <tr>

                <td>
                  ${formatTimestamp(
                    sale.createdAt
                  )}
                </td>

                <td>
                  <strong>
                    ${escapeHTML(
                      sale.medicineName
                    )}
                  </strong>
                </td>

                <td>
                  ${formatNumber(
                    sale.quantity
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    sale.customer ||
                    "—"
                  )}
                </td>

                <td>
                  ${formatDate(
                    sale.saleDate
                  )}
                </td>

              </tr>

            `
          )
          .join("")}

      </tbody>

    </table>

  `;

}


// ============================================================
// ALERT PAGE
// ============================================================

function renderAlerts() {

  const alerts =
    getAlertMedicines();


  const expired =
    alerts.filter(
      item =>
        item.type === "expired"
    ).length;


  const expiring =
    alerts.filter(
      item =>
        item.type === "expiring"
    ).length;


  const low =
    alerts.filter(
      item =>
        item.type === "low"
    ).length;


  const out =
    alerts.filter(
      item =>
        item.type === "out"
    ).length;


  $("expiredAlertCount").textContent =
    expired;

  $("expiringAlertCount").textContent =
    expiring;

  $("lowAlertCount").textContent =
    low;

  $("outAlertCount").textContent =
    out;


  $("fullAlerts").innerHTML =
    alerts.length
      ? alerts.map(
          renderAlertItem
        ).join("")
      : `<div class="empty-state">
          Everything looks good. No active alerts.
        </div>`;

}


// ============================================================
// SALE SELECT
// ============================================================

function populateSaleMedicineSelect() {

  const select =
    $("saleMedicine");


  const previous =
    select.value;


  select.innerHTML =
    `<option value="">
      Select medicine
    </option>`;


  medicines
    .filter(
      medicine =>
        getActiveBatches(
          medicine
        ).some(
          batch =>
            !isExpired(
              batch.expiryDate
            )
        )
    )
    .sort(
      (a, b) =>
        String(a.name)
          .localeCompare(
            String(b.name)
          )
    )
    .forEach(
      medicine => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          medicine.id;


        option.textContent =
          `${medicine.name} — ${formatNumber(getTotalSellableStock(medicine))} ${medicine.unit || ""}`;


        select.appendChild(
          option
        );

      }
    );


  if (
    medicines.some(
      medicine =>
        medicine.id === previous
    )
  ) {

    select.value =
      previous;

  }

}


function getTotalSellableStock(medicine) {

  return getActiveBatches(
    medicine
  )
    .filter(
      batch =>
        !isExpired(
          batch.expiryDate
        )
    )
    .reduce(
      (sum, batch) =>
        sum +
        Number(
          batch.quantity || 0
        ),
      0
    );

}


// ============================================================
// SALE MEDICINE PREVIEW
// ============================================================

$("saleMedicine").addEventListener(
  "change",
  () => {

    const medicine =
      medicines.find(
        item =>
          item.id ===
          $("saleMedicine").value
      );


    if (!medicine) {

      $("saleMedicineInfo").innerHTML =
        "";

      return;

    }


    const sellable =
      getTotalSellableStock(
        medicine
      );


    $("saleMedicineInfo").innerHTML = `

      <strong>
        ${escapeHTML(
          medicine.name
        )}
      </strong>

      <div style="margin-top:5px;color:var(--muted);font-size:13px">

        Available:
        <strong>
          ${formatNumber(
            sellable
          )}
          ${escapeHTML(
            medicine.unit || ""
          )}
        </strong>

      </div>

    `;

  }
);


// ============================================================
// MEDICINE SEARCH
// ============================================================

$("medicineSearch").addEventListener(
  "input",
  renderMedicines
);


$("medicineFilter").addEventListener(
  "change",
  renderMedicines
);


$("historySearch").addEventListener(
  "input",
  renderHistory
);


$("historyFilter").addEventListener(
  "change",
  renderHistory
);


// ============================================================
// MEDICINE ACTIONS
// ============================================================

$("medicineGrid").addEventListener(
  "click",
  async (event) => {

    const button =
      event.target.closest(
        "[data-action]"
      );


    if (!button) return;


    const action =
      button.dataset.action;


    const id =
      button.dataset.id;


    const medicine =
      medicines.find(
        item =>
          item.id === id
      );


    if (!medicine) return;


    if (
      action ===
      "add-stock"
    ) {

      openStockModal(
        medicine
      );

      return;

    }


    if (
      action ===
      "sell"
    ) {

      openSaleModal(
        medicine
      );

      return;

    }


    if (
      action ===
      "edit"
    ) {

      openMedicineEdit(
        medicine
      );

      return;

    }


    if (
      action ===
      "delete"
    ) {

      confirmAction(
        "Delete Medicine?",
        `This will remove "${medicine.name}" from active inventory. Its history will remain saved.`,
        async () => {

          await deleteMedicine(
            medicine
          );

        }
      );

    }

  }
);


// ============================================================
// DELETE MEDICINE
// ============================================================

async function deleteMedicine(
  medicine
) {

  try {

    await deleteDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "medicines",
        medicine.id
      )
    );


    await addHistory(
      "medicine_deleted",
      medicine.name,
      getTotalStock(
        medicine
      ),
      {
        medicineId:
          medicine.id
      }
    );


    toast(
      "Medicine removed from inventory."
    );


    await loadAllData();

    renderEverything();

  } catch (error) {

    handleFirebaseError(error);

  }

}


// ============================================================
// EDIT MEDICINE
// ============================================================

function openMedicineEdit(
  medicine
) {

  $("medicineModalTitle").textContent =
    "Edit Medicine";

  $("medicineId").value =
    medicine.id;

  $("medicineName").value =
    medicine.name || "";

  $("medicineCategory").value =
    medicine.category || "Other";

  $("medicineUnit").value =
    medicine.unit || "Bottle";

  $("medicineMinStock").value =
    medicine.minStock ??
    DEFAULT_MIN_STOCK;

  $("medicineSupplier").value =
    medicine.supplier || "";

  $("medicineNotes").value =
    medicine.notes || "";

  $("medicinePurchasePrice").value =
    medicine.purchasePrice || "";

  $("medicineSalePrice").value =
    medicine.salePrice || "";


  const firstBatch =
    medicine.batches?.[0];


  $("medicineBatch").value =
    firstBatch?.batchNumber || "";

  $("medicineQuantity").value =
    firstBatch?.quantity || "";

  $("medicineStockDate").value =
    firstBatch?.stockDate ||
    todayISO();

  $("medicineExpiry").value =
    firstBatch?.expiryDate || "";


  openModal(
    "medicineModal"
  );

}


// ============================================================
// OPEN STOCK MODAL
// ============================================================

function openStockModal(
  medicine
) {

  $("stockForm").reset();

  $("stockMedicineId").value =
    medicine.id;


  $("stockMedicineInfo").innerHTML = `

    <strong>
      ${escapeHTML(
        medicine.name
      )}
    </strong>

    <div style="margin-top:5px;color:var(--muted);font-size:13px">

      Current Stock:
      ${formatNumber(
        getTotalStock(medicine)
      )}
      ${escapeHTML(
        medicine.unit || ""
      )}

    </div>

  `;


  $("stockDate").value =
    todayISO();


  openModal(
    "stockModal"
  );

}


// ============================================================
// OPEN SALE MODAL
// ============================================================

function openSaleModal(
  medicine = null
) {

  populateSaleMedicineSelect();


  $("saleForm").reset();


  $("saleDate").value =
    todayISO();


  if (medicine) {

    $("saleMedicine").value =
      medicine.id;

    $("saleMedicine")
      .dispatchEvent(
        new Event("change")
      );

  }


  openModal(
    "saleModal"
  );

}


// ============================================================
// ADD BUTTON
// ============================================================

$("addMedicineBtn").addEventListener(
  "click",
  () => {

    resetMedicineForm();

    openModal(
      "medicineModal"
    );

  }
);


$("dashboardAddBtn").addEventListener(
  "click",
  () => {

    resetMedicineForm();

    openModal(
      "medicineModal"
    );

  }
);


$("newSaleBtn").addEventListener(
  "click",
  () => {

    openSaleModal();

  }
);


// ============================================================
// RESET MEDICINE FORM
// ============================================================

function resetMedicineForm() {

  $("medicineForm").reset();

  $("medicineId").value = "";

  $("medicineModalTitle").textContent =
    "Add Medicine";

  $("medicineStockDate").value =
    todayISO();

  $("medicineMinStock").value =
    DEFAULT_MIN_STOCK;

}


// ============================================================
// MODALS
// ============================================================

function openModal(id) {

  $(id).classList.remove(
    "hidden"
  );

}


function closeModal(id) {

  $(id).classList.add(
    "hidden"
  );

}


document.addEventListener(
  "click",
  (event) => {

    const close =
      event.target.closest(
        "[data-close-modal]"
      );


    if (close) {

      closeModal(
        close.dataset.closeModal
      );

    }


    if (
      event.target.classList.contains(
        "modal-backdrop"
      )
    ) {

      const modal =
        event.target.closest(
          ".modal"
        );


      if (modal) {

        modal.classList.add(
          "hidden"
        );

      }

    }

  }
);


// ============================================================
// CONFIRM
// ============================================================

function confirmAction(
  title,
  message,
  action
) {

  $("confirmTitle").textContent =
    title;

  $("confirmMessage").textContent =
    message;

  pendingConfirmAction =
    action;

  openModal(
    "confirmModal"
  );

}


$("confirmCancel").addEventListener(
  "click",
  () => {

    pendingConfirmAction =
      null;

    closeModal(
      "confirmModal"
    );

  }
);


$("confirmOk").addEventListener(
  "click",
  async () => {

    const action =
      pendingConfirmAction;

    pendingConfirmAction =
      null;

    closeModal(
      "confirmModal"
    );


    if (action) {

      await action();

    }

  }
);


// ============================================================
// NAVIGATION
// ============================================================

document.addEventListener(
  "click",
  (event) => {

    const button =
      event.target.closest(
        "[data-page]"
      );


    if (!button) return;


    const pageId =
      button.dataset.page;


    if (!$(pageId)) return;


    document
      .querySelectorAll(
        ".page"
      )
      .forEach(
        page =>
          page.classList.remove(
            "active-page"
          )
      );


    $(pageId)
      .classList.add(
        "active-page"
      );


    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(
        item =>
          item.classList.toggle(
            "active",
            item.dataset.page ===
            pageId
          )
      );


    if (
      pageId ===
      "historyPage"
    ) {

      renderHistory();

    }


    $("sidebar")
      .classList.remove(
        "open"
      );

  }
);


// ============================================================
// MOBILE MENU
// ============================================================

$("mobileMenuBtn").addEventListener(
  "click",
  () => {

    $("sidebar")
      .classList.toggle(
        "open"
      );

  }
);


// ============================================================
// LOGOUT
// ============================================================

$("logoutBtn").addEventListener(
  "click",
  () => {

    confirmAction(
      "Sign Out?",
      "You will need to sign in again to access your inventory.",
      async () => {

        try {

          await signOut(
            auth
          );

        } catch (error) {

          handleFirebaseError(
            error
          );

        }

      }
    );

  }
);


// ============================================================
// THEME
// ============================================================

function loadTheme() {

  const theme =
    localStorage.getItem(
      "poultryTheme"
    );


  if (theme === "dark") {

    document.body.classList.add(
      "dark"
    );

    $("themeBtn").textContent =
      "☀️ Light Mode";

  }

}


$("themeBtn").addEventListener(
  "click",
  () => {

    document.body.classList.toggle(
      "dark"
    );


    const dark =
      document.body.classList.contains(
        "dark"
      );


    localStorage.setItem(
      "poultryTheme",
      dark
        ? "dark"
        : "light"
    );


    $("themeBtn").textContent =
      dark
        ? "☀️ Light Mode"
        : "🌙 Dark Mode";

  }
);


loadTheme();


// ============================================================
// BROWSER NOTIFICATIONS
// ============================================================

$("notificationBtn").addEventListener(
  "click",
  async () => {

    if (
      !("Notification" in window)
    ) {

      toast(
        "Browser notifications are not supported here.",
        "warning"
      );

      return;

    }


    const permission =
      await Notification.requestPermission();


    if (
      permission ===
      "granted"
    ) {

      toast(
        "Notifications enabled."
      );


      showExpiryNotifications();

    } else {

      toast(
        "Notification permission was not granted.",
        "warning"
      );

    }

  }
);


function showExpiryNotifications() {

  if (
    !("Notification" in window) ||
    Notification.permission !==
    "granted"
  ) {

    return;

  }


  const expiring =
    getAlertMedicines()
      .filter(
        item =>
          item.type ===
          "expiring"
      );


  const expired =
    getAlertMedicines()
      .filter(
        item =>
          item.type ===
          "expired"
      );


  if (expired.length) {

    new Notification(
      "Poultry Medicine Alert",
      {
        body:
          `${expired.length} medicine batch(es) have expired.`
      }
    );

  } else if (expiring.length) {

    new Notification(
      "Expiry Warning",
      {
        body:
          `${expiring.length} medicine batch(es) expire within 30 days.`
      }
    );

  }

}


// ============================================================
// AUTO EXPIRY CHECK
// ============================================================

function runExpiryCheck() {

  if (!currentUser) return;


  const alerts =
    getAlertMedicines();


  if (!alerts.length) return;


  const today =
    todayISO();


  const lastAlertDate =
    localStorage.getItem(
      "lastExpiryAlertDate"
    );


  if (
    lastAlertDate ===
    today
  ) {

    return;

  }


  localStorage.setItem(
    "lastExpiryAlertDate",
    today
  );


  if (
    "Notification" in window &&
    Notification.permission ===
    "granted"
  ) {

    showExpiryNotifications();

  }

}


// ============================================================
// DEFAULT DATES
// ============================================================

function setDefaultDates() {

  const today =
    todayISO();


  if (!$("medicineStockDate").value) {

    $("medicineStockDate").value =
      today;

  }


  if (!$("stockDate").value) {

    $("stockDate").value =
      today;

  }


  if (!$("saleDate").value) {

    $("saleDate").value =
      today;

  }

}


// ============================================================
// GET MEDICINE NAME
// ============================================================

function getMedicineName(id) {

  return (
    medicines.find(
      medicine =>
        medicine.id === id
    )?.name ||
    "Medicine"
  );

}


// ============================================================
// PROFILE / VERSION
// ============================================================

console.log(
  `Poultry Medicine Manager v${APP_VERSION}`
);


// ============================================================
// INITIAL PERIODIC REFRESH
// ============================================================

setInterval(
  async () => {

    if (!currentUser) return;


    try {

      await loadAllData();

      renderEverything();

      runExpiryCheck();

    } catch (error) {

      console.error(
        "Background refresh failed:",
        error
      );

    }

  },
  5 * 60 * 1000
);


// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Escape"
    ) {

      document
        .querySelectorAll(
          ".modal:not(.hidden)"
        )
        .forEach(
          modal =>
            modal.classList.add(
              "hidden"
            )
        );

    }

  }
);
