// frontend/src/components/SchedulePlot.jsx
import React from 'react';

const DAYS = ['M', 'T', 'W', 'R', 'F'];
const HOUR_START = 8; // 8 AM
const HOUR_END = 20; // 8 PM

// Generate time labels for the grid
const timeLabels = [];
for (let i = HOUR_START; i <= HOUR_END; i++) {
    timeLabels.push(`${String(i).padStart(2, '0')}:00`);
}

const SchedulePlot = ({ schedule }) => {
    // Create a color map for courses
    const courseCodes = [...new Set(schedule.map(s => s.courseCode))];
    const colors = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];
    const colorMap = courseCodes.reduce((acc, code, index) => {
        acc[code] = colors[index % colors.length];
        return acc;
    }, {});

    const gridStyle = {
        display: 'grid',
        gridTemplateColumns: '50px repeat(5, 1fr)', // Time labels + 5 days
        gridTemplateRows: `repeat(${(HOUR_END - HOUR_START) * 2}, 25px)`, // 30-min slots
        gap: '2px',
    };

    const dayToIndex = { M: 2, T: 3, W: 4, R: 5, F: 6 };

    return (
        <div className="schedule-plot-container" style={gridStyle}>
            {/* Time Labels */}
            {timeLabels.map((time, index) => (
                <div key={time} className="time-label" style={{ gridRow: index * 2 + 1, gridColumn: 1 }}>
                    {time}
                </div>
            ))}

            {/* Day Headers */}
            {DAYS.map((day, index) => (
                <div key={day} className="day-header" style={{ gridColumn: index + 2, gridRow: 0 }}>
                    {day}
                </div>
            ))}
            
            {/* Render course blocks */}
            {schedule.flatMap(section =>
                section.timeslots.map(ts => {
                    const gridRowStart = (ts.startTime - HOUR_START) * 2 + 1;
                    const gridRowEnd = (ts.endTime - HOUR_START) * 2 + 1;
                    
                    const blockStyle = {
                        gridColumn: dayToIndex[ts.day],
                        gridRow: `${Math.round(gridRowStart)} / ${Math.round(gridRowEnd)}`,
                        backgroundColor: colorMap[section.courseCode],
                    };

                    return (
                        <div key={`${section.sectionId}-${ts.day}`} className="course-block" style={blockStyle}>
                            <strong>{section.courseCode}</strong>
                            <span>{section.sectionId}</span>
                        </div>
                    );
                })
            )}
        </div>
    );
};

export default SchedulePlot;