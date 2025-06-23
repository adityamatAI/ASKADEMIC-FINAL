// frontend/src/utils/scheduler.js

// --- DATA PARSING & STRUCTURING ---

// Helper to parse time strings like "10:00 AM" into a float (e.g., 10.0)
const parseTime = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (modifier === 'PM' && hours < 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
    return hours + (minutes || 0) / 60;
};

// Represents a single class meeting time (e.g., Monday 10:00-11:30)
class Timeslot {
    constructor(day, startTimeStr, endTimeStr) {
        this.day = day;
        this.startTime = parseTime(startTimeStr);
        this.endTime = parseTime(endTimeStr);
    }
}

// Represents a section of a course (e.g., CS101-01), which may have multiple timeslots
class Section {
    constructor(courseCode, sectionId, timeslots) {
        this.courseCode = courseCode;
        this.sectionId = sectionId;
        this.timeslots = timeslots; // Array of Timeslot objects
    }

    conflictsWith(otherSection) {
        for (const t1 of this.timeslots) {
            for (const t2 of otherSection.timeslots) {
                // Check for same day and time overlap
                if (t1.day === t2.day && t1.endTime > t2.startTime && t2.endTime > t1.startTime) {
                    return true;
                }
            }
        }
        return false;
    }
}

// --- CORE GENERATION LOGIC ---

// JS equivalent of itertools.product
function product(...arrays) {
    return arrays.reduce((acc, array) =>
        acc.flatMap(x => array.map(y => [...x, y])),
        [[]]
    );
}

export function generateSchedules(allCoursesData, selectedCourseCodes) {
    // 1. Group raw data into Section objects
    const courses = {};
    for (const code of selectedCourseCodes) {
        courses[code] = [];
    }

    const sectionsData = {};
    allCoursesData.forEach(row => {
        const baseCode = (row.Course.match(/^[A-Za-z]+\d+/) || [null])[0];
        if (selectedCourseCodes.includes(baseCode)) {
            const sectionId = row.Course;
            if (!sectionsData[sectionId]) {
                sectionsData[sectionId] = { courseCode: baseCode, timeslotsRaw: [] };
            }
            // A session can have multiple days, e.g., "M,W,F"
            const days = row.Days.split(',').map(d => d.trim()).filter(d => d);
            days.forEach(day => {
                sectionsData[sectionId].timeslotsRaw.push({
                    day: day.charAt(0).toUpperCase(), // M, T, W, R, F
                    start: row['Start Time'],
                    end: row['End Time'],
                });
            });
        }
    });

    for (const sectionId in sectionsData) {
        const data = sectionsData[sectionId];
        const timeslots = data.timeslotsRaw.map(t => new Timeslot(t.day, t.start, t.end));
        const section = new Section(data.courseCode, sectionId, timeslots);
        courses[data.courseCode].push(section);
    }
    
    // 2. Generate all combinations of sections
    const sectionGroups = Object.values(courses).filter(group => group.length > 0);
    if (sectionGroups.length !== selectedCourseCodes.length) {
        console.warn("Some selected courses have no available sections.");
        return [];
    }
    const combinations = product(...sectionGroups);

    // 3. Filter out combinations with time conflicts
    const validSchedules = [];
    for (const combo of combinations) {
        let hasConflict = false;
        for (let i = 0; i < combo.length; i++) {
            for (let j = i + 1; j < combo.length; j++) {
                if (combo[i].conflictsWith(combo[j])) {
                    hasConflict = true;
                    break;
                }
            }
            if (hasConflict) break;
        }
        if (!hasConflict) {
            validSchedules.push(combo);
        }
    }
    return validSchedules;
}


// --- SCORING LOGIC ---

const countMorningClasses = (schedule, cutoff) =>
    schedule.flatMap(sec => sec.timeslots).filter(ts => ts.startTime < cutoff).length;

const countEveningClasses = (schedule, cutoff) =>
    schedule.flatMap(sec => sec.timeslots).filter(ts => ts.startTime > cutoff).length;

const countFridayClasses = (schedule) =>
    schedule.flatMap(sec => sec.timeslots).filter(ts => ts.day === 'F').length;

const countDaysUsed = (schedule) =>
    new Set(schedule.flatMap(sec => sec.timeslots).map(ts => ts.day)).size;

const countBackToBack = (schedule) => {
    let b2bCount = 0;
    const dailyTimeslots = {};
    const MIN_GAP_TOLERANCE = 1.5 / 60.0; // 1.5 minutes in hours

    schedule.flatMap(sec => sec.timeslots).forEach(ts => {
        if (!dailyTimeslots[ts.day]) dailyTimeslots[ts.day] = [];
        dailyTimeslots[ts.day].push({ start: ts.startTime, end: ts.endTime });
    });

    for (const day in dailyTimeslots) {
        const slots = dailyTimeslots[day].sort((a, b) => a.start - b.start);
        for (let i = 1; i < slots.length; i++) {
            if ((slots[i].start - slots[i - 1].end) < MIN_GAP_TOLERANCE) {
                b2bCount++;
            }
        }
    }
    return b2bCount;
};


export function scoreSchedule(schedule, prefs) {
    let score = 0;
    if (prefs.noBefore) {
        const beforeCutoff = parseTime(prefs.beforeTime + " AM");
        score += countMorningClasses(schedule, beforeCutoff);
    }
    if (prefs.noAfter) {
        const afterCutoff = parseTime(prefs.afterTime + " PM");
        score += countEveningClasses(schedule, afterCutoff);
    }
    if (prefs.avoidFriday) {
        score += countFridayClasses(schedule);
    }
    if (prefs.avoidB2B) {
        score += countBackToBack(schedule);
    }
    if (prefs.minimizeDays) {
        // We add the number of days directly to the score. Fewer is better.
        score += countDaysUsed(schedule);
    }
    return score;
}