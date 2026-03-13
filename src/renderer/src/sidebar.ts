import morphdom from "morphdom";
import {
  activePtyIds,
  activeSessionId,
  attentionSessions,
  cachedAllProjects,
  cachedProjects,
  getExpandedSlugs,
  lastActivityTime,
  loadingStatus,
  openSessions,
  type ProjectObj,
  pendingSessions,
  placeholder,
  type SessionObj,
  saveExpandedSlugs,
  searchInput,
  sessionMap,
  sessionMaxAgeDays,
  setActiveSession,
  setCachedAllProjects,
  setCachedProjects,
  showArchived,
  showRunningOnly,
  showStarredOnly,
  showTodayOnly,
  sidebarContent,
  terminalHeader,
  unreadSessions,
  visibleSessionCount,
} from "./state";
import { pollActiveSessions } from "./terminal";
import { cleanDisplayName, escapeHtml, formatDate } from "./utils";

// Sort debouncing: preserve order when timestamps change by small amounts (background refreshes).
// Only re-sort an item when its timestamp jumps significantly (e.g. user opened an old session).
// Snapshot stores the sortTime actually used, so small drifts accumulate and eventually trigger resort.
export const sortSnapshot: Map<string, number> = new Map(); // itemId → sortTime used in last render
const SORT_DRIFT_THRESHOLD: number = 5 * 60 * 1000; // 5 minutes
export let lastProjectSortTime: number = 0; // timestamp of last project group re-sort

export function setLastProjectSortTime(v: number): void {
  lastProjectSortTime = v;
}

export function resetSortDebouncing(): void {
  sortSnapshot.clear();
  lastProjectSortTime = 0;
}

