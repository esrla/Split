const $ = id => document.getElementById(id);

const LEDGER_FILE = "ledger.jsonl";
const WEIGHTS_STORAGE_KEY = "split.householdWeights";

const els = {
  repoUrl: $("repoUrl"),
  branch: $("branch"),
  token: $("token"),
  saveSettings: $("saveSettings"),
  loadLedger: $("loadLedger"),
  householdName: $("householdName"),
  addHousehold: $("addHousehold"),
  households: $("households"),
  paidBy: $("paidBy"),
  amount: $("amount"),
  description: $("description"),
  addExpense: $("addExpense"),
  cancelEdit: $("cancelEdit"),
  expenseFormTitle: $("expenseFormTitle"),
  expenses: $("expenses"),
  weights: $("weights"),
  balances: $("balances"),
  status: $("status")
};

let fileSha = null;
let ledgerData = [];
let householdWeights = loadHouseholdWeights();
let editingExpenseId = null;

loadSettings();
render();

function setStatus(message, type = "muted") {
  els.status.className = type;
  els.status.textContent = message;
}

function parseRepoUrl(value) {
  const cleaned = value.trim().replace(/\/$/, "");
  const match =
    cleaned.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/) ||
    cleaned.match(/^([^/]+)\/([^/]+)$/);

  if (!match) throw new Error("Repo må være på formatet https://github.com/eier/repo eller eier/repo");
  return { owner: match[1], repo: match[2] };
}

function getConfig() {
  return {
    ...parseRepoUrl(els.repoUrl.value),
    branch: els.branch.value.trim() || "main",
    token: els.token.value.trim()
  };
}

