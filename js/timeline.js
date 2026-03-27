const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DEFAULT_WEEK_WIDTH = 40;
const DAY_THRESHOLD = 110; // switch to day-level columns when weekWidth >= this

let _weekWidth = DEFAULT_WEEK_WIDTH;

// --- Week width getters/setters ---
export function getWeekWidth() {
  return _weekWidth;
}

export function setWeekWidth(w) {
  _weekWidth = Math.max(20, Math.min(300, w));
}

export function resetWeekWidth() {
  _weekWidth = DEFAULT_WEEK_WIDTH;
}

export function getDefaultWeekWidth() {
  return DEFAULT_WEEK_WIDTH;
}

// --- Day mode detection ---
export function isDayMode() {
  return _weekWidth >= DAY_THRESHOLD;
}

// --- Calendar helpers ---

// How many days in a year
function daysInYear(year) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

// Day-of-year index (0-based) for a Date
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

// Date from day-of-year index (0-based)
function dateFromDayOfYear(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy);
  return d;
}

export function getWeekOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date - start;
  return Math.floor(diff / (7 * 86400000));
}

export function getTotalWeeks() {
  return 53;
}

// Total columns in current mode
export function getTotalColumns(year) {
  if (isDayMode()) return daysInYear(year);
  return 53;
}

// Width of a single column
export function getColumnWidth() {
  if (isDayMode()) return _weekWidth / 7;
  return _weekWidth;
}

// Convert week-based task position to pixel position
export function taskToPixels(startWeek, durationWeeks, year) {
  if (isDayMode()) {
    const dayWidth = _weekWidth / 7;
    const startDay = startWeek * 7;
    const durationDays = durationWeeks * 7;
    return {
      left: startDay * dayWidth,
      width: durationDays * dayWidth
    };
  }
  return {
    left: startWeek * _weekWidth,
    width: durationWeeks * _weekWidth
  };
}

// Convert pixel position to week (for drag snapping)
export function pixelsToWeeks(pixelX) {
  if (isDayMode()) {
    const dayWidth = _weekWidth / 7;
    const day = Math.round(pixelX / dayWidth);
    return day / 7; // fractional weeks
  }
  return Math.round(pixelX / _weekWidth);
}

// Today's column index
export function getTodayColumnIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  if (isDayMode()) return dayOfYear(now);
  return getWeekOfYear(now);
}

export function getTodayWeekIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return getWeekOfYear(now);
}

// Month map for week mode
export function getMonthWeekMap(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startWeek = getWeekOfYear(firstDay);
    const endWeek = getWeekOfYear(lastDay);
    months.push({
      name: MONTH_NAMES[m],
      month: m,
      startWeek,
      endWeek,
      weekCount: endWeek - startWeek + 1
    });
  }
  return months;
}

// Month map for day mode — each month spans its exact days
function getMonthDayMap(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startDoy = dayOfYear(firstDay);
    const endDoy = dayOfYear(lastDay);
    months.push({
      name: MONTH_NAMES[m],
      month: m,
      startDoy,
      endDoy,
      dayCount: endDoy - startDoy + 1
    });
  }
  return months;
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

function renderWeekModeHeader(container, year) {
  const weekWidth = _weekWidth;
  const months = getMonthWeekMap(year);
  const todayWeek = getTodayWeekIndex(year);

  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';

  for (const month of months) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = (month.weekCount * weekWidth) + 'px';
    monthCell.textContent = month.name;

    if (todayWeek >= 0 && todayWeek >= month.startWeek && todayWeek <= month.endWeek) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);

    let weekInMonth = 1;
    for (let w = month.startWeek; w <= month.endWeek; w++) {
      const weekCell = document.createElement('div');
      weekCell.className = 'timeline-week-cell';
      weekCell.style.width = weekWidth + 'px';
      weekCell.textContent = weekInMonth++;
      if (w === todayWeek) weekCell.classList.add('current-week');
      weekRow.appendChild(weekCell);
    }
  }

  container.appendChild(monthRow);
  container.appendChild(weekRow);
  document.documentElement.style.setProperty('--timeline-header-height', '52px');
}

function renderDayModeHeader(container, year) {
  const dayWidth = _weekWidth / 7;
  const months = getMonthDayMap(year);
  const today = new Date();
  const todayDoy = (today.getFullYear() === year) ? dayOfYear(today) : -1;
  const showDayName = dayWidth >= 22;

  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  const dayRow = document.createElement('div');
  dayRow.className = 'timeline-day-row';

  for (const month of months) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = (month.dayCount * dayWidth) + 'px';
    monthCell.textContent = month.name;

    if (todayDoy >= month.startDoy && todayDoy <= month.endDoy) {
      monthCell.classList.add('current-month');
    }
    monthRow.appendChild(monthCell);

    for (let doy = month.startDoy; doy <= month.endDoy; doy++) {
      const date = dateFromDayOfYear(year, doy);
      const dow = date.getDay(); // 0=Sun
      const dayCell = document.createElement('div');
      dayCell.className = 'timeline-day-cell';
      dayCell.style.width = dayWidth + 'px';

      const dayNum = date.getDate();
      if (showDayName) {
        dayCell.textContent = `${DAY_ABBR[dow]} ${dayNum}`;
      } else {
        dayCell.textContent = dayNum;
      }

      if (dow === 0 || dow === 6) dayCell.classList.add('weekend');
      if (doy === todayDoy) dayCell.classList.add('today');
      if (dow === 1) dayCell.classList.add('monday'); // week separator

      dayRow.appendChild(dayCell);
    }
  }

  container.appendChild(monthRow);
  container.appendChild(dayRow);
  document.documentElement.style.setProperty('--timeline-header-height', '46px');
}
