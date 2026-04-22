import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { CHECKLIST_SEED } from "./seed-data.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMz48aZvEaRGegjkw-8AHzPTo3sXkD9e4",
  authDomain: "seguimiento-de-aseo.firebaseapp.com",
  projectId: "seguimiento-de-aseo",
  storageBucket: "seguimiento-de-aseo.firebasestorage.app",
  messagingSenderId: "94588081006",
  appId: "1:94588081006:web:6cb504466e5855c6d8a77f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const state = {
  tasks: [],
  logs: [],
  queue: [],
  taskStatuses: [],
  currentTask: null,
  isAdmin: false,
  editingTaskId: ""
};

const $ = (selector) => document.querySelector(selector);

const els = {
  pageTitle: $("#pageTitle"),
  pageSubtitle: $("#pageSubtitle"),
  adminView: $("#adminView"),
  focusTaskTitle: $("#focusTaskTitle"),
  focusTaskArea: $("#focusTaskArea"),
  focusTaskSubarea: $("#focusTaskSubarea"),
  focusTaskGuide: $("#focusTaskGuide"),
  focusTaskMinutes: $("#focusTaskMinutes"),
  focusTaskChecklist: $("#focusTaskChecklist"),
  focusTaskSuppliesMini: $("#focusTaskSuppliesMini"),
  focusTaskEppMini: $("#focusTaskEppMini"),
  focusTaskNotes: $("#focusTaskNotes"),
  focusTaskLastDone: $("#focusTaskLastDone"),
  adminSummary: $("#adminSummary"),
  recentActivity: $("#recentActivity"),
  areaBreakdown: $("#areaBreakdown"),
  taskStatusTable: $("#taskStatusTable"),
  taskCatalogTable: $("#taskCatalogTable"),
  taskEditorForm: $("#taskEditorForm"),
  taskIdInput: $("#taskIdInput"),
  taskNameInput: $("#taskNameInput"),
  taskAreaInput: $("#taskAreaInput"),
  taskSubareaInput: $("#taskSubareaInput"),
  taskTypeInput: $("#taskTypeInput"),
  taskFrequencyInput: $("#taskFrequencyInput"),
  taskCleaningLevelInput: $("#taskCleaningLevelInput"),
  taskCriticalityInput: $("#taskCriticalityInput"),
  taskMinutesInput: $("#taskMinutesInput"),
  taskSlaInput: $("#taskSlaInput"),
  taskResponsibleInput: $("#taskResponsibleInput"),
  taskEvidenceInput: $("#taskEvidenceInput"),
  taskSuppliesInput: $("#taskSuppliesInput"),
  taskEppInput: $("#taskEppInput"),
  taskNotesInput: $("#taskNotesInput"),
  newTaskBtn: $("#newTaskBtn"),
  deleteTaskBtn: $("#deleteTaskBtn"),
  toast: $("#toast"),
  refreshWorkerBtn: $("#refreshWorkerBtn"),
  refreshAdminBtn: $("#refreshAdminBtn"),
  completeTaskBtn: $("#completeTaskBtn"),
  skipTaskBtn: $("#skipTaskBtn")
};

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeTask(raw, index) {
  const area = raw["Área"] || raw["Ãrea"] || raw["ÃƒÂrea"] || "";
  const subarea = raw["Sub-área/Elemento"] || raw["Sub-Ã¡rea/Elemento"] || raw["Sub-ÃƒÂ¡rea/Elemento"] || "";
  const task = raw["Tarea"] || "";

  return {
    id: `${slugify(area)}__${slugify(subarea)}__${slugify(task)}__${index + 1}`,
    area,
    subarea,
    task,
    type: raw["Tipo de tarea"] || "",
    frequency: raw["Frecuencia"] || "",
    cleaningLevel: raw["Nivel de limpieza"] || "",
    criticality: raw["Criticidad"] || "",
    estimatedMinutes: Number.parseInt(raw["Tiempo estimado (min)"], 10) || 0,
    supplies: raw["Insumos requeridos"] || "",
    epp: raw["EPP requerido"] || "",
    responsible: raw["Responsable"] || "",
    slaHours: Number.parseInt(raw["SLA (máx horas)"] || raw["SLA (mÃ¡x horas)"] || raw["SLA (mÃƒÂ¡x horas)"], 10) || 0,
    notes: raw["Observaciones"] || "",
    evidenceUrl: raw["Evidencia (URL)"] || "",
    sourceDate: raw["Fecha"] || ""
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(dateValue) {
  if (!dateValue) return "Sin registro";
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Sin registro";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatRelativeFromNow(dateValue) {
  if (!dateValue) return "Sin registro";
  const ms = Date.now() - dateValue.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Hoy";
  if (days === 1) return "Hace 1 dia";
  return `Hace ${days} dias`;
}

function getRouteMode() {
  const pathname = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return pathname.endsWith("/admin") || search.includes("admin") || hash.includes("admin");
}

function getFrequencyWindowDays(frequency) {
  const normalized = String(frequency || "").toLowerCase();
  if (normalized.includes("diaria")) return 1;
  if (normalized.includes("semanal")) return 7;
  if (normalized.includes("mensual")) return 30;
  if (normalized.includes("segun necesidad") || normalized.includes("según necesidad")) return 3;
  return 3;
}

function getCriticalityWeight(criticality) {
  const normalized = String(criticality || "").toLowerCase();
  if (normalized.includes("alta")) return 45;
  if (normalized.includes("media")) return 25;
  return 12;
}

function computeTaskStatus(task, logs) {
  const taskLogs = logs
    .filter((log) => log.taskId === task.id)
    .sort((a, b) => (b.completedAt?.getTime?.() || 0) - (a.completedAt?.getTime?.() || 0));

  const lastLog = taskLogs[0] || null;
  const windowDays = getFrequencyWindowDays(task.frequency);
  const dueAt = lastLog?.completedAt
    ? new Date(lastLog.completedAt.getTime() + windowDays * 24 * 60 * 60 * 1000)
    : null;
  const now = new Date();
  const overdueDays = dueAt ? Math.max(0, Math.floor((now - dueAt) / (24 * 60 * 60 * 1000))) : windowDays;
  const isDue = !dueAt || dueAt <= now;
  const priority =
    getCriticalityWeight(task.criticality) +
    (task.frequency.toLowerCase().includes("diaria") ? 35 : task.frequency.toLowerCase().includes("semanal") ? 22 : 14) +
    (task.cleaningLevel.toLowerCase().includes("profunda") ? 10 : 0) +
    overdueDays * 6;

  return {
    ...task,
    lastCompletedAt: lastLog?.completedAt || null,
    dueAt,
    isDue,
    overdueDays,
    priority,
    statusLabel: !lastLog ? "Sin registro" : isDue ? "Pendiente" : "Al dia"
  };
}

function buildQueue() {
  state.taskStatuses = state.tasks.map((task) => computeTaskStatus(task, state.logs));
  state.queue = state.taskStatuses
    .filter((task) => task.isDue)
    .sort((a, b) => b.priority - a.priority || a.estimatedMinutes - b.estimatedMinutes);

  state.currentTask = state.queue[0] || null;
}

function statCard(label, value) {
  return `
    <article class="stat-card">
      <span class="stat-card__label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `;
}

function buildWorkerGuide(task) {
  const parts = [
    task.type ? `${task.type} en ${task.area}.` : `Tarea en ${task.area}.`,
    task.subarea ? `Revisa ${task.subarea.toLowerCase()}.` : "",
    task.cleaningLevel ? `Haz una limpieza ${task.cleaningLevel.toLowerCase()}.` : ""
  ];

  return parts.filter(Boolean).join(" ");
}

function buildChecklistHint(task) {
  return [task.subarea, task.type, task.frequency].filter(Boolean).join(" · ") || "Revisar y ejecutar";
}

function renderCurrentTask() {
  const task = state.currentTask;

  if (!task) {
    els.focusTaskTitle.textContent = "No hay tareas pendientes ahora.";
    els.focusTaskArea.textContent = "Buen trabajo";
    els.focusTaskSubarea.textContent = "La app te mostrara aqui lo siguiente cuando haga falta.";
    els.focusTaskGuide.textContent = "No necesitas hacer nada mas por ahora.";
    els.focusTaskMinutes.textContent = "0 min";
    els.focusTaskChecklist.textContent = "-";
    els.focusTaskSuppliesMini.textContent = "-";
    els.focusTaskEppMini.textContent = "-";
    els.focusTaskNotes.textContent = "Sin observaciones.";
    els.focusTaskLastDone.textContent = "Sin registro";
    return;
  }

  els.focusTaskTitle.textContent = task.task;
  els.focusTaskArea.textContent = task.area;
  els.focusTaskSubarea.textContent = task.subarea || "Sin detalle adicional";
  els.focusTaskGuide.textContent = buildWorkerGuide(task);
  els.focusTaskMinutes.textContent = `${task.estimatedMinutes || 0} min`;
  els.focusTaskChecklist.textContent = buildChecklistHint(task);
  els.focusTaskSuppliesMini.textContent = task.supplies || "Basicos";
  els.focusTaskEppMini.textContent = task.epp || "No especificado";
  els.focusTaskNotes.textContent = task.notes || "Sin observaciones.";
  els.focusTaskLastDone.textContent = task.lastCompletedAt ? formatDate(task.lastCompletedAt) : "Sin registro";
}

function renderAdminSummary() {
  const totalTasks = state.tasks.length;
  const pendingTasks = state.taskStatuses.filter((task) => task.isDue).length;
  const completedWithHistory = state.taskStatuses.filter((task) => task.lastCompletedAt).length;
  const noHistory = state.taskStatuses.filter((task) => !task.lastCompletedAt).length;
  const criticalPending = state.taskStatuses.filter((task) => task.isDue && String(task.criticality).toLowerCase().includes("alta")).length;
  const overdueWeek = state.taskStatuses.filter((task) => task.overdueDays >= 7).length;

  els.adminSummary.innerHTML = [
    statCard("Tareas base", totalTasks),
    statCard("Pendientes", pendingTasks),
    statCard("Con historial", completedWithHistory),
    statCard("Sin registro", noHistory),
    statCard("Criticas pendientes", criticalPending),
    statCard("Atrasadas +7 dias", overdueWeek)
  ].join("");
}

function renderRecentActivity() {
  els.recentActivity.innerHTML = state.logs.length
    ? state.logs.slice(0, 30).map((log) => `
      <article class="activity-row">
        <strong>${escapeHtml(log.taskName || "Tarea registrada")}</strong>
        <span>${escapeHtml(log.area || "Sin area")} · ${escapeHtml(log.workerName || "Trabajador")} · ${formatDate(log.completedAt)}</span>
      </article>
    `).join("")
    : `<article class="activity-row"><strong>Sin actividad aun</strong><span>Cuando el equipo empiece a marcar tareas, aparecera aqui.</span></article>`;
}

function renderAreaBreakdown() {
  const areaMap = new Map();
  state.taskStatuses.forEach((task) => {
    const current = areaMap.get(task.area) || { total: 0, due: 0, done: 0 };
    current.total += 1;
    if (task.isDue) current.due += 1;
    else current.done += 1;
    areaMap.set(task.area, current);
  });

  els.areaBreakdown.innerHTML = [...areaMap.entries()]
    .sort((a, b) => b[1].due - a[1].due || a[0].localeCompare(b[0], "es"))
    .map(([area, values]) => {
      const compliance = values.total ? Math.round((values.done / values.total) * 100) : 0;
      return `
        <article class="area-row">
          <strong>${escapeHtml(area)}</strong>
          <span>${values.done} al dia · ${values.due} pendientes · cumplimiento ${compliance}%</span>
        </article>
      `;
    }).join("");
}

function renderTaskStatusTable() {
  els.taskStatusTable.innerHTML = state.taskStatuses
    .slice()
    .sort((a, b) => {
      if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
      return b.overdueDays - a.overdueDays || a.area.localeCompare(b.area, "es");
    })
    .map((task) => `
      <tr>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.area)}</td>
        <td>${escapeHtml(task.frequency || "-")}</td>
        <td><span class="status-pill ${task.isDue ? "status-pill--due" : "status-pill--ok"}">${escapeHtml(task.statusLabel)}</span></td>
        <td>${escapeHtml(formatDate(task.lastCompletedAt))}</td>
        <td>${escapeHtml(task.dueAt ? formatDate(task.dueAt) : "Sin fecha")}</td>
        <td>${escapeHtml(task.lastCompletedAt ? formatRelativeFromNow(task.lastCompletedAt) : "Nunca")}</td>
      </tr>
    `).join("");
}

function renderTaskCatalogTable() {
  els.taskCatalogTable.innerHTML = state.tasks
    .slice()
    .sort((a, b) => a.area.localeCompare(b.area, "es") || a.task.localeCompare(b.task, "es"))
    .map((task) => `
      <tr>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.area)}</td>
        <td>${escapeHtml(task.frequency || "-")}</td>
        <td>${escapeHtml(task.criticality || "-")}</td>
        <td>${escapeHtml(`${task.estimatedMinutes || 0} min`)}</td>
        <td><button class="btn btn--ghost btn--compact" data-edit-task="${escapeHtml(task.id)}">Editar</button></td>
      </tr>
    `).join("");
}

function fillTaskForm(task) {
  const source = task || {
    id: "",
    task: "",
    area: "",
    subarea: "",
    type: "",
    frequency: "",
    cleaningLevel: "",
    criticality: "",
    estimatedMinutes: 0,
    slaHours: 0,
    responsible: "",
    evidenceUrl: "",
    supplies: "",
    epp: "",
    notes: ""
  };

  state.editingTaskId = source.id || "";
  els.taskIdInput.value = source.id || "";
  els.taskNameInput.value = source.task || "";
  els.taskAreaInput.value = source.area || "";
  els.taskSubareaInput.value = source.subarea || "";
  els.taskTypeInput.value = source.type || "";
  els.taskFrequencyInput.value = source.frequency || "";
  els.taskCleaningLevelInput.value = source.cleaningLevel || "";
  els.taskCriticalityInput.value = source.criticality || "";
  els.taskMinutesInput.value = String(source.estimatedMinutes || 0);
  els.taskSlaInput.value = String(source.slaHours || 0);
  els.taskResponsibleInput.value = source.responsible || "";
  els.taskEvidenceInput.value = source.evidenceUrl || "";
  els.taskSuppliesInput.value = source.supplies || "";
  els.taskEppInput.value = source.epp || "";
  els.taskNotesInput.value = source.notes || "";
  els.deleteTaskBtn.disabled = !source.id;
}

function getTaskFormPayload() {
  const taskName = els.taskNameInput.value.trim();
  const area = els.taskAreaInput.value.trim();
  const subarea = els.taskSubareaInput.value.trim();
  const type = els.taskTypeInput.value.trim();
  const frequency = els.taskFrequencyInput.value.trim();
  const cleaningLevel = els.taskCleaningLevelInput.value.trim();
  const criticality = els.taskCriticalityInput.value.trim();
  const estimatedMinutes = Number.parseInt(els.taskMinutesInput.value, 10) || 0;
  const slaHours = Number.parseInt(els.taskSlaInput.value, 10) || 0;
  const responsible = els.taskResponsibleInput.value.trim();
  const evidenceUrl = els.taskEvidenceInput.value.trim();
  const supplies = els.taskSuppliesInput.value.trim();
  const epp = els.taskEppInput.value.trim();
  const notes = els.taskNotesInput.value.trim();

  if (!taskName || !area || !frequency || !criticality) {
    throw new Error("Completa nombre, area, frecuencia y criticidad.");
  }

  return {
    task: taskName,
    area,
    subarea,
    type,
    frequency,
    cleaningLevel,
    criticality,
    estimatedMinutes,
    supplies,
    epp,
    responsible,
    slaHours,
    notes,
    evidenceUrl,
    sourceDate: new Date().toISOString()
  };
}

function makeTaskId(payload) {
  return `${slugify(payload.area)}__${slugify(payload.subarea)}__${slugify(payload.task)}`;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.style.background = isError ? "rgba(184, 76, 61, 0.96)" : "rgba(34, 10, 99, 0.96)";
  clearTimeout(showToast.timerId);
  showToast.timerId = window.setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

async function ensureSeeded() {
  const countSnapshot = await getCountFromServer(collection(db, "tasks"));
  if (countSnapshot.data().count > 0) return false;

  const normalizedTasks = CHECKLIST_SEED.map(normalizeTask);
  await Promise.all(normalizedTasks.map((task) => setDoc(doc(db, "tasks", task.id), task)));
  return true;
}

async function loadTasks() {
  const snapshot = await getDocs(query(collection(db, "tasks")));
  state.tasks = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function loadLogs() {
  const snapshot = await getDocs(query(collection(db, "task_logs"), orderBy("completedAt", "desc"), limit(300)));
  state.logs = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      completedAt: data.completedAt?.toDate?.() || null
    };
  });
}

async function refreshData() {
  await loadTasks();
  await loadLogs();
  buildQueue();
  renderCurrentTask();
  renderAdminSummary();
  renderRecentActivity();
  renderAreaBreakdown();
  renderTaskStatusTable();
  renderTaskCatalogTable();

  if (state.editingTaskId) {
    const selectedTask = state.tasks.find((task) => task.id === state.editingTaskId);
    if (selectedTask) fillTaskForm(selectedTask);
    else fillTaskForm(null);
  } else {
    fillTaskForm(null);
  }
}

async function markCurrentTaskDone() {
  if (!state.currentTask) return;

  const task = state.currentTask;
  await addDoc(collection(db, "task_logs"), {
    taskId: task.id,
    taskName: task.task,
    area: task.area,
    subarea: task.subarea,
    frequency: task.frequency,
    workerName: "Trabajador",
    completedAt: serverTimestamp(),
    estimatedMinutes: task.estimatedMinutes,
    criticality: task.criticality
  });

  showToast(`Tarea realizada: ${task.task}`);
  await refreshData();
}

function skipCurrentTask() {
  if (!state.queue.length) return;
  const [first, ...rest] = state.queue;
  state.queue = [...rest, first];
  state.currentTask = state.queue[0] || null;
  renderCurrentTask();
}

async function saveTaskFromForm(event) {
  event.preventDefault();
  const payload = getTaskFormPayload();
  const targetId = state.editingTaskId || makeTaskId(payload);
  const docRef = doc(db, "tasks", targetId);
  await setDoc(docRef, { id: targetId, ...payload });
  state.editingTaskId = targetId;
  showToast("Tarea guardada en Firebase.");
  await refreshData();
}

async function deleteEditingTask() {
  if (!state.editingTaskId) return;
  await deleteDoc(doc(db, "tasks", state.editingTaskId));
  fillTaskForm(null);
  showToast("Tarea eliminada.");
  await refreshData();
}

function applyMode() {
  state.isAdmin = getRouteMode();
  els.pageTitle.textContent = state.isAdmin
    ? "Panel de control de aseo y organizacion"
    : "Abre la app y sigue la tarea";
  els.pageSubtitle.textContent = state.isAdmin
    ? "Administra tareas, revisa cumplimiento y ajusta la operacion desde aqui."
    : "Mira que sigue y marcalo cuando termines.";
  els.adminView.classList.toggle("hidden", !state.isAdmin);
}

function handleError(error) {
  console.error(error);
  showToast(error?.message || "Ocurrio un error inesperado.", true);
}

function bindEvents() {
  els.refreshWorkerBtn.addEventListener("click", () => refreshData().then(() => showToast("Datos actualizados.")));
  els.refreshAdminBtn.addEventListener("click", () => refreshData().then(() => showToast("Panel actualizado.")));
  els.completeTaskBtn.addEventListener("click", () => markCurrentTaskDone().catch(handleError));
  els.skipTaskBtn.addEventListener("click", skipCurrentTask);

  els.newTaskBtn.addEventListener("click", () => fillTaskForm(null));
  els.deleteTaskBtn.addEventListener("click", () => deleteEditingTask().catch(handleError));
  els.taskEditorForm.addEventListener("submit", (event) => saveTaskFromForm(event).catch(handleError));

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-edit-task]");
    if (!trigger) return;
    const task = state.tasks.find((item) => item.id === trigger.dataset.editTask);
    if (task) fillTaskForm(task);
  });

  window.addEventListener("hashchange", () => {
    applyMode();
    renderAdminSummary();
  });
}

async function init() {
  applyMode();
  bindEvents();

  try {
    const seeded = await ensureSeeded();
    await refreshData();
    if (seeded) showToast("Se cargaron las tareas base del checklist.");
  } catch (error) {
    handleError(error);
    els.focusTaskTitle.textContent = "No se pudo conectar con Firebase.";
    els.focusTaskArea.textContent = "Revisa Firestore y las reglas.";
    els.focusTaskSubarea.textContent = "La app ya quedo lista para terminar esa configuracion.";
    els.focusTaskGuide.textContent = "Cuando Firebase responda bien, aqui aparecera la siguiente tarea.";
  }
}

init();