function apiUrl(includeRef = true) {
  const config = getConfig();
  const base = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${LEDGER_FILE}`;
  return includeRef ? `${base}?ref=${encodeURIComponent(config.branch)}` : base;
}

function headers() {
  return {
    Authorization: "Bearer ".concat(getConfig().token),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function loadSettings() {
  els.repoUrl.value = localStorage.getItem("split.repoUrl") || els.repoUrl.value;
  els.branch.value = localStorage.getItem("split.branch") || els.branch.value;
  els.token.value = localStorage.getItem("split.token") || "";
}

function saveSettings() {
  localStorage.setItem("split.repoUrl", els.repoUrl.value.trim());
  localStorage.setItem("split.branch", els.branch.value.trim());
  localStorage.setItem("split.token", els.token.value.trim());
  setStatus("Oppsett lagret lokalt på denne mobilen.", "ok");
}

function loadHouseholdWeights() {
  try {
    const stored = JSON.parse(localStorage.getItem(WEIGHTS_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function saveHouseholdWeights() {
  localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(householdWeights));
}

function decodeBase64(value) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value.replace(/\n/g, "")), char => char.charCodeAt(0))
  );
}

function encodeBase64(value) {
  let binary = "";
  new TextEncoder().encode(value).forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function initialLedger() {
  return `${JSON.stringify({
    id: "init",
    type: "trip.created",
    name: "Split",
    createdAt: new Date().toISOString()
  })}\n`;
}

async function loadLedger() {
  try {
    setStatus("Laster data...", "muted");
    const res = await fetch(apiUrl(), { headers: headers(), cache: "no-store" });

    if (res.status === 404) {
      fileSha = null;
      const ledger = initialLedger();
      await saveLedgerContent(ledger, "Initialize ledger");
      parseLedger(ledger);
      render();
      setStatus("Data lastet (ny fil opprettet).", "ok");
      return;
    }

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const file = await res.json();
    fileSha = file.sha;
    const content = decodeBase64(file.content);
    parseLedger(content);
    render();
    setStatus("Data lastet.", "ok");
  } catch (err) {
    setStatus(`Feil: ${err.message}`, "error");
    throw err;
  }
}

async function saveLedgerContent(content, message = "Update ledger") {
  try {
    setStatus("Lagrer data...", "muted");
    const body = {
      message,
      content: encodeBase64(content),
      branch: getConfig().branch
    };

    if (fileSha) body.sha = fileSha;

    const res = await fetch(apiUrl(false), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const result = await res.json();
    fileSha = result.content.sha;
    parseLedger(content);
    render();
    setStatus("Data lagret.", "ok");
  } catch (err) {
    setStatus(`Feil: ${err.message}`, "error");
    throw err;
  }
}

function parseLedger(content) {
  ledgerData = content
    .trim()
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(event => event !== null);
}

async function appendEvent(event, message) {
  try {
    await loadLedger();

    if (ledgerData.some(existing => existing.id === event.id)) return;

    ledgerData.push(event);
    const content = ledgerData.map(e => JSON.stringify(e)).join("\n") + "\n";

    try {
      await saveLedgerContent(content, message);
    } catch (err) {
      if (!String(err.message).includes("409") && !String(err.message).includes("sha")) throw err;
      await loadLedger();
      ledgerData.push(event);
      const retryContent = ledgerData.map(e => JSON.stringify(e)).join("\n") + "\n";
      await saveLedgerContent(retryContent, message);
    }
  } catch (err) {
    setStatus(`Feil: ${err.message}`, "error");
  }
}

function householdsFromEvents(events) {
  const households = new Map();

  for (const event of events) {
    if (event.type === "household.added") households.set(event.householdId, event.name);

    if (event.type === "expense.added") {
      const householdId = event.household;
      const householdName = event.name || householdId;
      households.set(householdId, householdName);
    }
  }

  return [...households].map(([id, name]) => ({ id, name }));
}

function getHouseholdWeight(householdId) {
  return parsePositiveNumberOr(householdWeights[householdId], 1);
}

function deletedExpenseIds(events) {
  return new Set(
    events
      .filter(e => e.type === "expense.deleted")
      .map(e => e.expenseId)
  );
}

function calculateBalances(events, households) {
  const balances = new Map(households.map(household => [household.id, 0]));
  const deleted = deletedExpenseIds(events);

  for (const event of events) {
    if (event.type !== "expense.added") continue;
    if (deleted.has(event.id)) continue;

    const payerId = event.household;
    const amount = parsePositiveNumberOr(event.nok);
    if (!payerId || !amount) continue;

    const totalWeight = households.reduce((sum, household) => sum + getHouseholdWeight(household.id), 0);
    if (!totalWeight) continue;

    balances.set(payerId, (balances.get(payerId) || 0) + amount);

    for (const household of households) {
      const share = amount * getHouseholdWeight(household.id) / totalWeight;
      balances.set(household.id, (balances.get(household.id) || 0) - share);
    }
  }

  return [...balances].sort((a, b) => b[1] - a[1]);
}

function render() {
  const households = householdsFromEvents(ledgerData);

  els.households.innerHTML = households.length
    ? households.map(household => `<li>${escapeHtml(household.name)} <span class="muted">(${escapeHtml(household.id)})</span></li>`).join("")
    : "<li class='muted'>Ingen husholdninger ennå.</li>";

  els.paidBy.innerHTML = households
    .map(household => `<option value="${escapeHtml(household.id)}">${escapeHtml(household.name)}</option>`)
    .join("");

  els.weights.innerHTML = households.length
    ? `<p class="muted">Angi hvor mange personer det er i hver husholdning.</p><ul>${households.map(renderWeightInput).join("")}</ul>`
    : "<p class='muted'>Legg til minst én husholdning for å sette vekting.</p>";

  els.weights.querySelectorAll("[data-household-weight]").forEach(input => {
    input.oninput = event => {
      householdWeights[event.target.dataset.householdWeight] = parsePositiveNumberOr(event.target.value, 1);
      saveHouseholdWeights();
      render();
    };
  });

  const deleted = deletedExpenseIds(ledgerData);
  const expenseEvents = ledgerData.filter(e => e.type === "expense.added" && !deleted.has(e.id));

  els.expenses.innerHTML = expenseEvents.length
    ? expenseEvents.map(e => renderExpenseItem(e, households)).join("")
    : "<li class='muted'>Ingen utgifter ennå.</li>";

  els.expenses.querySelectorAll("[data-delete-expense]").forEach(btn => {
    btn.onclick = () => deleteExpense(btn.dataset.deleteExpense);
  });

  els.expenses.querySelectorAll("[data-edit-expense]").forEach(btn => {
    btn.onclick = () => startEditExpense(btn.dataset.editExpense);
  });

  els.expenseFormTitle.textContent = editingExpenseId ? "Rediger utgift" : "Ny utgift";
  els.addExpense.textContent = editingExpenseId ? "Oppdater utgift" : "Legg til utgift";
  els.cancelEdit.style.display = editingExpenseId ? "" : "none";

  const balances = calculateBalances(ledgerData, households);

  els.balances.innerHTML = balances.length
    ? `<ul>${balances.map(([householdId, amount]) => `<li><b>${escapeHtml(displayName(households, householdId))}</b>: ${formatMoney(amount)}</li>`).join("")}</ul>`
    : "<p class='muted'>Ingen utgifter ennå.</p>";
}

function displayName(households, householdId) {
  return households.find(household => household.id === householdId)?.name || householdId;
}

function formatMoney(value) {
  return `${value.toFixed(2)} NOK`;
}

function renderExpenseItem(event, households) {
  const id = escapeHtml(event.id);
  const name = escapeHtml(displayName(households, event.household));
  const desc = escapeHtml(event.description || "");
  const amount = escapeHtml(formatMoney(event.nok));
  return `<li class="expense-item">
    <span class="expense-text">${desc} — ${amount} <span class="muted">(${name})</span></span>
    <span class="expense-actions">
      <button class="btn-icon" data-edit-expense="${id}" title="Rediger">✏️</button>
      <button class="btn-icon" data-delete-expense="${id}" title="Slett">🗑️</button>
    </span>
  </li>`;
}

async function deleteExpense(expenseId) {
  const event = ledgerData.find(e => e.id === expenseId);
  const label = event?.description || expenseId;
  if (!confirm(`Vil du slette utgiften «${label}»?`)) return;

  await appendEvent({
    id: crypto.randomUUID(),
    type: "expense.deleted",
    expenseId,
    createdAt: new Date().toISOString()
  }, `Delete expense: ${label}`);
}

function startEditExpense(expenseId) {
  const event = ledgerData.find(e => e.id === expenseId);
  if (!event) return;

  editingExpenseId = expenseId;
  els.paidBy.value = event.household;
  els.amount.value = event.nok;
  els.description.value = event.description || "";

  els.expenseFormTitle.scrollIntoView({ behavior: "smooth", block: "start" });
  render();
}

function cancelEditExpense() {
  editingExpenseId = null;
  els.amount.value = "";
  els.description.value = "";
  render();
}

function renderWeightInput(household) {
  const id = `weight-${escapeHtml(household.id)}`;
  const name = escapeHtml(household.name);
  const value = escapeHtml(String(getHouseholdWeight(household.id)));
  const householdId = escapeHtml(household.id);
  return `<li><label for="${id}">${name}</label><input id="${id}" data-household-weight="${householdId}" type="number" min="1" step="1" value="${value}"></li>`;
}

function parsePositiveNumberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function slug(value) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

els.saveSettings.onclick = saveSettings;

els.loadLedger.onclick = async () => {
  await loadLedger();
};

els.cancelEdit.onclick = cancelEditExpense;

els.addHousehold.onclick = async () => {
  const name = els.householdName.value.trim();
  const householdId = slug(name);
  if (!name) {
    setStatus("Navn mangler.", "error");
    return;
  }
  if (!householdId) {
    setStatus("Navnet må inneholde bokstaver eller tall.", "error");
    return;
  }

  await appendEvent({
    id: crypto.randomUUID(),
    type: "household.added",
    householdId,
    name,
    createdAt: new Date().toISOString()
  }, `Add household: ${name}`);

  els.householdName.value = "";
};

els.addExpense.onclick = async () => {
  const paidBy = els.paidBy.value;
  const amount = parsePositiveNumberOr(els.amount.value);
  const description = els.description.value.trim();

  if (!paidBy) {
    setStatus("Velg hvem som betalte.", "error");
    return;
  }
  if (!amount) {
    setStatus("Beløp må være større enn 0.", "error");
    return;
  }
  if (!description) {
    setStatus("Beskrivelse mangler.", "error");
    return;
  }

  const households = householdsFromEvents(ledgerData);
  const household = households.find(item => item.id === paidBy);
  const newExpenseId = crypto.randomUUID();

  if (editingExpenseId) {
    const oldEvent = ledgerData.find(e => e.id === editingExpenseId);
    const oldLabel = oldEvent?.description || editingExpenseId;
    if (!confirm(`Vil du oppdatere utgiften «${oldLabel}»?`)) return;

    const deleteEvent = {
      id: crypto.randomUUID(),
      type: "expense.deleted",
      expenseId: editingExpenseId,
      createdAt: new Date().toISOString()
    };
    const addEvent = {
      id: newExpenseId,
      type: "expense.added",
      household: paidBy,
      name: household?.name || paidBy,
      nok: amount,
      description,
      createdAt: new Date().toISOString()
    };

    editingExpenseId = null;
    await appendEvent(deleteEvent, `Delete expense: ${oldLabel}`);
    await appendEvent(addEvent, `Update expense: ${description}`);
  } else {
    await appendEvent({
      id: newExpenseId,
      type: "expense.added",
      household: paidBy,
      name: household?.name || paidBy,
      nok: amount,
      description,
      createdAt: new Date().toISOString()
    }, `Add expense: ${description}`);
  }

  els.amount.value = "";
  els.description.value = "";
  render();
};
