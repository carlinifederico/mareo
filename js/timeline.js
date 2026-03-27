const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_ABBR = ['S','M','T','W','T','F','S'];

const DEFAULT_WEEK_WIDTH = 40;
const DAY_THRESHOLD = 110;

let _weekWidth = DEFAULT_WEEK_WIDTH;

// --- Week width (controls zoom level) ---
export function getWeekWidth() { return _weekWidth; }
export function setWeekWidth(w) { _weekWidth = Math.max(20, Math.min(300, w)); }
export function resetWeekWidth() { _weekWidth = DEFAULT_WEEK_WIDTH; }
export function getDefaultWeekWidth() { return DEFAULT_WEEK_WIDTH; }
export function isDayMode() { return _weekWidth >= DAY_THRESHOLD; }

// --- Core unit: the day ---
// Everything is based on days. dayWidth = weekWidth / 7.
// Total width = daysInYear * dayWidth (ALWAYS, both modes).

export function getDayWidth() {
  return _weekWidth / 7;
}

function daysInYear(year) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

export function getTotalDays(year) {
  return daysInYear(year);
}

export function getTotalWidth(year) {
  return daysInYear(year) * getDayWidth();
}

// Day-of-year index (0-based)
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

function dateFromDoy(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy);
  return d;
}

// --- Task positioning (always day-based) ---
// Tasks are stored as startWeek (0-52) and durationWeeks.
// Convert to pixel positions using: day = week * 7, px = day * dayWidth.

export function taskToPixels(startWeek, durationWeeks) {
  const dw = getDayWidth();
  return {
    left: startWeek * 7 * dw,
    width: durationWeeks * 7 * dw
  };
}

// --- Week helpers (for storage) ---
export function getWeekOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / (7 * 86400000));
}

export function getTodayWeekIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return getWeekOfYear(now);
}

export function getTodayDayIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return dayOfYear(now);
}

// --- Month info ---
function getMonthDayMap(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    months.push({
      name: MONTH_NAMES[m],
      month: m,
      startDoy: dayOfYear(firstDay),
      endDoy: dayOfYear(lastDay),
      dayCount: lastDay.getDate()
    });
  }
  return months;
}

// --- Header rendering ---

export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  const dayMode = isDayMode();

  if (dayMode) {
    renderDayModeHeader(container, year);
  } else {
    renderWeekModeHeader(container, year);
  }
}

// WEEK MODE: Month row + Week row
// Each month's width = its dayCount * dayWidth (exact calendar)
// Weeks are visual subdivisions: 4 per month, each = dayCount/4 * dayWidth
function renderWeekModeHeader(container, year) {
  const dw = getDayWidth();
  const months = getMonthDayMap(year);
  const todayDoy = getTodayDayIndex(year);

  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';

  for (const month of months) {
    const monthWidth = month.dayCount * dw;

    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = monthWidth + 'px';
    monthCell.textContent = month.name;

    if (todayDoy >= month.startDoy && todayDoy <= month.endDoy) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);

    // 4 week columns per month
    const weeksInMonth = 4;
    const baseDays = Math.floor(month.dayCount / weeksInMonth);
    let remainder = month.dayCount - baseDays * weeksInMonth;
    let dayOffset = month.startDoy;

    for (let w = 0; w < weeksInMonth; w++) {
      const wDays = baseDays + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      const weekCell = document.createElement('div');
      weekCell.className = 'timeline-week-cell';
      weekCell.style.width = (wDays * dw) + 'px';
      weekCell.textContent = w + 1;

      // Highlight if today falls in this week slice
      if (todayDoy >= dayOffset && todayDoy < dayOffset + wDays) {
        weekCell.classList.add('current-week');
      }

      weekRow.appendChild(weekCell);
      dayOffset += wDays;
    }
  }

  container.appendChild(monthRow);
  container.appendChild(weekRow);
  document.documentElement.style.setProperty('--timeline-header-height', '52px');
}

// DAY MODE: Month row + Day row
function renderDayModeHeader(container, year) {
  const dw = getDayWidth();
  const months = getMonthDayMap(year);
  const todayDoy = getTodayDayIndex(year);
  const showName = dw >= 22;

  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  const dayRow = document.createElement('div');
  dayRow.className = 'timeline-day-row';

  for (const month of months) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = (month.dayCount * dw) + 'px';
    monthCell.textContent = month.name;
    if (todayDoy >= month.startDoy && todayDoy <= month.endDoy) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);

    for (let doy = month.startDoy; doy <= month.endDoy; doy++) {
      const date = dateFromDoy(year, doy);
      const dow = date.getDay();
      const dayCell = document.createElement('div');
      dayCell.className = 'timeline-day-cell';
      dayCell.style.width = dw + 'px';

      const dayNum = date.getDate();
      dayCell.textContent = showName ? `${DAY_ABBR[dow]}${dayNum}` : dayNum;

      if (dow === 0 || dow === 6) dayCell.classList.add('weekend');
      if (doy === todayDoy) dayCell.classList.add('today');
      if (dow === 1) dayCell.classList.add('monday');

      dayRow.appendChild(dayCell);
    }
  }

  container.appendChild(monthRow);
  container.appendChild(dayRow);
  document.documentElement.style.setProperty('--timeline-header-height', '46px');
}
