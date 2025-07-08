function* product(...iterables) {
    if (iterables.length === 0) {
        yield [];
        return;
    }
    const [head, ...tail] = iterables;
    const remaining = [...product(...tail)];
    for (const item of head) {
        for (const items of remaining) {
            yield [item, ...items];
        }
    }
}

function* combinations(iterable, r) {
    const pool = Array.from(iterable);
    const n = pool.length;
    if (r > n) {
        return;
    }
    const indices = Array.from({ length: r }, (_, i) => i);
    yield indices.map(i => pool[i]);
    while (true) {
        let i = r - 1;
        while (i >= 0 && indices[i] === i + n - r) {
            i--;
        }
        if (i < 0) {
            return;
        }
        indices[i]++;
        for (let j = i + 1; j < r; j++) {
            indices[j] = indices[j - 1] + 1;
        }
        yield indices.map(i => pool[i]);
    }
}

class Section {
    constructor(courseCode, sectionId, timeslots) {
        this.course_code = courseCode;
        this.section_id = sectionId;
        this.timeslots = timeslots;
    }

    conflictsWith(other) {
        for (const [d1, , , s1, e1] of this.timeslots) {
            for (const [d2, , , s2, e2] of other.timeslots) {
                if (d1 === d2 && e1 > s2 && e2 > s1) {
                    return true;
                }
            }
        }
        return false;
    }
}

function generateSchedules(courses) {
    const courseSections = Object.values(courses);
    const combos = product(...courseSections);
    const validSchedules = [];

    for (const c of combos) {
        let hasConflict = false;
        for (const [s1, s2] of combinations(c, 2)) {
            if (s1.conflictsWith(s2)) {
                hasConflict = true;
                break;
            }
        }
        if (!hasConflict) {
            validSchedules.push(c);
        }
    }
    return validSchedules;
}

function parseTime(t) {
    try {
        const [hours, minutes] = t.split(':').map(Number);
        return hours + minutes / 60.0;
    } catch (e) {
        return 0.0;
    }
}

function getBaseCode(fullCode) {
    const m = fullCode.match(/^([A-Za-z]+\d+)/);
    return m ? m[1] : fullCode;
}

function processCourseData(courseData) {
    const courses = {};
    for (const fullCode in courseData) {
        const baseCode = getBaseCode(fullCode);
        if (!courses[baseCode]) {
            courses[baseCode] = [];
        }
        const courseInfo = courseData[fullCode];
        const timeslots = [];
        for (const session of courseInfo.sessions) {
            for (const day of session.days.replace(/,/g, '')) {
                const startTime = parseTime(session.start_time);
                const endTime = parseTime(session.end_time);
                if (startTime && endTime) {
                    timeslots.push([day, session.start_time, session.end_time, startTime, endTime]);
                }
            }
        }
        if (timeslots.length > 0) {
            courses[baseCode].push(new Section(baseCode, fullCode, timeslots));
        }
    }
    return courses;
}


// Scoring Functions
function countMorningClasses(schedule, cutoff) {
    return schedule.reduce((acc, sec) => acc + sec.timeslots.filter(ts => ts[3] < cutoff).length, 0);
}

function countEveningClasses(schedule, cutoff) {
    return schedule.reduce((acc, sec) => acc + sec.timeslots.filter(ts => ts[3] > cutoff).length, 0);
}

function countFridayClasses(schedule) {
    return schedule.reduce((acc, sec) => acc + sec.timeslots.filter(ts => ts[0] === 'F').length, 0);
}

function countBackToBack(schedule) {
    let backToBackCount = 0;
    const dailyTimeslots = {};
    const MINIMUM_GAP_TOLERANCE = 1.5 / 60.0;

    for (const section of schedule) {
        for (const [day, , , start_time, end_time] of section.timeslots) {
            if (!dailyTimeslots[day]) {
                dailyTimeslots[day] = [];
            }
            dailyTimeslots[day].push([start_time, end_time]);
        }
    }

    for (const day in dailyTimeslots) {
        if (dailyTimeslots[day].length < 2) continue;
        const sortedTimes = dailyTimeslots[day].sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < sortedTimes.length; i++) {
            const previous_end_time = sortedTimes[i - 1][1];
            const current_start_time = sortedTimes[i][0];
            if ((current_start_time - previous_end_time) < MINIMUM_GAP_TOLERANCE) {
                backToBackCount++;
            }
        }
    }
    return backToBackCount;
}

function countDaysUsed(schedule) {
    const days = new Set();
    schedule.forEach(sec => sec.timeslots.forEach(ts => days.add(ts[0])));
    return days.size;
}

function scoreSchedule(schedule, prefs) {
    let score = 0;
    if (prefs.no_before) score += countMorningClasses(schedule, prefs.before_cutoff);
    if (prefs.no_after) score += countEveningClasses(schedule, prefs.after_cutoff);
    if (prefs.avoid_friday) score += countFridayClasses(schedule);
    if (prefs.avoid_back_to_back) score += countBackToBack(schedule);
    if (prefs.minimize_days) score += countDaysUsed(schedule);
    return score;
}

module.exports = {
    generateSchedules,
    processCourseData,
    scoreSchedule,
    getBaseCode
};