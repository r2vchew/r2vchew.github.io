const STORAGE_KEY = "life-hub-email-overview-v1";
const FEEDBACK_API = location.protocol === "file:" ? "http://localhost:8765/api/feedback" : "/api/feedback";

const state = loadState();
let briefing = window.BRIEFING_DATA;
let activeFlagItemId = null;
let feedbackSyncTimer = null;
let feedbackSyncEnabled = false;

const todayView = document.querySelector("#today-view");
const regularsView = document.querySelector("#regulars-view");
const regularsList = document.querySelector("#regulars-list");
const learningView = document.querySelector("#learning-view");
const learningList = document.querySelector("#learning-list");
const savedView = document.querySelector("#saved-view");
const savedList = document.querySelector("#saved-list");
const flagDialog = document.querySelector("#flag-dialog");
const flagForm = document.querySelector("#flag-form");
const flagNote = document.querySelector("#flag-note");
const toast = document.querySelector("#toast");
const feedbackButton = document.querySelector("#export-feedback");

init();

async function init() {
  if (location.protocol !== "file:") {
    try {
      const response = await fetch("data/daily-brief.json", { cache: "no-store" });
      if (response.ok) briefing = await response.json();
    } catch (error) {
      console.info("Using the local briefing fallback.", error);
    }
  }

  await loadServerFeedback();

  document.querySelector("#brief-date").textContent = briefing.display_date;
  document.querySelector("#brief-window").textContent = briefing.context_window;
  document.querySelector("#brief-deck").textContent = briefing.deck;
  document.querySelector("#scan-time").textContent = briefing.scan_time;

  renderToday();
  renderRegulars();
  renderLearning();
  renderSaved();
  bindStaticControls();
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      saved: Array.isArray(stored?.saved) ? stored.saved : [],
      completed: Array.isArray(stored?.completed) ? stored.completed : [],
      flags: Array.isArray(stored?.flags) ? stored.flags : []
    };
  } catch {
    return { saved: [], completed: [], flags: [] };
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderCounts();
  if (feedbackSyncEnabled) queueFeedbackSync();
}

function feedbackPayload() {
  return {
    schema_version: "1.0",
    briefing_id: briefing.briefing_id,
    updated_at: new Date().toISOString(),
    saved_item_ids: state.saved,
    completed_item_ids: state.completed,
    flags: state.flags
  };
}

async function loadServerFeedback() {
  setFeedbackStatus("Loading feedback...", "syncing");
  try {
    const response = await fetch(FEEDBACK_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`Feedback load failed with ${response.status}`);
    feedbackSyncEnabled = true;
    const server = await response.json();
    state.saved = [...new Set([...state.saved, ...(server.saved_item_ids || [])])];
    state.completed = [...new Set([...state.completed, ...(server.completed_item_ids || [])])];
    state.flags = mergeFlags(state.flags, server.flags || []);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    await syncFeedback();
  } catch (error) {
    feedbackSyncEnabled = false;
    console.warn("Project feedback sync is unavailable.", error);
    setFeedbackStatus("Download feedback", "sync-error");
  }
}

function mergeFlags(localFlags, serverFlags) {
  const merged = new Map();
  [...serverFlags, ...localFlags].forEach(flag => {
    const previous = merged.get(flag.item_id);
    if (!previous || String(flag.created_at || "") >= String(previous.created_at || "")) {
      merged.set(flag.item_id, flag);
    }
  });
  return [...merged.values()];
}

function queueFeedbackSync() {
  clearTimeout(feedbackSyncTimer);
  setFeedbackStatus("Saving feedback...", "syncing");
  feedbackSyncTimer = setTimeout(() => syncFeedback(), 250);
}

async function syncFeedback() {
  try {
    const response = await fetch(FEEDBACK_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedbackPayload(), null, 2)
    });
    if (!response.ok) throw new Error(`Feedback save failed with ${response.status}`);
    feedbackSyncEnabled = true;
    setFeedbackStatus("Feedback saved", "sync-ok");
    return true;
  } catch (error) {
    feedbackSyncEnabled = false;
    console.warn("Feedback could not be saved to the project file.", error);
    setFeedbackStatus("Download feedback", "sync-error");
    return false;
  }
}

function setFeedbackStatus(label, status) {
  feedbackButton.textContent = label;
  feedbackButton.dataset.status = status;
}

function allItems() {
  return briefing.sections.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionTitle: section.title })));
}

function renderToday() {
  const sections = briefing.sections.filter(section => !["personal-pulse", "quiet-discoveries", "ai-learning"].includes(section.id));
  todayView.innerHTML = renderSections(sections);
  bindCardControls(todayView);
  renderCounts();
}