export function slugId(slug: string): string {
  return `slug-${slug.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function folderId(projectPath: string): string {
  return `project-${projectPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function dedup(projects: ProjectObj[]): void {
  for (const p of projects) {
    for (let i = 0; i < p.sessions.length; i++) {
      const s = p.sessions[i];
      if (sessionMap.has(s.sessionId)) {
        Object.assign(sessionMap.get(s.sessionId), s);
        p.sessions[i] = sessionMap.get(s.sessionId);
      } else {
        sessionMap.set(s.sessionId, s);
      }
    }
  }
}

export function buildSessionItem(session: SessionObj): HTMLDivElement {
  const item: HTMLDivElement = document.createElement("div");
  item.className = "session-item";
  item.id = `si-${session.sessionId}`;
  if (session.type === "terminal") item.classList.add("is-terminal");
  if (session.archived) item.classList.add("archived-item");
  if (activePtyIds.has(session.sessionId))
    item.classList.add("has-running-pty");
  if (unreadSessions.has(session.sessionId)) item.classList.add("has-unread");
  if (attentionSessions.has(session.sessionId))
    item.classList.add("needs-attention");
  item.dataset.sessionId = session.sessionId;

  const modified: Date =
    lastActivityTime.get(session.sessionId) || new Date(session.modified);
  const timeStr: string = formatDate(modified);
  const displayName: string = cleanDisplayName(session.name || session.summary);

  const row: HTMLDivElement = document.createElement("div");
  row.className = "session-row";

  // Pin
  const pin: HTMLSpanElement = document.createElement("span");
  pin.className = `session-pin${session.starred ? " pinned" : ""}`;
  pin.innerHTML = session.starred
    ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.49-.888-.656L10.073 9.333l-.07 3.181a.5.5 0 0 1-.853.354l-3.535-3.536-4.243 4.243a.5.5 0 1 1-.707-.707l4.243-4.243L1.372 5.11a.5.5 0 0 1 .354-.854l3.18-.07L8.37 .722A3.37 3.37 0 0 1 9.12.074a.5.5 0 0 1 .708.002l-.707.707z"/></svg>';

  // Running status dot
  const dot: HTMLSpanElement = document.createElement("span");
  dot.className =
    "session-status-dot" +
    (activePtyIds.has(session.sessionId) ? " running" : "");

  // Info block
  const info: HTMLDivElement = document.createElement("div");
  info.className = "session-info";

  const summaryEl: HTMLDivElement = document.createElement("div");
  summaryEl.className = "session-summary";
  summaryEl.textContent = displayName;

  const idEl: HTMLDivElement = document.createElement("div");
  idEl.className = "session-id";
  idEl.textContent = session.sessionId;

  const metaEl: HTMLDivElement = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent =
    timeStr +
    (session.messageCount ? ` \u00b7 ${session.messageCount} msgs` : "");

  if (session.type === "terminal") {
    const badge: HTMLSpanElement = document.createElement("span");
    badge.className = "terminal-badge";
    badge.textContent = ">_";
    summaryEl.prepend(badge);
  }
  info.appendChild(summaryEl);
  info.appendChild(idEl);
  info.appendChild(metaEl);

  // Action buttons container
  const actions: HTMLDivElement = document.createElement("div");
  actions.className = "session-actions";

  const stopBtn: HTMLButtonElement = document.createElement("button");
  stopBtn.className = "session-stop-btn";
  stopBtn.title = "Stop session";
  stopBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';

  const archiveBtn: HTMLButtonElement = document.createElement("button");
  archiveBtn.className = "session-archive-btn";
  archiveBtn.title = session.archived ? "Unarchive" : "Archive";
  archiveBtn.innerHTML = session.archived
    ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,7 6,5 8,7"/><line x1="6" y1="5" x2="6" y2="10"/><path d="M1,4 L1,11 L11,11 L11,4"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';

  const forkBtn: HTMLButtonElement = document.createElement("button");
  forkBtn.className = "session-fork-btn";
  forkBtn.title = "Fork session";
  forkBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="9.5" r="1.5"/><line x1="6" y1="4" x2="6" y2="6"/><line x1="6" y1="6" x2="3" y2="8"/><line x1="6" y1="6" x2="9" y2="8"/></svg>';

  const jsonlBtn: HTMLButtonElement = document.createElement("button");
  jsonlBtn.className = "session-jsonl-btn";
  jsonlBtn.title = "View messages";
  jsonlBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h8M2 6h6M2 9h4"/></svg>';

  actions.appendChild(stopBtn);
  actions.appendChild(forkBtn);
  actions.appendChild(jsonlBtn);
  actions.appendChild(archiveBtn);

  row.appendChild(pin);
  row.appendChild(dot);
  row.appendChild(info);
  row.appendChild(actions);
  item.appendChild(row);

  return item;
}

export function buildSlugGroup(
  slug: string,
  sessions: SessionObj[],
): HTMLDivElement {
  const group: HTMLDivElement = document.createElement("div");
  const id: string = slugId(slug);
  const expanded: boolean = getExpandedSlugs().has(id);
  group.className = expanded ? "slug-group" : "slug-group collapsed";
  group.id = id;

  const mostRecent: SessionObj = sessions.reduce(
    (a: SessionObj, b: SessionObj) => {
      const aTime: Date =
        lastActivityTime.get(a.sessionId) || new Date(a.modified);
      const bTime: Date =
        lastActivityTime.get(b.sessionId) || new Date(b.modified);
      return bTime > aTime ? b : a;
    },
  );
  const displayName: string = cleanDisplayName(
    mostRecent.name || mostRecent.summary || slug,
  );
  const mostRecentTime: Date =
    lastActivityTime.get(mostRecent.sessionId) || new Date(mostRecent.modified);
  const timeStr: string = formatDate(mostRecentTime);

  const header: HTMLDivElement = document.createElement("div");
  header.className = "slug-group-header";

  const row: HTMLDivElement = document.createElement("div");
  row.className = "slug-group-row";

  const expand: HTMLSpanElement = document.createElement("span");
  expand.className = "slug-group-expand";
  expand.innerHTML = '<span class="arrow">&#9654;</span>';

  const info: HTMLDivElement = document.createElement("div");
  info.className = "slug-group-info";

  const nameEl: HTMLDivElement = document.createElement("div");
  nameEl.className = "slug-group-name";
  nameEl.textContent = displayName;

  const hasRunning: boolean = sessions.some((s) =>
    activePtyIds.has(s.sessionId),
  );

  const meta: HTMLDivElement = document.createElement("div");
  meta.className = "slug-group-meta";
  meta.innerHTML = `<span class="slug-group-dot${hasRunning ? " running" : ""}"></span><span class="slug-group-count">${sessions.length} sessions</span> ${escapeHtml(timeStr)}`;

  const archiveSlugBtn: HTMLButtonElement = document.createElement("button");
  archiveSlugBtn.className = "slug-group-archive-btn";
  archiveSlugBtn.title = "Archive all sessions in group";
  archiveSlugBtn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';

  info.appendChild(nameEl);
  info.appendChild(meta);
  row.appendChild(expand);
  row.appendChild(info);
  row.appendChild(archiveSlugBtn);
  header.appendChild(row);

  const sessionsContainer: HTMLDivElement = document.createElement("div");
  sessionsContainer.className = "slug-group-sessions";

  const promoted: SessionObj[] = [];
  const rest: SessionObj[] = [];
  for (const session of sessions) {
    if (activePtyIds.has(session.sessionId)) {
      promoted.push(session);
    } else {
      rest.push(session);
    }
  }

  if (promoted.length > 0) {
    group.classList.add("has-promoted");
    for (const session of promoted) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
    if (rest.length > 0) {
      const moreBtn: HTMLDivElement = document.createElement("div");
      moreBtn.className = "slug-group-more";
      moreBtn.id = `sgm-${id}`;
      moreBtn.textContent = `+ ${rest.length} more`;

      const olderDiv: HTMLDivElement = document.createElement("div");
      olderDiv.className = "slug-group-older";
      olderDiv.id = `sgo-${id}`;
      for (const session of rest) {
        olderDiv.appendChild(buildSessionItem(session));
      }

      sessionsContainer.appendChild(moreBtn);
      sessionsContainer.appendChild(olderDiv);
    }
  } else {
    for (const session of sessions) {
      sessionsContainer.appendChild(buildSessionItem(session));
    }
  }

  group.appendChild(header);
  group.appendChild(sessionsContainer);
  return group;
}

export function startRename(summaryEl: Element, session: SessionObj): void {
  const input: HTMLInputElement = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = session.name || session.summary;

  summaryEl.replaceWith(input);
  input.focus();
  input.select();

  const save = async (): Promise<void> => {
    const newName: string = input.value.trim();
    const nameToSave: string | null =
      newName && newName !== session.summary ? newName : null;
    await window.api.renameSession(session.sessionId, nameToSave);
    session.name = nameToSave;

    const newSummary: HTMLDivElement = document.createElement("div");
    newSummary.className = "session-summary";
    newSummary.textContent = nameToSave || session.summary;
    newSummary.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename(newSummary, session);
    });
    input.replaceWith(newSummary);
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", save);
      const restored: HTMLDivElement = document.createElement("div");
      restored.className = "session-summary";
      restored.textContent = session.name || session.summary;
      restored.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        startRename(restored, session);
      });
      input.replaceWith(restored);
    }
  });
}

