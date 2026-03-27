const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_ABBR = ['S','M','T','W','T','F','S'];

const DEFAULT_WEEK_WIDTH = 40;
const DAY_THRESHOLD = 110;

let _weekWidth = DEFAULT_WEEK_WIDTH;

// --- Zoom controls ---
export function getWeekWidth() { return _weekWidth; }
export function setWeekWidth(w) { _weekWidth = Math.max(20, Math.min(300, w)); }
export function resetWeekWidth() { _weekWidth = DEFAULT_WEEK_WIDTH; }
export function getDefaultWeekWidth() { return DEFAULT_WEEK_WIDTH; }
export function isDayMode() { return _weekWidth >= DAY_THRESHOLD; }

// -------------------------------------------------------
// COORDINATE SYSTEM — PERMANENT FIX
// -------------------------------------------------------
// dayWidth = weekWidth / 7
// totalWidth = 53 * weekWidth (always)
//
// Month headers: positioned by dayOfYear * dayWidth (day-accurate)
// Week grid: positioned by weekIndex * weekWidth
// Day grid: positioned by dayOfYear * dayWidth
// Tasks: left = startWeek * weekWidth, width = durationWeeks * weekWidth
// Today marker: dayOfYear * dayWidth
//
// Month header total = daysInYear * dayWidth + spacer to fill 53*weekWidth
// This ensures months NEVER overlap and are pixel-perfect with days.
// -------------------------------------------------------

export function getDayWidth() { return _weekWidth / 7; }

const TOTAL_WEEKS = 53;
export function getTotalWeeks() { return TOTAL_WEEKS; }
export function getTotalWidth() { return TOTAL_WEEKS * _weekWidth; }

export function taskToPixels(startWeek, durationWeeks) {
  return {
    left: startWeek * _weekWidth,
    width: durationWeeks * _weekWidth
  };
}

// --- Calendar helpers ---
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
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / (7 * 86400000));
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

// --- Month info (day-based, always accurate) ---
function getMonths(year) {
  const todayDoy = (new Date().getFullYear() === year) ? dayOfYear(new Date()) : -1;
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startDoy = dayOfYear(firstDay);
    months.push({
      name: MONTH_NAMES[m],
      startDoy,
      dayCount: lastDay.getDate(),
      isCurrent: todayDoy >= startDoy && todayDoy < startDoy + lastDay.getDate()
    });
  }
  return months;
}

// --- Header rendering ---
export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  const dw = getDayWidth();
  const totalWidth = getTotalWidth();
  const months = getMonths(year);

  // Month row — ALWAYS uses dayCount * dayWidth (pixel-perfect)
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';
  monthRow.style.width = totalWidth + 'px';

  let monthPxUsed = 0;
  for (const m of months) {
    const w = m.dayCount * dw;
    const cell = document.createElement('div');
    cell.className = 'timeline-month-cell';
    cell.style.width = w + 'px';
    cell.textContent = m.name;
    if (m.isCurrent) cell.classList.add('current-month');
    monthRow.appendChild(cell);
    monthPxUsed += w;
  }
  // Spacer for remaining pixels (53*7=371 vs 365/366 days)
  if (totalWidth - monthPxUsed > 0.5) {
    const spacer = document.createElement('div');
    spacer.className = 'timeline-month-cell';
    spacer.style.width = (totalWidth - monthPxUsed) + 'px';
    monthRow.appendChild(spacer);
  }

  container.appendChild(monthRow);

  if (isDayMode()) {
    renderDayRow(container, year, months, dw, totalWidth);
    document.documentElement.style.setProperty('--timeline-header-height', '46px');
  } else {
    renderWeekRow(container, year, months, dw, totalWidth);
    document.documentElement.style.setProperty('--timeline-header-height', '52px');
  }
}

// Week row: one cell per week, positioned by absolute week index
function renderWeekRow(container, year, months, dw, totalWidth) {
  const ww = _weekWidth;
  const todayWeek = getTodayWeekIndex(year);

  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';
  weekRow.style.width = totalWidth + 'px';

  // For each week, determine which month it primarily belongs to
  // and show week-in-month number
  for (let w = 0; w < TOTAL_WEEKS; w++) {
    const weekMidDay = w * 7 + 3; // middle of the week
    // Find which month this day falls in
    let weekInMonth = 1;
    for (const m of months) {
      if (weekMidDay >= m.startDoy && weekMidDay < m.startDoy + m.dayCount) {
        weekInMonth = Math.floor((weekMidDay - m.startDoy) / 7) + 1;
        break;
      }
    }

    const cell = document.createElement('div');
    cell.className = 'timeline-week-cell';
    cell.style.width = ww + 'px';
    cell.textContent = weekInMonth;
    if (w === todayWeek) cell.classList.add('current-week');
    weekRow.appendChild(cell);
  }

  container.appendChild(weekRow);
}

// Day row: one cell per day
function renderDayRow(container, year, months, dw, totalWidth) {
  const totalDays = daysInYear(year);
  const todayDoy = (new Date().getFullYear() === year) ? dayOfYear(new Date()) : -1;
  const showName = dw >= 22;

  const dayRow = document.createElement('div');
  dayRow.className = 'timeline-day-row';
  dayRow.style.width = totalWidth + 'px';

  for (let doy = 0; doy < totalDays; doy++) {
    const date = dateFromDoy(year, doy);
    const dow = date.getDay();
    const cell = document.createElement('div');
    cell.className = 'timeline-day-cell';
    cell.style.width = dw + 'px';

    const dayNum = date.getDate();
    cell.textContent = showName ? `${DAY_ABBR[dow]}${dayNum}` : dayNum;

    if (dow === 0 || dow === 6) cell.classList.add('weekend');
    if (doy === todayDoy) cell.classList.add('today');
    if (dow === 1) cell.classList.add('monday');
    dayRow.appendChild(cell);
  }

  // Spacer for remaining
  const usedPx = totalDays * dw;
  if (totalWidth - usedPx > 0.5) {
    const spacer = document.createElement('div');
    spacer.style.width = (totalWidth - usedPx) + 'px';
    dayRow.appendChild(spacer);
  }

  container.appendChild(dayRow);
}