function renderLearning() {
  const items = briefing.sections
    .filter(section => section.id === "ai-learning")
    .flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id })))
    .filter(item => !state.completed.includes(item.id));
  learningList.innerHTML = items.length
    ? `<div class="cards">${items.map(item => cardMarkup(item)).join("")}</div>`
    : `<div class="empty-state"><strong>Nothing waiting to be learned.</strong>Practical, self-contained AI guides will collect here as they arrive.</div>`;
  bindCardControls(learningList);
  renderCounts();
}

function renderRegulars() {
  const sections = briefing.sections.filter(section => ["personal-pulse", "quiet-discoveries"].includes(section.id));
  const items = sections.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id }))).filter(item => !state.completed.includes(item.id));
  regularsList.innerHTML = items.length
    ? `<div class="cards">${items.map(item => cardMarkup(item)).join("")}</div>`
    : `<div class="empty-state"><strong>You're caught up.</strong>New Regulars and quiet discoveries will collect here as they arrive.</div>`;
  bindCardControls(regularsList);
  renderCounts();
}

function renderSections(sections) {
  return sections
    .map(section => {
      const visibleItems = section.items.filter(item => !state.completed.includes(item.id));
      if (!visibleItems.length) return "";
      return `
      <section class="brief-section" id="${section.id}">
        <h2 class="section-label">${escapeHtml(section.title)}</h2>
        <div class="cards">${visibleItems.map(item => cardMarkup({ ...item, sectionId: section.id })).join("")}</div>
      </section>
    `;
    })
    .join("");
}

