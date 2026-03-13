import { type CMEditorView, createPlanEditor } from "./codemirror-setup";
import {
  cachedAllProjects,
  cachedMemories,
  cachedPlans,
  cachedProjects,
  currentPlanContent,
  currentPlanFilePath,
  jsonlViewer,
  jsonlViewerBody,
  jsonlViewerSessionId,
  jsonlViewerTitle,
  memoryContent,
  memoryViewer,
  memoryViewerBody,
  memoryViewerFilename,
  memoryViewerTitle,
  openSessions,
  type ProjectObj,
  placeholder,
  planCopyContentBtn,
  planCopyPathBtn,
  planSaveBtn,
  plansContent,
  planViewer,
  planViewerEditorEl,
  planViewerFilepath,
  planViewerTitle,
  type SessionObj,
  setCachedMemories,
  setCachedPlans,
  setCurrentPlanContent,
  setCurrentPlanFilename,
  setCurrentPlanFilePath,
  setCurrentThemeName,
  setSessionMaxAgeDays,
  settingsViewer,
  settingsViewerBody,
  settingsViewerTitle,
  setVisibleSessionCount,
  showArchived,
  statsViewer,
  statsViewerBody,
  TERMINAL_THEME,
  terminalArea,
} from "./state";
import { TERMINAL_THEMES } from "./themes";
import { escapeHtml, flashButtonText, formatDate } from "./utils";

let planEditorView: CMEditorView | null = null;

// --- Viewer visibility helpers ---
export function hideAllViewers(): void {
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "none";
  jsonlViewer.style.display = "none";
  terminalArea.style.display = "";
}

export function hidePlanViewer(): void {
  hideAllViewers();
}

// --- Plans ---
export async function loadPlans(): Promise<void> {
  setCachedPlans(await window.api.getPlans());
  renderPlans();
}

export function renderPlans(plansArg?: ProjectObj[]): void {
  const plans: ProjectObj[] = plansArg || cachedPlans;
  plansContent.innerHTML = "";
  if (plans.length === 0) {
    const empty: HTMLDivElement = document.createElement("div");
    empty.className = "plans-empty";
    empty.textContent = "No plans found in ~/.claude/plans/";
    plansContent.appendChild(empty);
    return;
  }
  for (const plan of plans) {
    plansContent.appendChild(buildPlanItem(plan));
  }
}

export function buildPlanItem(plan: ProjectObj): HTMLDivElement {
  const item: HTMLDivElement = document.createElement("div");
  item.className = "session-item plan-item";

  const row: HTMLDivElement = document.createElement("div");
  row.className = "session-row";

  const info: HTMLDivElement = document.createElement("div");
  info.className = "session-info";

  const titleEl: HTMLDivElement = document.createElement("div");
  titleEl.className = "session-summary";
  titleEl.textContent = plan.title;

  const filenameEl: HTMLDivElement = document.createElement("div");
  filenameEl.className = "session-id";
  filenameEl.textContent = plan.filename;

  const metaEl: HTMLDivElement = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent = formatDate(new Date(plan.modified));

  info.appendChild(titleEl);
  info.appendChild(filenameEl);
  info.appendChild(metaEl);
  row.appendChild(info);
  item.appendChild(row);

  item.addEventListener("click", () => void openPlan(plan));
  return item;
}

export async function openPlan(plan: ProjectObj): Promise<void> {
  // Mark active in sidebar
  for (const el of plansContent.querySelectorAll(".plan-item.active")) {
    el.classList.remove("active");
  }
  for (const el of plansContent.querySelectorAll(".plan-item")) {
    if (el.querySelector(".session-id")?.textContent === plan.filename) {
      el.classList.add("active");
    }
  }

  const result = await window.api.readPlan(plan.filename);
  setCurrentPlanContent(result.content);
  setCurrentPlanFilePath(result.filePath);
  setCurrentPlanFilename(plan.filename);

  // Hide terminal area and placeholder, show plan viewer
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "none";
  planViewer.style.display = "flex";

  planViewerTitle.textContent = plan.title;
  planViewerFilepath.textContent = currentPlanFilePath;

  // Create or update CodeMirror editor
  if (!planEditorView) {
    planEditorView = createPlanEditor(planViewerEditorEl);
  }
  planEditorView.dispatch({
    changes: {
      from: 0,
      to: planEditorView.state.doc.length,
      insert: currentPlanContent,
    },
  });
}

// Plan toolbar button handlers
export function initPlanToolbar(): void {
  planCopyPathBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(currentPlanFilePath);
    flashButtonText(planCopyPathBtn, "Copied!");
  });

  planCopyContentBtn.addEventListener("click", () => {
    const content: string = planEditorView
      ? planEditorView.state.doc.toString()
      : currentPlanContent;
    void navigator.clipboard.writeText(content);
    flashButtonText(planCopyContentBtn, "Copied!");
  });

  planSaveBtn.addEventListener("click", async () => {
    if (planEditorView) {
      setCurrentPlanContent(planEditorView.state.doc.toString());
    }
    await window.api.savePlan(currentPlanFilePath, currentPlanContent);
    flashButtonText(planSaveBtn, "Saved!");
  });
}

// --- JSONL Message History Viewer ---
export function renderJsonlText(text: string): string {
  let html: string = escapeHtml(text);
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="jsonl-code-block"><code>$2</code></pre>',
  );
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="jsonl-inline-code">$1</code>',
  );
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return html;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s: string = (ms / 1000).toFixed(1);
  return `${s}s`;
}

