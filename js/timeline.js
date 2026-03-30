const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_ABBR = ['S','M','T','W','T','F','S'];

const DEFAULT_WEEK_WIDTH = 40;
const DAY_THRESHOLD = 110;

let _weekWidth = DEFAULT_WEEK_WIDTH;

export function getWeekWidth() { return _weekWidth; }
export function setWeekWidth(w) { _weekWidth = Math.max(20, Math.min(300, w)); }
export function resetWeekWidth() { _weekWidth = DEFAULT_WEEK_WIDTH; }
export function getDefaultWeekWidth() { return DEFAULT_WEEK_WIDTH; }
export function isDayMode() { return _weekWidth >= DAY_THRESHOLD; }
export function getDayWidth() { return _weekWidth / 7; }

// -------------------------------------------------------
// SINGLE COORDINATE SYSTEM: day-of-year
// -------------------------------------------------------
// px(day) = day * dayWidth            — position of a day
// px(week) = week * 7 * dayWidth      — position of a week (= week * weekWidth)
// totalWidth = 53 * weekWidth = 371 * dayWidth
//
// Everything — months, weeks, days, tasks, today marker,
// grid lines — uses px(day) or px(week). No flex accumulation.
// All header cells use ABSOLUTE positioning to avoid rounding drift.
// -------------------------------------------------------

const TOTAL_WEEKS = 53;
export function getTotalWeeks() { return TOTAL_WEEKS; }
export function getTotalWidth() { return TOTAL_WEEKS * _weekWidth; }

// Task position: day-based
export function taskToPixels(startDay, durationDays) {
  const dw = getDayWidth();
  return {
    left: startDay * dw,
    width: durationDays * dw
  };
}

// Display position: snaps to week boundaries when zoomed out
export function taskToDisplayPixels(startDay, durationDays) {
  if (isDayMode()) {
    return taskToPixels(startDay, durationDays);
  }
  // Snap to week boundaries
  const ww = _weekWidth;
  const startWeek = Math.floor(startDay / 7);
  const endWeek = Math.floor((startDay + durationDays - 1) / 7);
  return {
    left: startWeek * ww,
    width: (endWeek - startWeek + 1) * ww
  };
}

// Calendar helpers
function daysInYear(year) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

function dateFromDoy(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy);
  return d;
}

export function getWeekOfYear(date) {
  return Math.floor(dayOfYear(date) / 7);
}

export function getTodayWeekIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return getWeekOfYear(now);
}

export function getTodayPixelX(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return (dayOfYear(now) + 0.5) * getDayWidth();
}

// Month boundaries in day-of-year
function getMonths(year) {
  const todayDoy = (new Date().getFullYear() === year) ? dayOfYear(new Date()) : -1;
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startDoy = dayOfYear(firstDay);
    const dc = lastDay.getDate();
    months.push({
      name: MONTH_NAMES[m],
      startDoy,
      dayCount: dc,
      isCurrent: todayDoy >= startDoy && todayDoy < startDoy + dc
    });
  }
  return months;
}

// -------------------------------------------------------
// HEADER RENDERING — all cells absolutely positioned
// -------------------------------------------------------

export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  const dw = getDayWidth();
  const totalWidth = getTotalWidth();
  const months = getMonths(year);

  // --- Month row (absolute positioning) ---
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';
  monthRow.style.width = totalWidth + 'px';
  monthRow.style.position = 'relative';

  for (const m of months) {
    const left = m.startDoy * dw;
    const w = m.dayCount * dw;
    const cell = document.createElement('div');
    cell.className = 'timeline-month-cell';
    cell.style.position = 'absolute';
    cell.style.left = left + 'px';
    cell.style.width = w + 'px';
    cell.textContent = m.name;
    if (m.isCurrent) cell.classList.add('current-month');
    monthRow.appendChild(cell);
  }
  container.appendChild(monthRow);

  if (isDayMode()) {
    renderDayRow(container, year, months, dw, totalWidth);
    document.documentElement.style.setProperty('--timeline-header-height', '46px');
  } else {
    renderWeekRow(container, year, dw, totalWidth);
    document.documentElement.style.setProperty('--timeline-header-height', '52px');
  }
}

// --- Week row: absolute positioned cells at week * weekWidth ---
function renderWeekRow(container, year, dw, totalWidth) {
  const ww = _weekWidth;
  const todayWeek = getTodayWeekIndex(year);
  const months = getMonths(year);

  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';
  weekRow.style.width = totalWidth + 'px';
  weekRow.style.position = 'relative';

  for (let w = 0; w < TOTAL_WEEKS; w++) {
    const left = w * ww;
    const midDay = w * 7 + 3;

    // Week-in-month label
    let label = '';
    for (const m of months) {
      if (midDay >= m.startDoy && midDay < m.startDoy + m.dayCount) {
        label = Math.floor((midDay - m.startDoy) / 7) + 1;
        break;
      }
    }

    const cell = document.createElement('div');
    cell.className = 'timeline-week-cell';
    cell.style.position = 'absolute';
    cell.style.left = left + 'px';
    cell.style.width = ww + 'px';
    cell.textContent = label;
    if (w === todayWeek) cell.classList.add('current-week');
    weekRow.appendChild(cell);
  }

  container.appendChild(weekRow);
}

// --- Day row: absolute positioned cells at doy * dayWidth ---
function renderDayRow(container, year, months, dw, totalWidth) {
  const numDays = daysInYear(year);
  const todayDoy = (new Date().getFullYear() === year) ? dayOfYear(new Date()) : -1;
  const showName = dw >= 22;

  const dayRow = document.createElement('div');
  dayRow.className = 'timeline-day-row';
  dayRow.style.width = totalWidth + 'px';
  dayRow.style.position = 'relative';

  for (let doy = 0; doy < numDays; doy++) {
    const date = dateFromDoy(year, doy);
    const dow = date.getDay();
    const left = doy * dw;

    const cell = document.createElement('div');
    cell.className = 'timeline-day-cell';
    cell.style.position = 'absolute';
    cell.style.left = left + 'px';
    cell.style.width = dw + 'px';

    const dayNum = date.getDate();
    cell.textContent = showName ? `${DAY_ABBR[dow]}${dayNum}` : dayNum;

    if (dow === 0 || dow === 6) cell.classList.add('weekend');
    if (doy === todayDoy) cell.classList.add('today');
    if (dow === 1) cell.classList.add('monday');
    dayRow.appendChild(cell);
  }

  container.appendChild(dayRow);
}
