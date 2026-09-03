#!/usr/bin/env node
// ist.mjs — India Standard Time (UTC+5:30) DeepSeek peak/off-peak windows.
//
// DeepSeek weekday peak windows (published, converted to IST):
//   06:30-09:30 IST
//   11:30-15:30 IST
// Monday-Friday. Outside these windows direct DeepSeek is "off-peak".
//
// Clock is injectable (defaults to the real system clock) so tests can simulate
// both windows without waiting for real time.
export const PEAK_WINDOWS_IST = [
  { start: { h: 6, m: 30 }, end: { h: 9, m: 30 } },
  { start: { h: 11, m: 30 }, end: { h: 15, m: 30 } },
]
export const IST_OFFSET_MIN = 5 * 60 + 30 // +05:30

function nowUTC(clock = Date) {
  const n = typeof clock === "number" ? clock : clock.now()
  return new Date(n)
}

export function toIST(d) {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60 * 1000)
}

export function isWeekday(d) {
  const day = d.getUTCDay() // weekday computed on UTC then adjusted via IST
  const ist = toIST(d)
  const istDay = ist.getUTCDay()
  return istDay >= 1 && istDay <= 5
}

function minutes(t) {
  return t.h * 60 + t.m
}

// Returns true when the instant is inside a DeepSeek peak window in IST.
export function inPeakWindow(d) {
  const ist = toIST(d)
  if (!(ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5)) return false // weekends off-peak
  const cur = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return PEAK_WINDOWS_IST.some((w) => cur >= minutes(w.start) && cur < minutes(w.end))
}

// Return a human-readable IST timestamp for messaging.
export function istLabel(d) {
  return toIST(d).toISOString().replace("T", " ").slice(0, 16) + " IST"
}

export function describe(d) {
  return {
    ist: istLabel(d),
    weekday: isWeekday(d),
    peak: inPeakWindow(d),
    window: inPeakWindow(d) ? "PEAK (direct DeepSeek batch refused)" : "OFF-PEAK (direct DeepSeek batch allowed)",
  }
}
