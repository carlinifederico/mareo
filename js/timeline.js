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
// COORDINATE SYSTEM
// -------------------------------------------------------
// Everything is positioned in "week-space":
//   position_px = weekIndex * weekWidth     (week mode)
//   position_px = weekIndex * weekWidth     (day mode too — same base!)
//
// dayWidth = weekWidth / 7
// Total width = 53 * weekWidth (always, both modes)
//
// Tasks: left = startWeek * weekWidth
//        width = durationWeeks * weekWidth
//
// Today marker: todayWeek * weekWidth + dayInWeek * dayWidth
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

// Today position in pixels (precise to the day)
export function getTodayPixelX(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  const doy = dayOfYear(now);
  return (doy + 0.5) * getDayWidth();
}

// --- Header rendering ---
export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  if (isDayMode()) {
    renderDayModeHeader(container, year);
  } else {
    renderWeekModeHeader(container, year);
  }
}

// WEEK MODE: Month row + Week row
// Both use week-based absolute positioning
function renderWeekModeHeader(container, year) {
  const ww = _weekWidth;
  const totalWidth = TOTAL_WEEKS * ww;
  const todayWeek = getTodayWeekIndex(year);

  // Build month boundaries in week-space
  const monthBounds = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startWeek = getWeekOfYear(firstDay);
    const endWeek = getWeekOfYear(lastDay);
    monthBounds.push({ name: MONTH_NAMES[m], startWeek, endWeek });
  }

  // Month row
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';
  monthRow.style.width = totalWidth + 'px';

  for (const mb of monthBounds) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    const w = (mb.endWeek - mb.startWeek + 1) * ww;
    monthCell.style.width = w + 'px';
    monthCell.textContent = mb.name;
    if (todayWeek >= mb.startWeek && todayWeek <= mb.endWeek) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);
  }

  // Week row — one cell per absolute week
  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';
  weekRow.style.width = totalWidth + 'px';

  let currentMonth = 0;
  let weekInMonth = 1;
  for (let w = 0; w < TOTAL_WEEKS; w++) {
    if (currentMonth < 11 && w > monthBounds[currentMonth].endWeek) {
      currentMonth++;
      weekInMonth = 1;
    }
    const weekCell = document.createElement('div');
    weekCell.className = 'timeline-week-cell';
    weekCell.style.width = ww + 'px';
    weekCell.textContent = weekInMonth++;
    if (w === todayWeek) weekCell.classList.add('current-week');
    weekRow.appendChild(weekCell);
  }

  container.appendChild(monthRow);
  container.appendChild(weekRow);
  document.documentElement.style.setProperty('--timeline-header-height', '52px');
}

// DAY MODE: Month row + Day row
// Days are positioned absolutely within week-space
function renderDayModeHeader(container, year) {
  const dw = getDayWidth();
  const totalWidth = TOTAL_WEEKS * _weekWidth;
  const totalDays = daysInYear(year);
  const todayDoy = (new Date().getFullYear() === year) ? dayOfYear(new Date()) : -1;
  const showName = dw >= 22;

  // Month bounds in day-space
  const monthBounds = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    monthBounds.push({
      name: MONTH_NAMES[m],
      startDoy: dayOfYear(firstDay),
      endDoy: dayOfYear(lastDay),
      dayCount: lastDay.getDate()
    });
  }

  // Month row — positioned by day*dw
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';
  monthRow.style.width = totalWidth + 'px';

  for (const mb of monthBounds) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = (mb.dayCount * dw) + 'px';
    monthCell.textContent = mb.name;
    if (todayDoy >= mb.startDoy && todayDoy <= mb.endDoy) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);
  }
  // Pad remaining pixels (53*7=371 days vs 365/366 actual)
  const pad = totalWidth - totalDays * dw;
  if (pad > 0) {
    const spacer = document.createElement('div');
    spacer.className = 'timeline-month-cell';
    spacer.style.width = pad + 'px';
    monthRow.appendChild(spacer);
  }

  // Day row
  const dayRow = document.createElement('div');
  dayRow.className = 'timeline-day-row';
  dayRow.style.width = totalWidth + 'px';

  for (let doy = 0; doy < totalDays; doy++) {
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
  // Pad remaining
  if (pad > 0) {
    const spacer = document.createElement('div');
    spacer.style.width = pad + 'px';
    dayRow.appendChild(spacer);
  }

  container.appendChild(monthRow);
  container.appendChild(dayRow);
  document.documentElement.style.setProperty('--timeline-header-height', '46px');
}
