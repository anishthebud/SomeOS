export type IcsEvent = {
  uid: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  recurrence?: string;
};

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

// 20260919T140000Z -> 2026-09-19T14:00:00Z, 20260919 -> 2026-09-19
function formatDate(value: string): { iso: string; allDay: boolean } {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return { iso: value.trim(), allDay: false };
  const [, y, mo, d, h, mi, s, z] = match;
  if (h === undefined) return { iso: `${y}-${mo}-${d}`, allDay: true };
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s || "00"}${z || ""}`, allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  // RFC 5545 line unfolding: a line starting with space/tab continues the previous one.
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: IcsEvent[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") {
      if (current?.DTSTART) {
        const start = formatDate(current.DTSTART);
        events.push({
          uid: current.UID || `${current.SUMMARY || "event"}-${start.iso}`,
          title: unescapeText(current.SUMMARY || "Untitled event"),
          start: start.iso,
          end: current.DTEND ? formatDate(current.DTEND).iso : undefined,
          allDay: start.allDay,
          location: current.LOCATION ? unescapeText(current.LOCATION) : undefined,
          description: current.DESCRIPTION ? unescapeText(current.DESCRIPTION) : undefined,
          recurrence: current.RRULE,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    if (!(name in current)) current[name] = line.slice(colon + 1);
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export function describeIcs(events: IcsEvent[]): string {
  return events
    .map((event) => {
      const when = event.end ? `${event.start} to ${event.end}` : event.start;
      return [
        `EVENT: ${event.title}`,
        `WHEN: ${when}${event.allDay ? " (all day)" : ""}`,
        event.recurrence ? `REPEATS: ${event.recurrence}` : "",
        event.location ? `WHERE: ${event.location}` : "",
        event.description ? `DETAILS: ${event.description}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}