let lastRenderWasSearch: boolean = false;

export function renderProjects(
  projects: ProjectObj[],
  isSearchResult?: boolean,
): void {
  const newSidebar: HTMLDivElement = document.createElement("div");

  // Debounce project group re-sorting: only re-sort if >5 min since last sort
  const now: number = Date.now();
  if (now - lastProjectSortTime > SORT_DRIFT_THRESHOLD || lastRenderWasSearch) {
    lastProjectSortTime = now;
    // projects arrive pre-sorted from main process — accept new order
  } else if (!isSearchResult && sidebarContent.children.length > 0) {
    // Preserve current project group order
    const existingOrder: Map<string, number> = new Map();
    let idx: number = 0;
    for (const child of sidebarContent.children) {
      if (child.id) existingOrder.set(child.id, idx++);
    }
    projects = [...projects].sort((a: ProjectObj, b: ProjectObj) => {
      const aIdx: number | undefined = existingOrder.get(
        folderId(a.projectPath),
      );
      const bIdx: number | undefined = existingOrder.get(
        folderId(b.projectPath),
      );
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx === undefined) return -1; // new projects go to top
      if (bIdx === undefined) return -1;
      return 0;
    });
  }

  for (const project of projects) {
    // === STEP 1: Filter ===
    let filtered: SessionObj[] = project.sessions;
    if (showStarredOnly) {
      filtered = filtered.filter((s: SessionObj) => s.starred);
    }
    if (showRunningOnly) {
      filtered = filtered.filter((s: SessionObj) =>
        activePtyIds.has(s.sessionId),
      );
    }
    if (showTodayOnly) {
      const todayDate: Date = new Date();
      const todayStr: string = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
      filtered = filtered.filter((s: SessionObj) => {
        if (!s.modified) return false;
        const d: Date = new Date(s.modified);
        return (
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` ===
          todayStr
        );
      });
    }
    if (filtered.length === 0 && project.sessions.length > 0) continue;

    // === STEP 2: Sort ===
    // Priority: pinned+running > running > pinned > rest (by modified desc)
    filtered = [...filtered].sort((a: SessionObj, b: SessionObj) => {
      const aRunning: boolean =
        activePtyIds.has(a.sessionId) || pendingSessions.has(a.sessionId);
      const bRunning: boolean =
        activePtyIds.has(b.sessionId) || pendingSessions.has(b.sessionId);
      const aPri: number =
        a.starred && aRunning ? 3 : aRunning ? 2 : a.starred ? 1 : 0;
      const bPri: number =
        b.starred && bRunning ? 3 : bRunning ? 2 : b.starred ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });

    // === STEP 3: Slug grouping ===
    const slugMap: Map<string, SessionObj[]> = new Map(); // slug → sessions[]
    const ungrouped: SessionObj[] = [];
    for (const session of filtered) {
      if (session.slug) {
        if (!slugMap.has(session.slug)) slugMap.set(session.slug, []);
        slugMap.get(session.slug).push(session);
      } else {
        ungrouped.push(session);
      }
    }

    // Build render items (slug group = 1 item)
    const allItems: {
      sortTime: number;
      pinned: boolean;
      running: boolean;
      element: HTMLDivElement;
      effectiveSortTime?: number;
    }[] = [];
    for (const session of ungrouped) {
      const isRunning: boolean =
        activePtyIds.has(session.sessionId) ||
        pendingSessions.has(session.sessionId);
      allItems.push({
        sortTime: new Date(session.modified).getTime(),
        pinned: Boolean(session.starred),
        running: isRunning,
        element: buildSessionItem(session),
      });
    }
    for (const [slug, sessions] of slugMap) {
      const mostRecentTime: number = Math.max(
        ...sessions.map((s: SessionObj) => new Date(s.modified).getTime()),
      );
      const hasRunning: boolean = sessions.some(
        (s: SessionObj) =>
          activePtyIds.has(s.sessionId) || pendingSessions.has(s.sessionId),
      );
      const hasPinned: boolean = sessions.some((s: SessionObj) => s.starred);
      const element: HTMLDivElement =
        sessions.length === 1
          ? buildSessionItem(sessions[0])
          : buildSlugGroup(slug, sessions);
      allItems.push({
        sortTime: mostRecentTime,
        pinned: hasPinned,
        running: hasRunning,
        element,
      });
    }

    // === STEP 4: Sort render items with debouncing ===
    // Compare each item's sortTime against snapshot. If the change is small
    // (background refresh touching mtime), keep the old sortTime to preserve order.
    // If the change is large (user opened an old session), use new sortTime.
    const fId: string = folderId(project.projectPath);
    for (const item of allItems) {
      const id: string = item.element.id;
      const prev: number | undefined = sortSnapshot.get(id);
      if (prev !== undefined) {
        const delta: number = Math.abs(item.sortTime - prev);
        if (delta < SORT_DRIFT_THRESHOLD) {
          item.effectiveSortTime = prev; // small drift — keep old position
        } else {
          item.effectiveSortTime = item.sortTime; // big jump — allow resort
        }
      } else {
        item.effectiveSortTime = item.sortTime; // new item
      }
    }
    allItems.sort((a, b) => {
      const aPri: number =
        a.pinned && a.running ? 3 : a.running ? 2 : a.pinned ? 1 : 0;
      const bPri: number =
        b.pinned && b.running ? 3 : b.running ? 2 : b.pinned ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      return (b.effectiveSortTime ?? 0) - (a.effectiveSortTime ?? 0);
    });
    // Save snapshot: use effectiveSortTime so small drifts accumulate
    for (const item of allItems) {
      sortSnapshot.set(item.element.id, item.effectiveSortTime ?? 0);
    }

    // === STEP 5: Truncate — split into visible vs older ===
    let visible: typeof allItems = [];
    let older: typeof allItems = [];
    if (isSearchResult || showStarredOnly || showRunningOnly || showTodayOnly) {
      visible = allItems;
    } else {
      let count: number = 0;
      const ageCutoff: number = Date.now() - sessionMaxAgeDays * 86400000;
      for (const item of allItems) {
        // Running and pinned always show; others must be within count AND age limit
        if (
          item.running ||
          item.pinned ||
          (count < visibleSessionCount && item.sortTime >= ageCutoff)
        ) {
          visible.push(item);
          count++;
        } else {
          older.push(item);
        }
      }
      // If visible is empty but older has items, show them directly
      if (visible.length === 0 && older.length > 0) {
        visible = older;
        older = [];
      }
    }

    // === STEP 6: Build DOM ===
    const group: HTMLDivElement = document.createElement("div");
    group.className = "project-group";
    group.id = fId;

    const header: HTMLDivElement = document.createElement("div");
    header.className = "project-header";
    header.id = `ph-${fId}`;
    const shortName: string = project.projectPath
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join("/");
    header.innerHTML = `<span class="arrow">&#9660;</span> <span class="project-name">${shortName}</span>`;

    const settingsBtn: HTMLButtonElement = document.createElement("button");
    settingsBtn.className = "project-settings-btn";
    settingsBtn.title = "Project settings";
    settingsBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 1h2.8l.4 2.1a5.5 5.5 0 0 1 1.3.8l2-.8 1.4 2.4-1.6 1.4a5.6 5.6 0 0 1 0 1.5l1.6 1.4-1.4 2.4-2-.8a5.5 5.5 0 0 1-1.3.8L9.4 15H6.6l-.4-2.1a5.5 5.5 0 0 1-1.3-.8l-2 .8-1.4-2.4 1.6-1.4a5.6 5.6 0 0 1 0-1.5L1.5 6.2l1.4-2.4 2 .8a5.5 5.5 0 0 1 1.3-.8L6.6 1z"/><circle cx="8" cy="8" r="2.5"/></svg>';
    header.appendChild(settingsBtn);

    const archiveGroupBtn: HTMLButtonElement = document.createElement("button");
    archiveGroupBtn.className = "project-archive-btn";
    archiveGroupBtn.title = "Archive all sessions";
    archiveGroupBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1,1 L11,1 L11,4 L1,4 Z"/><path d="M1,4 L1,11 L11,11 L11,4"/><line x1="5" y1="6.5" x2="7" y2="6.5"/></svg>';
    header.appendChild(archiveGroupBtn);

    const newBtn: HTMLButtonElement = document.createElement("button");
    newBtn.className = "project-new-btn";
    newBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>';
    newBtn.title = "New session";
    header.appendChild(newBtn);

    const sessionsList: HTMLDivElement = document.createElement("div");
    sessionsList.className = "project-sessions";
    sessionsList.id = `sessions-${fId}`;

    for (const item of visible) {
      sessionsList.appendChild(item.element);
    }

    if (older.length > 0) {
      const moreBtn: HTMLDivElement = document.createElement("div");
      moreBtn.className = "sessions-more-toggle";
      moreBtn.id = `older-${fId}`;
      moreBtn.textContent = `+ ${older.length} older`;
      const olderList: HTMLDivElement = document.createElement("div");
      olderList.className = "sessions-older";
      olderList.id = `older-list-${fId}`;
      olderList.style.display = "none";
      for (const item of older) {
        olderList.appendChild(item.element);
      }
      sessionsList.appendChild(moreBtn);
      sessionsList.appendChild(olderList);
    }

    // Auto-collapse if most recent session is older than 5 days
    if (!(isSearchResult || showStarredOnly || showRunningOnly)) {
      const mostRecent: string | undefined = filtered[0]?.modified;
      if (
        mostRecent &&
        Date.now() - new Date(mostRecent).getTime() >
          sessionMaxAgeDays * 86400000
      ) {
        header.classList.add("collapsed");
      }
    }

    group.appendChild(header);
    group.appendChild(sessionsList);
    newSidebar.appendChild(group);
  }

  // Re-apply active state
  if (activeSessionId) {
    const activeItem: Element | null = newSidebar.querySelector(
      `[data-session-id="${activeSessionId}"]`,
    );
    if (activeItem) activeItem.classList.add("active");
  }

  morphdom(sidebarContent, newSidebar, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl: HTMLElement, toEl: HTMLElement): boolean {
      if (fromEl.classList.contains("project-header")) {
        if (fromEl.classList.contains("collapsed")) {
          toEl.classList.add("collapsed");
        } else {
          toEl.classList.remove("collapsed");
        }
      }
      if (fromEl.classList.contains("slug-group")) {
        if (fromEl.classList.contains("collapsed")) {
          toEl.classList.add("collapsed");
        } else {
          toEl.classList.remove("collapsed");
        }
      }
      if (
        fromEl.classList.contains("sessions-older") &&
        fromEl.style.display !== "none"
      ) {
        toEl.style.display = "";
      }
      if (
        fromEl.classList.contains("sessions-more-toggle") &&
        fromEl.classList.contains("expanded")
      ) {
        toEl.classList.add("expanded");
        toEl.textContent = "- hide older";
      }
      if (
        fromEl.classList.contains("slug-group-older") &&
        fromEl.style.display !== "none"
      ) {
        toEl.style.display = "";
      }
      if (
        fromEl.classList.contains("slug-group-more") &&
        fromEl.classList.contains("expanded")
      ) {
        toEl.classList.add("expanded");
      }
      return true;
    },
    getNodeKey(node: HTMLElement): string | undefined {
      return node.id || undefined;
    },
  });

  lastRenderWasSearch = Boolean(isSearchResult);

  // Restore terminal focus after morphdom DOM updates, but not if the user is typing in the search box
  if (
    activeSessionId &&
    openSessions.has(activeSessionId) &&
    document.activeElement !== searchInput
  ) {
    openSessions.get(activeSessionId).terminal.focus();
  }
}

export function rebindSidebarEvents(
  projects: ProjectObj[],
  callbacks: {
    openSession: (session: SessionObj) => void;
    showNewSessionPopover: (project: ProjectObj, anchorEl: Element) => void;
    openSettingsViewer: (scope: string, projectPath?: string) => Promise<void>;
    showJsonlViewer: (session: SessionObj) => Promise<void>;
    forkSession: (session: SessionObj, project: ProjectObj) => Promise<void>;
    loadProjects: () => Promise<void>;
  },
): void {
  for (const project of projects) {
    const fId: string = folderId(project.projectPath);
    const header: HTMLElement | null = document.getElementById(`ph-${fId}`);
    if (!header) continue;
    const newBtn: Element | null = header.querySelector(".project-new-btn");
    if (newBtn) {
      (newBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        callbacks.showNewSessionPopover(project, newBtn);
      };
    }
    const settingsBtn: Element | null = header.querySelector(
      ".project-settings-btn",
    );
    if (settingsBtn) {
      (settingsBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        void callbacks.openSettingsViewer("project", project.projectPath);
      };
    }
    const archiveGroupBtn: Element | null = header.querySelector(
      ".project-archive-btn",
    );
    if (archiveGroupBtn) {
      (archiveGroupBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const sessions: SessionObj[] = project.sessions.filter(
          (s: SessionObj) => !s.archived,
        );
        if (sessions.length === 0) return;
        const shortName: string = project.projectPath
          .split("/")
          .filter(Boolean)
          .slice(-2)
          .join("/");
        if (
          !confirm(
            `Archive all ${sessions.length} session${sessions.length > 1 ? "s" : ""} in ${shortName}?`,
          )
        )
          return;
        for (const s of sessions) {
          if (activePtyIds.has(s.sessionId)) {
            await window.api.stopSession(s.sessionId);
          }
          await window.api.archiveSession(s.sessionId, 1);
          s.archived = 1;
        }
        void pollActiveSessions();
        void callbacks.loadProjects();
      };
    }
    header.onclick = (e: MouseEvent): void => {
      if (
        (e.target as HTMLElement).closest(".project-new-btn") ||
        (e.target as HTMLElement).closest(".project-archive-btn") ||
        (e.target as HTMLElement).closest(".project-settings-btn")
      )
        return;
      header.classList.toggle("collapsed");
    };
  }

  for (const slugHeader of sidebarContent.querySelectorAll(
    ".slug-group-header",
  )) {
    const archiveBtn: Element | null = slugHeader.querySelector(
      ".slug-group-archive-btn",
    );
    if (archiveBtn) {
      (archiveBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const group: HTMLElement | null = slugHeader.parentElement;
        const sessionItems: NodeListOf<Element> = group
          ? group.querySelectorAll(".session-item")
          : document.querySelectorAll(".never-match-empty");
        for (const item of sessionItems) {
          const sid: string | undefined = (item as HTMLElement).dataset
            .sessionId;
          if (!sid) continue;
          const session: SessionObj | undefined = sessionMap.get(sid);
          if (!session || session.archived) continue;
          if (activePtyIds.has(sid)) await window.api.stopSession(sid);
          await window.api.archiveSession(sid, 1);
          session.archived = 1;
        }
        void pollActiveSessions();
        void callbacks.loadProjects();
      };
    }
    (slugHeader as HTMLElement).onclick = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest(".slug-group-archive-btn")) return;
      slugHeader.parentElement?.classList.toggle("collapsed");
      saveExpandedSlugs();
    };
  }

  for (const moreBtn of sidebarContent.querySelectorAll(".slug-group-more")) {
    (moreBtn as HTMLElement).onclick = (): void => {
      const group: Element | null = moreBtn.closest(".slug-group");
      if (group) {
        group.classList.remove("collapsed");
        saveExpandedSlugs();
      }
    };
  }

  for (const moreBtn of sidebarContent.querySelectorAll(
    ".sessions-more-toggle",
  )) {
    const olderList: Element | null = moreBtn.nextElementSibling;
    if (!olderList?.classList.contains("sessions-older")) continue;
    const count: number = olderList.children.length;
    (moreBtn as HTMLElement).onclick = (): void => {
      const showing: boolean =
        (olderList as HTMLElement).style.display !== "none";
      (olderList as HTMLElement).style.display = showing ? "none" : "";
      moreBtn.classList.toggle("expanded", !showing);
      moreBtn.textContent = showing ? `+ ${count} older` : "- hide older";
    };
  }

  for (const item of sidebarContent.querySelectorAll(".session-item")) {
    const sessionId: string | undefined = (item as HTMLElement).dataset
      .sessionId;
    const session: SessionObj | undefined = sessionId
      ? sessionMap.get(sessionId)
      : undefined;
    if (!session) continue;

    (item as HTMLElement).onclick = (): void => callbacks.openSession(session);

    const pin: Element | null = item.querySelector(".session-pin");
    if (pin) {
      (pin as HTMLElement).onclick = async (e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        const { starred } = await window.api.toggleStar(session.sessionId);
        session.starred = starred;
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
        rebindSidebarEvents(
          showArchived ? cachedAllProjects : cachedProjects,
          callbacks,
        );
      };
    }

    const summaryEl: Element | null = item.querySelector(".session-summary");
    if (summaryEl) {
      (summaryEl as HTMLElement).ondblclick = (e: MouseEvent): void => {
        e.stopPropagation();
        startRename(summaryEl, session);
      };
    }

    const stopBtn: Element | null = item.querySelector(".session-stop-btn");
    if (stopBtn) {
      (stopBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        await window.api.stopSession(session.sessionId);
        activePtyIds.delete(session.sessionId);
        if (activeSessionId === session.sessionId) {
          setActiveSession(null);
          terminalHeader.style.display = "none";
          placeholder.style.display = "";
        }
        renderProjects(showArchived ? cachedAllProjects : cachedProjects);
        rebindSidebarEvents(
          showArchived ? cachedAllProjects : cachedProjects,
          callbacks,
        );
      };
    }

    const forkBtn: Element | null = item.querySelector(".session-fork-btn");
    if (forkBtn) {
      (forkBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        // Find the project for this session
        const project: ProjectObj | undefined = [
          ...cachedAllProjects,
          ...cachedProjects,
        ].find((p: ProjectObj) =>
          p.sessions.some((s: SessionObj) => s.sessionId === session.sessionId),
        );
        if (project) {
          void callbacks.forkSession(session, project);
        }
      };
    }

    const jsonlBtn: Element | null = item.querySelector(".session-jsonl-btn");
    if (jsonlBtn) {
      (jsonlBtn as HTMLElement).onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        void callbacks.showJsonlViewer(session);
      };
    }

    const archiveBtn: Element | null = item.querySelector(
      ".session-archive-btn",
    );
    if (archiveBtn) {
      (archiveBtn as HTMLElement).onclick = async (
        e: MouseEvent,
      ): Promise<void> => {
        e.stopPropagation();
        const newVal: number = session.archived ? 0 : 1;
        if (newVal && activePtyIds.has(session.sessionId)) {
          await window.api.stopSession(session.sessionId);
          void pollActiveSessions();
        }
        await window.api.archiveSession(session.sessionId, newVal);
        session.archived = newVal;
        void callbacks.loadProjects();
      };
    }
  }
}