function cardMarkup(item) {
  const isSaved = state.saved.includes(item.id);
  const isFlagged = state.flags.some(flag => flag.item_id === item.id);
  const deadlineSoon = Number.isFinite(item.deadline_in_days) && item.deadline_in_days >= 0 && item.deadline_in_days <= 2;
  const sourceCount = item.sources.length;
  const sources = item.sources.map(source => {
    const name = escapeHtml(source.name);
    return `<li>${source.url ? `<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noreferrer">${name}</a>` : name}</li>`;
  }).join("");
  const bullets = item.details?.length ? `<ul>${item.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : "";
  const newsClass = ["general-news", "ai-news"].includes(item.sectionId) ? " is-news-card" : "";

  return `
    <article class="brief-card${newsClass}" data-item-id="${item.id}" data-deadline-soon="${deadlineSoon}">
      <h3>${escapeHtml(item.title)}</h3>
      <p class="card-summary">${escapeHtml(item.summary)}</p>
      <div class="detail-copy" id="details-${item.id}">
        ${bullets}
        ${item.context ? `<p>${escapeHtml(item.context)}</p>` : ""}
      </div>
      <div class="card-footer">
        <button class="card-action expand-action" aria-expanded="false" aria-controls="details-${item.id}">Show more</button>
        <span class="source-control">
          <button class="card-action source-action" type="button" aria-expanded="false">${sourceCount} ${sourceCount === 1 ? "source" : "sources"}</button>
          <span class="source-popover" role="dialog" aria-label="Sources for ${escapeHtml(item.title)}"><strong>Sources</strong><ul>${sources}</ul></span>
        </span>
        <button class="card-action flag-action${isFlagged ? " is-flagged" : ""}">${isFlagged ? "Flagged" : "Flag"}</button>
        <button class="card-action done-action">Done</button>
        <button class="card-action save-action${isSaved ? " is-saved" : ""}">${isSaved ? "Saved" : "Save"}</button>
      </div>
    </article>
  `;
}

function renderSaved() {
  const items = allItems().filter(item => state.saved.includes(item.id) && !state.completed.includes(item.id));
  savedList.innerHTML = items.length
    ? `<div class="cards">${items.map(item => cardMarkup(item)).join("")}</div>`
    : `<div class="empty-state"><strong>Nothing waiting for you.</strong>Use Save on any briefing card you genuinely want to revisit.</div>`;
  bindCardControls(savedList);
  renderCounts();
}

function renderCounts() {
  const items = allItems();
  const morningItems = items.filter(item => !["personal-pulse", "quiet-discoveries", "ai-learning"].includes(item.sectionId) && !state.completed.includes(item.id));
  const regularItems = items.filter(item => ["personal-pulse", "quiet-discoveries"].includes(item.sectionId) && !state.completed.includes(item.id));
  const learningItems = items.filter(item => item.sectionId === "ai-learning" && !state.completed.includes(item.id));
  document.querySelector("#item-count").textContent = morningItems.length;
  document.querySelector("#action-count").textContent = items.filter(item => item.actionable && !state.completed.includes(item.id)).length;
  document.querySelector("#regulars-count").textContent = regularItems.length;
  document.querySelector("#learning-count").textContent = learningItems.length;
  document.querySelector("#saved-count").textContent = items.filter(item => state.saved.includes(item.id) && !state.completed.includes(item.id)).length;
}

function bindStaticControls() {
  document.querySelectorAll(".view-tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".view-tab").forEach(tab => {
        tab.classList.toggle("is-active", tab === button);
        tab.setAttribute("aria-selected", tab === button ? "true" : "false");
      });
      const selectedView = button.dataset.view;
      todayView.hidden = selectedView !== "today";
      regularsView.hidden = selectedView !== "regulars";
      learningView.hidden = selectedView !== "learning";
      savedView.hidden = selectedView !== "saved";
      if (selectedView === "regulars") renderRegulars();
      if (selectedView === "learning") renderLearning();
      if (selectedView === "saved") renderSaved();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  feedbackButton.addEventListener("click", async () => {
    const saved = await syncFeedback();
    if (saved) showToast("Feedback is saved for the next run.");
    else exportFeedback();
  });

  document.querySelectorAll(".cancel-flag").forEach(button => button.addEventListener("click", () => {
    flagDialog.close();
    activeFlagItemId = null;
    flagNote.value = "";
  }));

  flagForm.addEventListener("submit", event => {
    event.preventDefault();
    const note = flagNote.value.trim();
    if (!note || !activeFlagItemId) return;
    state.flags = state.flags.filter(flag => flag.item_id !== activeFlagItemId);
    state.flags.push({ item_id: activeFlagItemId, note, created_at: new Date().toISOString() });
    persistState();
    flagDialog.close();
    renderToday();
    renderRegulars();
    renderLearning();
    renderSaved();
    showToast("Feedback saved. Gmail was not changed.");
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".source-control")) closeSourcePopovers();
  });
}

function bindCardControls(root) {
  root.querySelectorAll(".brief-card").forEach(card => {
    const itemId = card.dataset.itemId;
    card.querySelector(".expand-action")?.addEventListener("click", event => {
      const detail = card.querySelector(".detail-copy");
      const open = detail.classList.toggle("is-open");
      event.currentTarget.textContent = open ? "Show less" : "Show more";
      event.currentTarget.setAttribute("aria-expanded", String(open));
    });

    card.querySelector(".source-action")?.addEventListener("click", event => {
      event.stopPropagation();
      const popover = card.querySelector(".source-popover");
      const willOpen = !popover.classList.contains("is-open");
      closeSourcePopovers();
      popover.classList.toggle("is-open", willOpen);
      event.currentTarget.setAttribute("aria-expanded", String(willOpen));
    });

    card.querySelector(".save-action")?.addEventListener("click", () => {
      if (state.saved.includes(itemId)) {
        state.saved = state.saved.filter(id => id !== itemId);
        showToast("Removed from Saved.");
      } else {
        state.saved.push(itemId);
        showToast("Saved.");
      }
      persistState();
      renderToday();
      renderRegulars();
      renderLearning();
      renderSaved();
    });

    card.querySelector(".flag-action")?.addEventListener("click", () => openFlagDialog(itemId));

    card.querySelector(".done-action")?.addEventListener("click", () => {
      if (!state.completed.includes(itemId)) state.completed.push(itemId);
      persistState();
      renderToday();
      renderRegulars();
      renderLearning();
      renderSaved();
      showToast("Marked done.", () => {
        state.completed = state.completed.filter(id => id !== itemId);
        persistState();
        renderToday();
        renderRegulars();
        renderLearning();
        renderSaved();
      });
    });
  });
}

function openFlagDialog(itemId) {
  const item = allItems().find(candidate => candidate.id === itemId);
  const existing = state.flags.find(flag => flag.item_id === itemId);
  activeFlagItemId = itemId;
  document.querySelector("#flag-title").textContent = item ? `Flag: ${item.title}` : "Flag this item";
  flagNote.value = existing?.note || "";
  flagDialog.showModal();
  setTimeout(() => flagNote.focus(), 20);
}

function closeSourcePopovers() {
  document.querySelectorAll(".source-popover.is-open").forEach(popover => popover.classList.remove("is-open"));
  document.querySelectorAll(".source-action[aria-expanded='true']").forEach(button => button.setAttribute("aria-expanded", "false"));
}

function exportFeedback() {
  const payload = { ...feedbackPayload(), exported_at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `email-overview-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Feedback export downloaded.");
}

function showToast(message, undo) {
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? '<button type="button">Undo</button>' : ""}`;
  toast.querySelector("button")?.addEventListener("click", () => {
    undo();
    toast.classList.remove("is-visible");
  });
  toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}
