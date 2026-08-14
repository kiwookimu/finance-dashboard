function localDateTimeParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function shiftIsoDate(date, offset) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function completedSessionCutoffDate({
  completionHour,
  completionMinute = 0,
  now = new Date(),
  timeZone,
}) {
  const local = localDateTimeParts(now, timeZone);
  const isComplete =
    local.hour > completionHour ||
    (local.hour === completionHour && local.minute >= completionMinute);
  return isComplete ? local.date : shiftIsoDate(local.date, -1);
}

function latestDateInMonthAtOrBefore(rows, month, cutoffDate) {
  return (rows || [])
    .filter(
      (row) =>
        typeof row?.date === "string" &&
        row.date.startsWith(month) &&
        row.date <= cutoffDate,
    )
    .map((row) => row.date)
    .sort()
    .at(-1) || "";
}

function exactDateIndex(rows, date) {
  return (rows || []).findIndex((row) => row?.date === date);
}

function rowsAtOrBefore(rows, cutoffDate) {
  return (rows || []).filter((row) => row?.date && row.date <= cutoffDate);
}

module.exports = {
  completedSessionCutoffDate,
  exactDateIndex,
  latestDateInMonthAtOrBefore,
  localDateTimeParts,
  rowsAtOrBefore,
  shiftIsoDate,
};
