const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_NAMES = ['S','M','T','W','T','F','S'];

const DEFAULT_WEEK_WIDTH = 40;
const DAY_THRESHOLD = 120; // show days when week width >= this

let _weekWidth = DEFAULT_WEEK_WIDTH;

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

export function getTotalWeeks() {
  return 53;
}

export function getMonthWeekMap(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startWeek = getWeekOfYear(firstDay);
    const endWeek = getWeekOfYear(lastDay);
    months.push({
      name: MONTH_NAMES[m],
      startWeek,
      endWeek,
      weekCount: endWeek - startWeek + 1
    });
  }
  return months;
}

export function getWeekOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date - start;
  return Math.floor(diff / (7 * 86400000));
}

export function getTodayWeekIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return getWeekOfYear(now);
}

// Get the start date (Sunday) of a given week index in a year
function getWeekStartDate(year, weekIndex) {
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = jan1.getDay();
  const startDate = new Date(year, 0, 1 + weekIndex * 7 - dayOfWeek);
  return startDate;
}

export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  const weekWidth = _weekWidth;
  const months = getMonthWeekMap(year);
  const todayWeek = getTodayWeekIndex(year);
  const showDays = weekWidth >= DAY_THRESHOLD;

  // Month row
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  // Week row
  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';

  // Day row (only when zoomed in)
  let dayRow = null;
  if (showDays) {
    dayRow = document.createElement('div');
    dayRow.className = 'timeline-day-row';
  }

  const today = new Date();
  const todayDateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

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

      if (w === todayWeek) {
        weekCell.classList.add('current-week');
      }

      weekRow.appendChild(weekCell);

      // Day cells
      if (showDays) {
        const weekStart = getWeekStartDate(year, w);
        const dayWidth = weekWidth / 7;
        for (let d = 0; d < 7; d++) {
          const dayDate = new Date(weekStart);
          dayDate.setDate(weekStart.getDate() + d);
          const dayCell = document.createElement('div');
          dayCell.className = 'timeline-day-cell';
          dayCell.style.width = dayWidth + 'px';

          const dayNum = dayDate.getDate();
          const dayName = DAY_NAMES[d];
          dayCell.textContent = weekWidth >= 200 ? `${dayName} ${dayNum}` : dayNum;

          if (d === 0 || d === 6) dayCell.classList.add('weekend');

          const dayStr = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
          if (dayStr === todayDateStr) dayCell.classList.add('today');

          dayRow.appendChild(dayCell);
        }
      }
    }
  }

  container.appendChild(monthRow);
  container.appendChild(weekRow);
  if (dayRow) container.appendChild(dayRow);

  // Update CSS variable for header height
  const headerHeight = showDays ? 72 : 52;
  document.documentElement.style.setProperty('--timeline-header-height', headerHeight + 'px');
}