export function makeCollapsible(
  className: string,
  headerText: string,
  bodyContent: unknown,
  startExpanded: boolean,
): HTMLDivElement {
  const wrapper: HTMLDivElement = document.createElement("div");
  wrapper.className = className;
  const header: HTMLDivElement = document.createElement("div");
  header.className = `jsonl-toggle${startExpanded ? " expanded" : ""}`;
  header.textContent = headerText;
  const body: HTMLPreElement = document.createElement("pre");
  body.className = "jsonl-tool-body";
  if (typeof bodyContent === "string") {
    body.textContent = bodyContent;
  } else {
    try {
      body.textContent = JSON.stringify(bodyContent, null, 2);
    } catch (e: unknown) {
      window.api.logWarn(
        `[viewers] JSON stringify failed: ${(e as Error).message}`,
      );
      body.textContent = String(bodyContent);
    }
  }
  // Auto-expand short content (5 lines or fewer)
  const lineCount: number = (body.textContent || "").split("\n").length;
  const expanded: boolean = startExpanded || lineCount <= 5;
  body.style.display = expanded ? "" : "none";
  header.classList.toggle("expanded", expanded);
  header.onclick = (): void => {
    const showing: boolean = body.style.display !== "none";
    body.style.display = showing ? "none" : "";
    header.classList.toggle("expanded", !showing);
  };
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

interface RenderedEntry {
  element: HTMLDivElement;
  /** "user" | "assistant" | "system" | "meta" */
  role: string;
}

export function renderJsonlEntry(
  entry: Record<string, unknown>,
): RenderedEntry | null {
  const ts = entry.timestamp;
  const timeStr: string = ts
    ? new Date(ts as string | number).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

  // --- custom-title ---
  if (entry.type === "custom-title") {
    const div: HTMLDivElement = document.createElement("div");
    div.className = "jsonl-entry jsonl-meta-entry";
    div.innerHTML =
      '<span class="jsonl-meta-icon">T</span> Title set: <strong>' +
      escapeHtml((entry.customTitle as string) || "") +
      "</strong>";
    return { element: div, role: "meta" };
  }

  // --- system entries ---
  if (entry.type === "system") {
    const div: HTMLDivElement = document.createElement("div");
    div.className = "jsonl-entry jsonl-meta-entry";
    if (entry.subtype === "turn_duration") {
      div.innerHTML =
        '<span class="jsonl-meta-icon">&#9201;</span> Turn duration: <strong>' +
        formatDuration(entry.durationMs as number) +
        "</strong>" +
        (timeStr ? ` <span class="jsonl-ts">${timeStr}</span>` : "");
    } else if (entry.subtype === "local_command") {
      const cmdMatch: RegExpMatchArray | null = (
        (entry.content as string) || ""
      ).match(/<command-name>(.*?)<\/command-name>/);
      const cmd: string = cmdMatch
        ? cmdMatch[1]
        : (entry.content as string) || "unknown";
      div.innerHTML =
        '<span class="jsonl-meta-icon">$</span> Command: <code class="jsonl-inline-code">' +
        escapeHtml(cmd) +
        "</code>" +
        (timeStr ? ` <span class="jsonl-ts">${timeStr}</span>` : "");
    } else {
      return null;
    }
    return { element: div, role: "meta" };
  }

  // --- progress entries ---
  if (entry.type === "progress") {
    // biome-ignore lint/suspicious/noExplicitAny: JSONL progress data has dynamic shape
    const data: any = entry.data;
    if (!data || typeof data !== "object") return null;
    const dt: string = data.type;
    if (dt === "bash_progress") {
      const div: HTMLDivElement = document.createElement("div");
      div.className = "jsonl-entry jsonl-meta-entry";
      const elapsed: string = data.elapsedTimeSeconds
        ? ` (${data.elapsedTimeSeconds}s, ${data.totalLines || 0} lines)`
        : "";
      div.innerHTML =
        '<span class="jsonl-meta-icon">&#9658;</span> Bash output' +
        escapeHtml(elapsed);
      if (data.output || data.fullOutput) {
        const output: string = data.fullOutput || data.output || "";
        div.appendChild(
          makeCollapsible("jsonl-tool-result", "Output", output, false),
        );
      }
      return { element: div, role: "meta" };
    }
    // Skip noisy progress types
    return null;
  }

  // --- user / assistant messages ---
  let role: string | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: JSONL content blocks have dynamic shapes
  let contentBlocks: any = null;

  if (
    entry.type === "user" ||
    (entry.type === "message" && entry.role === "user")
  ) {
    role = "user";
    // biome-ignore lint/suspicious/noExplicitAny: JSONL message structure is dynamic
    contentBlocks = (entry.message as any)?.content || entry.content;
  } else if (
    entry.type === "assistant" ||
    (entry.type === "message" && entry.role === "assistant")
  ) {
    role = "assistant";
    // biome-ignore lint/suspicious/noExplicitAny: JSONL message structure is dynamic
    contentBlocks = (entry.message as any)?.content || entry.content;
  } else {
    return null;
  }

  if (!contentBlocks) return null;
  if (typeof contentBlocks === "string") {
    contentBlocks = [{ type: "text", text: contentBlocks }];
  }
  if (!Array.isArray(contentBlocks)) return null;

  // If user message contains only tool_result blocks, render without user bubble styling
  const hasOnlyToolResults: boolean =
    role === "user" &&
    Array.isArray(contentBlocks) &&
    contentBlocks.every(
      // biome-ignore lint/suspicious/noExplicitAny: JSONL content blocks have dynamic shapes
      (b: any) => b.type === "tool_result",
    );

  const div: HTMLDivElement = document.createElement("div");
  div.className = hasOnlyToolResults
    ? "jsonl-entry jsonl-tool-results"
    : `jsonl-entry ${role === "user" ? "jsonl-user" : "jsonl-assistant"}`;

  const labelRow: HTMLDivElement = document.createElement("div");
  labelRow.className = "jsonl-role-label";
  labelRow.textContent = hasOnlyToolResults
    ? "System"
    : role === "user"
      ? "User"
      : "Assistant";
  if (timeStr) {
    const tsSpan: HTMLSpanElement = document.createElement("span");
    tsSpan.className = "jsonl-ts";
    tsSpan.textContent = timeStr;
    tsSpan.title = new Date(ts as string | number).toLocaleString();
    labelRow.appendChild(tsSpan);
  }
  div.appendChild(labelRow);

  for (const block of contentBlocks) {
    if (block.type === "thinking" && block.thinking) {
      div.appendChild(
        makeCollapsible("jsonl-thinking", "Thinking", block.thinking, false),
      );
    } else if (block.type === "text" && block.text) {
      const trimmed: string = (block.text as string).replace(/^\n+/, "");
      if (!trimmed) continue;
      // Skip system/command XML noise from Claude Code internal messages
      if (
        /^<(local-command-|command-name|command-message|command-args|local-command-stdout)/.test(
          trimmed,
        )
      )
        continue;
      const textEl: HTMLDivElement = document.createElement("div");
      textEl.className = "jsonl-text";
      textEl.innerHTML = renderJsonlText(trimmed);
      div.appendChild(textEl);
    } else if (block.type === "tool_use") {
      div.appendChild(
        makeCollapsible(
          "jsonl-tool-call",
          `Tool: ${block.name || "unknown"}`,
          typeof block.input === "string" ? block.input : block.input,
          false,
        ),
      );
    } else if (block.type === "tool_result") {
      const resultContent: unknown = block.content || block.output || "";
      div.appendChild(
        makeCollapsible(
          "jsonl-tool-result",
          "Tool Result" +
            (block.tool_use_id
              ? ` (${block.tool_use_id.slice(0, 12)}...)`
              : ""),
          resultContent,
          false,
        ),
      );
    }
  }

  // If only the label row remains (all content blocks were skipped), discard
  if (div.childNodes.length <= 1) return null;

  const effectiveRole: string = hasOnlyToolResults
    ? "system"
    : (role as string);
  return { element: div, role: effectiveRole };
}

export async function showJsonlViewer(session: SessionObj): Promise<void> {
  const result = await window.api.readSessionJsonl(session.sessionId);
  hideAllViewers();
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  jsonlViewer.style.display = "flex";

  const displayName: string =
    session.name || session.summary || session.sessionId;
  jsonlViewerTitle.textContent = displayName;
  jsonlViewerSessionId.textContent = session.sessionId;
  jsonlViewerBody.innerHTML = "";

  if (result.error) {
    jsonlViewerBody.innerHTML =
      '<div class="plans-empty">Error loading messages: ' +
      escapeHtml(result.error as string) +
      "</div>";
    return;
  }

  const entries: Record<string, unknown>[] =
    (result.entries as Record<string, unknown>[]) || [];
  let rendered: number = 0;
  let lastRole: string | null = null;
  let lastDiv: HTMLDivElement | null = null;
  for (const entry of entries) {
    const result2: RenderedEntry | null = renderJsonlEntry(entry);
    if (!result2) continue;
    const { element, role: entryRole } = result2;

    // Merge consecutive same-role messages (skip meta entries — they don't merge)
    if (entryRole !== "meta" && entryRole === lastRole && lastDiv) {
      // Append content children (skip the label row which is the first child)
      const children: Node[] = Array.from(element.childNodes).slice(1);
      for (const child of children) {
        lastDiv.appendChild(child);
      }
    } else {
      jsonlViewerBody.appendChild(element);
      lastDiv = entryRole !== "meta" ? element : null;
      lastRole = entryRole !== "meta" ? entryRole : null;
    }
    rendered++;
  }

  if (rendered === 0) {
    jsonlViewerBody.innerHTML =
      '<div class="plans-empty">No messages found in this session.</div>';
  }
}

// --- Stats ---
export async function loadStats(): Promise<void> {
  const stats = await window.api.getStats();
  statsViewerBody.innerHTML = "";
  if (!stats) {
    statsViewerBody.innerHTML =
      '<div class="plans-empty">No stats data found. Run some Claude sessions first.</div>';
    return;
  }
  // dailyActivity may be an array of {date, messageCount, ...} or an object
  const rawDaily = stats.dailyActivity || {};
  const dailyMap: Record<string, number> = {};
  if (Array.isArray(rawDaily)) {
    for (const entry of rawDaily) {
      dailyMap[entry.date] = entry.messageCount || 0;
    }
  } else {
    for (const [date, data] of Object.entries(rawDaily)) {
      // biome-ignore lint/suspicious/noExplicitAny: stats data shape is dynamic
      const d = data as any;
      dailyMap[date] =
        typeof d === "number"
          ? d
          : d?.messageCount || d?.messages || d?.count || 0;
    }
  }
  buildHeatmap(dailyMap);
  buildDailyBarChart(stats);
  buildStatsSummary(stats, dailyMap);

  const notice: HTMLDivElement = document.createElement("div");
  notice.className = "stats-notice";
  const lastDate: string = (stats.lastComputedDate as string) || "unknown";
  notice.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;flex-shrink:0"><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none"/></svg>Data sourced from Claude\u2019s stats cache (last updated ${escapeHtml(lastDate)}). Run <code>/stats</code> in a Claude session to refresh.`;
  statsViewerBody.appendChild(notice);
}

export function buildDailyBarChart(stats: Record<string, unknown>): void {
  const rawTokens = stats.dailyModelTokens || [];
  const rawActivity = stats.dailyActivity || [];

  // Build maps for last 30 days
  const tokenMap: Record<string, number> = {};
  if (Array.isArray(rawTokens)) {
    for (const entry of rawTokens) {
      let total: number = 0;
      for (const count of Object.values(entry.tokensByModel || {}))
        total += count as number;
      tokenMap[entry.date] = total;
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: activity entry shape is dynamic
  const activityMap: Record<string, any> = {};
  if (Array.isArray(rawActivity)) {
    for (const entry of rawActivity) activityMap[entry.date] = entry;
  }

  // Generate last 30 days
  const days: string[] = [];
  const today: Date = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d: Date = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const tokenValues: number[] = days.map((d) => tokenMap[d] || 0);
  const msgValues: number[] = days.map(
    (d) => activityMap[d]?.messageCount || 0,
  );
  const toolValues: number[] = days.map(
    (d) => activityMap[d]?.toolCallCount || 0,
  );
  const maxTokens: number = Math.max(...tokenValues, 1);
  const maxMsgs: number = Math.max(...msgValues, 1);

  const container: HTMLDivElement = document.createElement("div");
  container.className = "daily-chart-container";

  const title: HTMLDivElement = document.createElement("div");
  title.className = "daily-chart-title";
  title.textContent = "Last 30 days";
  container.appendChild(title);

  const chart: HTMLDivElement = document.createElement("div");
  chart.className = "daily-chart";

  for (let i = 0; i < days.length; i++) {
    const col: HTMLDivElement = document.createElement("div");
    col.className = "daily-chart-col";

    const bar: HTMLDivElement = document.createElement("div");
    bar.className = "daily-chart-bar";
    const pct: number = (tokenValues[i] / maxTokens) * 100;
    bar.style.height = `${Math.max(pct, tokenValues[i] > 0 ? 3 : 0)}%`;

    const msgPct: number = (msgValues[i] / maxMsgs) * 100;
    const msgBar: HTMLDivElement = document.createElement("div");
    msgBar.className = "daily-chart-bar-msgs";
    msgBar.style.height = `${Math.max(msgPct, msgValues[i] > 0 ? 3 : 0)}%`;

    const d: Date = new Date(days[i]);
    const dayLabel: string = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    let tokStr: string;
    if (tokenValues[i] >= 1e6) tokStr = `${(tokenValues[i] / 1e6).toFixed(1)}M`;
    else if (tokenValues[i] >= 1e3)
      tokStr = `${(tokenValues[i] / 1e3).toFixed(1)}K`;
    else tokStr = tokenValues[i].toString();
    col.title = `${dayLabel}\n${tokStr} tokens\n${msgValues[i]} messages\n${toolValues[i]} tool calls`;

    const label: HTMLDivElement = document.createElement("div");
    label.className = "daily-chart-label";
    label.textContent = d.getDate().toString();

    col.appendChild(bar);
    col.appendChild(msgBar);
    col.appendChild(label);
    chart.appendChild(col);
  }

  container.appendChild(chart);

  // Legend
  const legend: HTMLDivElement = document.createElement("div");
  legend.className = "daily-chart-legend";
  legend.innerHTML =
    '<span class="daily-chart-legend-dot tokens"></span> Tokens <span class="daily-chart-legend-dot msgs"></span> Messages';
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

export function buildHeatmap(counts: Record<string, number>): void {
  const container: HTMLDivElement = document.createElement("div");
  container.className = "heatmap-container";

  // Generate 52 weeks of dates ending today
  const today: Date = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek: number = today.getDay(); // 0=Sun
  const endDate: Date = new Date(today);
  const startDate: Date = new Date(today);
  startDate.setDate(startDate.getDate() - (52 * 7 + dayOfWeek));

  // Month labels
  const monthLabels: HTMLDivElement = document.createElement("div");
  monthLabels.className = "heatmap-month-labels";
  const months: string[] = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  let lastMonth: number = -1;
  const weekStarts: Date[] = [];
  const d: Date = new Date(startDate);
  while (d <= endDate) {
    if (d.getDay() === 0) {
      weekStarts.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  // Calculate month label positions
  const colWidth: number = 16; // 13px cell + 3px gap
  for (let w = 0; w < weekStarts.length; w++) {
    const m: number = weekStarts[w].getMonth();
    if (m !== lastMonth) {
      const label: HTMLSpanElement = document.createElement("span");
      label.className = "heatmap-month-label";
      label.textContent = months[m];
      label.style.position = "absolute";
      label.style.left = `${w * colWidth}px`;
      monthLabels.appendChild(label);
      lastMonth = m;
    }
  }
  monthLabels.style.position = "relative";
  monthLabels.style.height = "16px";
  container.appendChild(monthLabels);

  // Grid wrapper (day labels + grid)
  const wrapper: HTMLDivElement = document.createElement("div");
  wrapper.className = "heatmap-grid-wrapper";

  // Day labels
  const dayLabels: HTMLDivElement = document.createElement("div");
  dayLabels.className = "heatmap-day-labels";
  const dayNames: string[] = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (const name of dayNames) {
    const label: HTMLDivElement = document.createElement("div");
    label.className = "heatmap-day-label";
    label.textContent = name;
    dayLabels.appendChild(label);
  }
  wrapper.appendChild(dayLabels);

  // Quartile thresholds
  const nonZero: number[] = Object.values(counts)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const q1: number = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
  const q2: number = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
  const q3: number = nonZero[Math.floor(nonZero.length * 0.75)] || 3;

  // Grid
  const grid: HTMLDivElement = document.createElement("div");
  grid.className = "heatmap-grid";

  const cursor: Date = new Date(startDate);
  while (cursor <= endDate) {
    const dateStr: string = cursor.toISOString().slice(0, 10);
    const count: number = counts[dateStr] || 0;
    let level: number = 0;
    if (count > 0) {
      if (count <= q1) level = 1;
      else if (count <= q2) level = 2;
      else if (count <= q3) level = 3;
      else level = 4;
    }

    const cell: HTMLDivElement = document.createElement("div");
    cell.className = `heatmap-cell heatmap-level-${level}`;
    const displayDate: string = cursor.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    cell.title =
      count > 0
        ? `${displayDate}: ${count} messages`
        : `${displayDate}: No activity`;
    grid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
  }

  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  // Legend
  const legend: HTMLDivElement = document.createElement("div");
  legend.className = "heatmap-legend";
  const lessLabel: HTMLSpanElement = document.createElement("span");
  lessLabel.className = "heatmap-legend-label";
  lessLabel.textContent = "Less";
  legend.appendChild(lessLabel);
  for (let i = 0; i <= 4; i++) {
    const cell: HTMLDivElement = document.createElement("div");
    cell.className = `heatmap-legend-cell heatmap-level-${i}`;
    legend.appendChild(cell);
  }
  const moreLabel: HTMLSpanElement = document.createElement("span");
  moreLabel.className = "heatmap-legend-label";
  moreLabel.textContent = "More";
  legend.appendChild(moreLabel);
  container.appendChild(legend);

  statsViewerBody.appendChild(container);
}

export function calculateStreak(counts: Record<string, number>): {
  current: number;
  longest: number;
} {
  const today: Date = new Date();
  today.setHours(0, 0, 0, 0);

  let current: number = 0;
  let longest: number = 0;
  let streak: number = 0;

  const d: Date = new Date(today);
  let started: boolean = false;
  for (let i = 0; i < 365; i++) {
    const dateStr: string = d.toISOString().slice(0, 10);
    const count: number = counts[dateStr] || 0;
    if (count > 0) {
      streak++;
      started = true;
    } else {
      if (started) {
        if (!current) current = streak;
        if (streak > longest) longest = streak;
        streak = 0;
        started = false;
      }
    }
    d.setDate(d.getDate() - 1);
  }
  if (streak > longest) longest = streak;
  if (!current && streak > 0) current = streak;

  return { current, longest };
}

export function buildStatsSummary(
  stats: Record<string, unknown>,
  dailyMap: Record<string, number>,
): void {
  const summaryEl: HTMLDivElement = document.createElement("div");
  summaryEl.className = "stats-summary";

  const { current: currentStreak, longest: longestStreak } =
    calculateStreak(dailyMap);

  // Total messages from map
  let totalMessages: number = 0;
  for (const count of Object.values(dailyMap)) {
    totalMessages += count;
  }
  // Prefer stats.totalMessages if available and larger
  if (stats.totalMessages && (stats.totalMessages as number) > totalMessages) {
    totalMessages = stats.totalMessages as number;
  }

  const totalSessions: number =
    (stats.totalSessions as number) || Object.keys(dailyMap).length;

  // Model usage — values are objects with token counts, show as cards
  const models: Record<string, unknown> =
    (stats.modelUsage as Record<string, unknown>) || {};

  const cards: { value: string; label: string }[] = [
    { value: totalSessions.toLocaleString(), label: "Total Sessions" },
    { value: totalMessages.toLocaleString(), label: "Total Messages" },
    { value: `${currentStreak}d`, label: "Current Streak" },
    { value: `${longestStreak}d`, label: "Longest Streak" },
  ];

  for (const [model, usage] of Object.entries(models)) {
    const shortName: string = model
      .replace(/^claude-/, "")
      .replace(/-\d{8}$/, "");
    // biome-ignore lint/suspicious/noExplicitAny: model usage shape is dynamic
    const u = usage as any;
    const tokens: number = (u?.inputTokens || 0) + (u?.outputTokens || 0);
    const label: string = shortName;
    // Format token count in millions/thousands
    let valueStr: string;
    if (tokens >= 1e9) valueStr = `${(tokens / 1e9).toFixed(1)}B`;
    else if (tokens >= 1e6) valueStr = `${(tokens / 1e6).toFixed(1)}M`;
    else if (tokens >= 1e3) valueStr = `${(tokens / 1e3).toFixed(1)}K`;
    else valueStr = tokens.toLocaleString();
    cards.push({ value: valueStr, label: `${label} tokens` });
  }

  for (const card of cards) {
    const el: HTMLDivElement = document.createElement("div");
    el.className = "stat-card";
    el.innerHTML = `<span class="stat-card-value">${escapeHtml(card.value)}</span><span class="stat-card-label">${escapeHtml(card.label)}</span>`;
    summaryEl.appendChild(el);
  }

  statsViewerBody.appendChild(summaryEl);
}

// --- Memory ---
export async function loadMemories(): Promise<void> {
  setCachedMemories(await window.api.getMemories());
  renderMemories();
}

export function renderMemories(memoriesArg?: ProjectObj[]): void {
  const memories: ProjectObj[] = memoriesArg || cachedMemories;
  memoryContent.innerHTML = "";
  if (memories.length === 0) {
    const empty: HTMLDivElement = document.createElement("div");
    empty.className = "plans-empty";
    empty.textContent = "No memory files found.";
    memoryContent.appendChild(empty);
    return;
  }
  for (const mem of memories) {
    memoryContent.appendChild(buildMemoryItem(mem));
  }
}

export function buildMemoryItem(mem: ProjectObj): HTMLDivElement {
  const item: HTMLDivElement = document.createElement("div");
  item.className = "session-item memory-item";

  const row: HTMLDivElement = document.createElement("div");
  row.className = "session-row";

  const info: HTMLDivElement = document.createElement("div");
  info.className = "session-info";

  const titleEl: HTMLDivElement = document.createElement("div");
  titleEl.className = "session-summary";

  const badge: HTMLSpanElement = document.createElement("span");
  badge.className = `memory-type-badge type-${mem.type}`;
  badge.textContent = mem.type;
  titleEl.appendChild(badge);
  titleEl.appendChild(document.createTextNode(mem.label));

  const filenameEl: HTMLDivElement = document.createElement("div");
  filenameEl.className = "session-id";
  filenameEl.textContent = mem.filename;

  const metaEl: HTMLDivElement = document.createElement("div");
  metaEl.className = "session-meta";
  metaEl.textContent = formatDate(new Date(mem.modified));

  info.appendChild(titleEl);
  info.appendChild(filenameEl);
  info.appendChild(metaEl);
  row.appendChild(info);
  item.appendChild(row);

  item.addEventListener("click", () => void openMemory(mem));
  return item;
}

export async function openMemory(mem: ProjectObj): Promise<void> {
  // Mark active in sidebar
  for (const el of memoryContent.querySelectorAll(".memory-item.active")) {
    el.classList.remove("active");
  }
  for (const el of memoryContent.querySelectorAll(".memory-item")) {
    if (
      el.querySelector(".session-id")?.textContent === mem.filename &&
      el.querySelector(".session-summary")?.textContent?.includes(mem.label)
    ) {
      el.classList.add("active");
    }
  }

  const content: string = await window.api.readMemory(mem.filePath);

  // Show memory viewer in main area
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  settingsViewer.style.display = "none";
  memoryViewer.style.display = "flex";

  memoryViewerTitle.textContent = `${mem.label} — ${mem.filename}`;
  memoryViewerFilename.textContent = mem.filePath;
  memoryViewerBody.textContent = content;
}

// --- Settings viewer ---
export async function openSettingsViewer(
  scope: string,
  projectPath?: string,
  callbacks?: {
    loadProjects: () => Promise<void>;
    renderProjects: (projects: ProjectObj[], isSearch?: boolean) => void;
  },
): Promise<void> {
  const isProject: boolean = scope === "project";
  const settingsKey: string = isProject ? `project:${projectPath}` : "global";
  // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
  const current: any = (await window.api.getSetting(settingsKey)) || {};
  // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
  const globalSettings: any = isProject
    ? (await window.api.getSetting("global")) || {}
    : {};

  const shortName: string = isProject
    ? projectPath.split("/").filter(Boolean).slice(-2).join("/")
    : "Global";

  settingsViewerTitle.textContent =
    (isProject ? "Project Settings — " : "Global Settings — ") + shortName;

  // Show settings viewer
  placeholder.style.display = "none";
  terminalArea.style.display = "none";
  planViewer.style.display = "none";
  statsViewer.style.display = "none";
  memoryViewer.style.display = "none";
  settingsViewer.style.display = "flex";

  function useGlobalCheckbox(fieldName: string, _label?: string): string {
    if (!isProject) return "";
    const useGlobal: boolean =
      current[fieldName] === undefined || current[fieldName] === null;
    return `<label class="settings-use-global"><input type="checkbox" data-field="${fieldName}" class="use-global-cb" ${useGlobal ? "checked" : ""}> Use global default</label>`;
  }

  function fieldValue(fieldName: string, fallback: unknown): unknown {
    if (
      isProject &&
      (current[fieldName] === undefined || current[fieldName] === null)
    ) {
      return globalSettings[fieldName] !== undefined
        ? globalSettings[fieldName]
        : fallback;
    }
    return current[fieldName] !== undefined ? current[fieldName] : fallback;
  }

  function fieldDisabled(fieldName: string): string {
    if (!isProject) return "";
    return current[fieldName] === undefined || current[fieldName] === null
      ? "disabled"
      : "";
  }

  const permModeValue: unknown = fieldValue("permissionMode", "");
  const worktreeValue: unknown = fieldValue("worktree", false);
  const worktreeNameValue: unknown = fieldValue("worktreeName", "");
  const chromeValue: unknown = fieldValue("chrome", false);
  const preLaunchValue: unknown = fieldValue("preLaunchCmd", "");
  const addDirsValue: unknown = fieldValue("addDirs", "");
  const visCountValue: unknown = fieldValue("visibleSessionCount", 10);
  const maxAgeValue: unknown = fieldValue("sessionMaxAgeDays", 3);
  const themeValue: unknown = fieldValue("terminalTheme", "switchboard");

  settingsViewerBody.innerHTML = `
    <div class="settings-form">
      <div class="settings-section">
        <div class="settings-section-title">Claude CLI Options</div>
        <div class="settings-hint">These options are passed to the <code>claude</code> command when launching sessions.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Permission Mode</span>
            ${useGlobalCheckbox("permissionMode")}
          </div>
          <select class="settings-select" id="sv-perm-mode" ${fieldDisabled("permissionMode")}>
            <option value="">Default (none)</option>
            <option value="acceptEdits" ${permModeValue === "acceptEdits" ? "selected" : ""}>Accept Edits</option>
            <option value="plan" ${permModeValue === "plan" ? "selected" : ""}>Plan Mode</option>
            <option value="dontAsk" ${permModeValue === "dontAsk" ? "selected" : ""}>Don't Ask</option>
            <option value="bypassPermissions" ${permModeValue === "bypassPermissions" ? "selected" : ""}>Bypass</option>
          </select>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree</span>
            ${useGlobalCheckbox("worktree")}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-worktree" ${worktreeValue ? "checked" : ""} ${fieldDisabled("worktree")}>
            <label for="sv-worktree">Enable worktree for new sessions</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Worktree Name</span>
            ${useGlobalCheckbox("worktreeName")}
          </div>
          <input type="text" class="settings-input" id="sv-worktree-name" placeholder="auto" value="${escapeHtml(worktreeNameValue as string)}" ${fieldDisabled("worktreeName")}>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Chrome</span>
            ${useGlobalCheckbox("chrome")}
          </div>
          <div class="settings-checkbox-row">
            <input type="checkbox" id="sv-chrome" ${chromeValue ? "checked" : ""} ${fieldDisabled("chrome")}>
            <label for="sv-chrome">Enable Chrome browser automation</label>
          </div>
        </div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Additional Directories</span>
            ${useGlobalCheckbox("addDirs")}
          </div>
          <input type="text" class="settings-input" id="sv-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(addDirsValue as string)}" ${fieldDisabled("addDirs")}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Session Launch</div>
        <div class="settings-hint">Options that control how sessions are started.</div>

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Pre-launch Command</span>
            ${useGlobalCheckbox("preLaunchCmd")}
          </div>
          <div class="settings-hint">Prepended to the claude command (e.g. "aws-vault exec profile --" or "source .env &&")</div>
          <input type="text" class="settings-input" id="sv-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(preLaunchValue as string)}" ${fieldDisabled("preLaunchCmd")}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Application</div>
        <div class="settings-hint">Switchboard display and appearance settings.</div>

        ${
          !isProject
            ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Terminal Theme</span>
          </div>
          <select class="settings-select" id="sv-terminal-theme">
            ${Object.entries(TERMINAL_THEMES)
              .map(
                ([key, t]) =>
                  `<option value="${key}" ${themeValue === key ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
              )
              .join("")}
          </select>
        </div>`
            : ""
        }

        <div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Max Visible Sessions</span>
            ${useGlobalCheckbox("visibleSessionCount")}
          </div>
          <div class="settings-hint">Show up to this many sessions before collapsing the rest behind "+N older"</div>
          <input type="number" class="settings-input" id="sv-visible-count" min="1" max="100" value="${visCountValue}" ${fieldDisabled("visibleSessionCount")}>
        </div>

        ${
          !isProject
            ? `<div class="settings-field">
          <div class="settings-field-header">
            <span class="settings-label">Hide Sessions Older Than (days)</span>
          </div>
          <div class="settings-hint">Projects with no sessions newer than this are auto-collapsed</div>
          <input type="number" class="settings-input" id="sv-max-age" min="1" max="365" value="${maxAgeValue}">
        </div>`
            : ""
        }
      </div>

      <button class="settings-save-btn" id="sv-save-btn">Save Settings</button>
      ${isProject ? '<button class="settings-remove-btn" id="sv-remove-btn">Remove Project</button>' : ""}
    </div>
  `;

  // Use-global checkboxes toggle field disabled state
  for (const cb of settingsViewerBody.querySelectorAll(".use-global-cb")) {
    cb.addEventListener("change", () => {
      const field: string | undefined = (cb as HTMLElement).dataset.field;
      // Map field name to input element
      const fieldMap: Record<string, string> = {
        permissionMode: "sv-perm-mode",
        worktree: "sv-worktree",
        worktreeName: "sv-worktree-name",
        chrome: "sv-chrome",
        preLaunchCmd: "sv-pre-launch",
        addDirs: "sv-add-dirs",
        visibleSessionCount: "sv-visible-count",
      };
      const input: HTMLInputElement | null = settingsViewerBody.querySelector(
        `#${fieldMap[field]}`,
      );
      if (input) input.disabled = (cb as HTMLInputElement).checked;
    });
  }

  // Save button
  settingsViewerBody
    .querySelector("#sv-save-btn")
    .addEventListener("click", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
      const settings: any = {};

      if (isProject) {
        // Only save fields where "use global" is unchecked
        for (const cb of settingsViewerBody.querySelectorAll(
          ".use-global-cb",
        )) {
          if (!(cb as HTMLInputElement).checked) {
            const field: string | undefined = (cb as HTMLElement).dataset.field;
            const fieldMap: Record<string, () => unknown> = {
              permissionMode: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-perm-mode",
                  ) as HTMLSelectElement
                ).value || null,
              worktree: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-worktree",
                  ) as HTMLInputElement
                ).checked,
              worktreeName: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-worktree-name",
                  ) as HTMLInputElement
                ).value.trim(),
              chrome: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-chrome",
                  ) as HTMLInputElement
                ).checked,
              preLaunchCmd: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-pre-launch",
                  ) as HTMLInputElement
                ).value.trim(),
              addDirs: () =>
                (
                  settingsViewerBody.querySelector(
                    "#sv-add-dirs",
                  ) as HTMLInputElement
                ).value.trim(),
              visibleSessionCount: () =>
                parseInt(
                  (
                    settingsViewerBody.querySelector(
                      "#sv-visible-count",
                    ) as HTMLInputElement
                  ).value,
                  10,
                ) || 10,
            };
            if (field && fieldMap[field]) settings[field] = fieldMap[field]();
          }
        }
      } else {
        settings.permissionMode =
          (
            settingsViewerBody.querySelector(
              "#sv-perm-mode",
            ) as HTMLSelectElement
          ).value || null;
        settings.worktree = (
          settingsViewerBody.querySelector("#sv-worktree") as HTMLInputElement
        ).checked;
        settings.worktreeName = (
          settingsViewerBody.querySelector(
            "#sv-worktree-name",
          ) as HTMLInputElement
        ).value.trim();
        settings.chrome = (
          settingsViewerBody.querySelector("#sv-chrome") as HTMLInputElement
        ).checked;
        settings.preLaunchCmd = (
          settingsViewerBody.querySelector("#sv-pre-launch") as HTMLInputElement
        ).value.trim();
        settings.addDirs = (
          settingsViewerBody.querySelector("#sv-add-dirs") as HTMLInputElement
        ).value.trim();
        settings.visibleSessionCount =
          parseInt(
            (
              settingsViewerBody.querySelector(
                "#sv-visible-count",
              ) as HTMLInputElement
            ).value,
            10,
          ) || 10;
        settings.sessionMaxAgeDays =
          parseInt(
            (
              settingsViewerBody.querySelector(
                "#sv-max-age",
              ) as HTMLInputElement
            ).value,
            10,
          ) || 3;
        settings.terminalTheme =
          (
            settingsViewerBody.querySelector(
              "#sv-terminal-theme",
            ) as HTMLSelectElement
          ).value || "switchboard";
      }

      // Preserve windowBounds and sidebarWidth if they exist
      if (!isProject) {
        // biome-ignore lint/suspicious/noExplicitAny: settings shape is dynamic
        const existing: any = (await window.api.getSetting("global")) || {};
        if (existing.windowBounds)
          settings.windowBounds = existing.windowBounds;
        if (existing.sidebarWidth)
          settings.sidebarWidth = existing.sidebarWidth;
      }

      await window.api.setSetting(settingsKey, settings);

      // Update visibleSessionCount, sessionMaxAgeDays, and theme
      if (!isProject) {
        if (settings.visibleSessionCount)
          setVisibleSessionCount(settings.visibleSessionCount);
        if (settings.sessionMaxAgeDays)
          setSessionMaxAgeDays(settings.sessionMaxAgeDays);
        if (settings.terminalTheme) {
          setCurrentThemeName(settings.terminalTheme);
          // Apply to all open terminals
          for (const [, entry] of openSessions) {
            entry.terminal.options.theme = TERMINAL_THEME;
          }
        }
        if (callbacks?.renderProjects) {
          callbacks.renderProjects(
            showArchived ? cachedAllProjects : cachedProjects,
          );
        }
      }

      // Flash save confirmation
      const btn: Element | null =
        settingsViewerBody.querySelector("#sv-save-btn");
      btn.classList.add("saved");
      btn.textContent = "Saved!";
      setTimeout(() => {
        btn.classList.remove("saved");
        btn.textContent = "Save Settings";
      }, 1500);
    });

  // Remove project button
  const removeBtn: Element | null =
    settingsViewerBody.querySelector("#sv-remove-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (
        !confirm(
          `Remove project "${shortName}" from Switchboard?\n\nThis hides the project from the sidebar. Your session files are not deleted.`,
        )
      )
        return;
      await window.api.removeProject(projectPath);
      settingsViewer.style.display = "none";
      placeholder.style.display = "flex";
      if (callbacks?.loadProjects) {
        void callbacks.loadProjects();
      }
    });
  }
}