export async function loadProjects(
  renderDefaultStatusFn: () => void,
  renderProjectsFn: (projects: ProjectObj[], isSearch?: boolean) => void,
  rebindCallbacks: Parameters<typeof rebindSidebarEvents>[1],
): Promise<void> {
  const wasEmpty: boolean = cachedProjects.length === 0;
  if (wasEmpty) {
    loadingStatus.textContent = "Loading\u2026";
    loadingStatus.className = "active";
    loadingStatus.style.display = "";
  }
  const [defaultProjects, allProjects] = await Promise.all([
    window.api.getProjects(false),
    window.api.getProjects(true),
  ]);
  setCachedProjects(defaultProjects);
  setCachedAllProjects(allProjects);
  loadingStatus.style.display = "none";
  loadingStatus.className = "";
  dedup(cachedProjects);
  dedup(cachedAllProjects);

  // Reconcile pending sessions: remove ones that now have real data
  let _hasReinjected: boolean = false;
  for (const [sid, pending] of [...pendingSessions]) {
    const realExists: boolean = allProjects.some((p: ProjectObj) =>
      p.sessions.some((s: SessionObj) => s.sessionId === sid),
    );
    if (realExists) {
      pendingSessions.delete(sid);
    } else {
      _hasReinjected = true;
      // Still pending — re-inject into cached data
      for (const projList of [cachedProjects, cachedAllProjects]) {
        let proj: ProjectObj | undefined = projList.find(
          (p: ProjectObj) => p.projectPath === pending.projectPath,
        );
        if (!proj) {
          // Project not in list (no other sessions) — create a synthetic entry
          proj = {
            folder: pending.folder,
            projectPath: pending.projectPath,
            sessions: [],
          };
          projList.unshift(proj);
        }
        if (!proj.sessions.some((s: SessionObj) => s.sessionId === sid)) {
          proj.sessions.unshift(pending.session);
        }
      }
    }
  }

  // Restore active plain terminals from main process (survives renderer reload)
  try {
    const activeTerminals = await window.api.getActiveTerminals();
    for (const { sessionId, projectPath } of activeTerminals) {
      if (pendingSessions.has(sessionId)) continue; // already tracked
      const folder: string = projectPath
        .replace(/[/_]/g, "-")
        .replace(/^-/, "-");
      const session: SessionObj = {
        sessionId,
        summary: "Terminal",
        firstPrompt: "",
        projectPath,
        name: null,
        starred: 0,
        archived: 0,
        messageCount: 0,
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
        type: "terminal",
      };
      pendingSessions.set(sessionId, { session, projectPath, folder });
      sessionMap.set(sessionId, session);
      for (const projList of [cachedProjects, cachedAllProjects]) {
        let proj: ProjectObj | undefined = projList.find(
          (p: ProjectObj) => p.projectPath === projectPath,
        );
        if (!proj) {
          proj = { folder, projectPath, sessions: [] };
          projList.push(proj);
        }
        if (!proj.sessions.some((s: SessionObj) => s.sessionId === sessionId)) {
          proj.sessions.unshift(session);
        }
      }
    }
  } catch (e: unknown) {
    window.api.logWarn(
      `[loadProjects] failed to restore terminals: ${(e as Error).message}`,
    );
  }

  await pollActiveSessions();
  renderProjectsFn(showArchived ? cachedAllProjects : cachedProjects);
  rebindSidebarEvents(
    showArchived ? cachedAllProjects : cachedProjects,
    rebindCallbacks,
  );
  renderDefaultStatusFn();
}
