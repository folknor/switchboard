export function formatDate(date: Date): string {
  const formatNow: Date = new Date();
  const diff: number = formatNow.getTime() - date.getTime();
  const mins: number = Math.floor(diff / 60000);
  const hours: number = Math.floor(diff / 3600000);
  const days: number = Math.floor(diff / 86400000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function escapeHtml(str: string): string {
  const div: HTMLDivElement = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function cleanDisplayName(name: string): string {
  if (!name) return name;
  const prefix: string = "Implement the following plan:";
  if (name.startsWith(prefix)) return name.slice(prefix.length).trim();
  return name;
}

export function flashButtonText(
  btn: HTMLElement,
  text: string,
  duration: number = 1200,
): void {
  const original: string | null = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, duration);
}
