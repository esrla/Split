const $ = id => document.getElementById(id);

const LEDGER_FILE = "ledger.jsonl";

const els = {
  repoUrl: $("repoUrl"),
  branch: $("branch"),
  token: $("token"),
  saveSettings: $("saveSettings"),
  loadLedger: $("loadLedger"),
  personName: $("personName"),
  addPerson: $("addPerson"),
  people: $("people"),
  paidBy: $("paidBy"),
  amount: $("amount"),
  description: $("description"),
  participants: $("participants"),
  addExpense: $("addExpense"),
  balances: $("balances"),
  status: $("status")
};

let fileSha = null;

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
    Authorization: `Bearer ${getConfig().token}`,
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
    const res = await fetch(apiUrl(), { headers: headers() });

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

let ledgerData = [];

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
      if (!String(err.message).includes("sha")) throw err;
      await loadLedger();
      ledgerData.push(event);
      const retryContent = ledgerData.map(e => JSON.stringify(e)).join("\n") + "\n";
      await saveLedgerContent(retryContent, message);
    }
  } catch (err) {
    setStatus(`Feil: ${err.message}`, "error");
  }
}

function peopleFromEvents(events) {
  const people = new Map();

  for (const event of events) {
    if (event.type === "person.added") people.set(event.personId, event.name);

    if (event.type === "expense.added") {
      people.set(event.paidBy, event.paidBy);
      Object.keys(event.shares || {}).forEach(personId => people.set(personId, personId));
    }
  }

  return [...people].map(([id, name]) => ({ id, name }));
}

function calculateBalances(events) {
  const balances = new Map();

  for (const event of events) {
    if (event.type !== "expense.added") continue;

    const shares = event.shares || {};
    const totalShares = Object.values(shares).reduce((sum, share) => sum + Number(share), 0);
    if (!totalShares) continue;

    balances.set(event.paidBy, (balances.get(event.paidBy) || 0) + Number(event.amount));

    for (const [personId, share] of Object.entries(shares)) {
      balances.set(
        personId,
        (balances.get(personId) || 0) - Number(event.amount) * Number(share) / totalShares
      );
    }
  }

  return [...balances].sort((a, b) => b[1] - a[1]);
}

function render() {
  const people = peopleFromEvents(ledgerData);

  els.people.innerHTML = people.length
    ? people.map(person => `<li>${escapeHtml(person.name)} <span class="muted">(${escapeHtml(person.id)})</span></li>`).join("")
    : "<li class='muted'>Ingen personer ennå.</li>";

  els.paidBy.innerHTML = people
    .map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`)
    .join("");

  els.participants.innerHTML = people
    .map(person => `<option value="${escapeHtml(person.id)}" selected>${escapeHtml(person.name)}</option>`)
    .join("");

  const balances = calculateBalances(ledgerData);

  els.balances.innerHTML = balances.length
    ? `<ul>${balances.map(([personId, amount]) => `<li><b>${escapeHtml(displayName(people, personId))}</b>: ${formatMoney(amount)}</li>`).join("")}</ul>`
    : "<p class='muted'>Ingen utgifter ennå.</p>";
}

function displayName(people, personId) {
  return people.find(person => person.id === personId)?.name || personId;
}

function formatMoney(value) {
  return `${value.toFixed(2)} NOK`;
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

els.addPerson.onclick = async () => {
  const name = els.personName.value.trim();
  if (!name) {
    setStatus("Navn mangler.", "error");
    return;
  }

  await appendEvent({
    id: crypto.randomUUID(),
    type: "person.added",
    personId: slug(name),
    name,
    createdAt: new Date().toISOString()
  }, `Add person: ${name}`);

  els.personName.value = "";
};

els.addExpense.onclick = async () => {
  const paidBy = els.paidBy.value;
  const amount = Number(els.amount.value);
  const description = els.description.value.trim();

  if (!paidBy) {
    setStatus("Velg hvem som betalte.", "error");
    return;
  }
  if (!amount) {
    setStatus("Beløp mangler.", "error");
    return;
  }
  if (!description) {
    setStatus("Beskrivelse mangler.", "error");
    return;
  }

  const selected = [...els.participants.selectedOptions].map(option => option.value);
  const people = peopleFromEvents(ledgerData);
  const participants = selected.length ? selected : people.map(person => person.id);

  await appendEvent({
    id: crypto.randomUUID(),
    type: "expense.added",
    paidBy,
    amount,
    description,
    shares: Object.fromEntries(participants.map(personId => [personId, 1])),
    createdAt: new Date().toISOString()
  }, `Add expense: ${description}`);

  els.amount.value = "";
  els.description.value = "";
};
