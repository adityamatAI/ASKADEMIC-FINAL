document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'http://localhost:3000';

    // State
    let bestSchedules = [];
    let currentScheduleIndex = 0;
    let scheduleChart = null;

    // Element selectors
    const loginSection = document.getElementById('login-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const loginBtn = document.getElementById('login-btn');
    const forceScrapeBtn = document.getElementById('force-scrape-btn'); // New button
    const logoutBtn = document.getElementById('logout-btn');
    const generateBtn = document.getElementById('generate-btn');
    const loginStatus = document.getElementById('login-status');
    const scheduleStatus = document.getElementById('schedule-status');
    const courseSelect = document.getElementById('course-select');

    // Schedule display elements
    const scheduleDisplay = document.getElementById('schedule-display');
    const prevBtn = document.getElementById('prev-schedule');
    const nextBtn = document.getElementById('next-schedule');
    const scheduleInfo = document.getElementById('schedule-info');
    const scheduleDetails = document.getElementById('schedule-details');
    
    // Preference elements
    const noBeforeCheck = document.getElementById('no-before');
    const beforeTimeInput = document.getElementById('before-time');
    const noAfterCheck = document.getElementById('no-after');
    const afterTimeInput = document.getElementById('after-time');

    // --- UPDATED EVENT LISTENERS ---
    loginBtn.addEventListener('click', () => handleLogin(false)); // False for forceScrape
    forceScrapeBtn.addEventListener('click', () => handleLogin(true)); // True for forceScrape
    logoutBtn.addEventListener('click', handleLogout);
    generateBtn.addEventListener('click', handleGenerateSchedules);
    prevBtn.addEventListener('click', () => navigateSchedules(-1));
    nextBtn.addEventListener('click', () => navigateSchedules(1));

    noBeforeCheck.addEventListener('change', () => beforeTimeInput.disabled = !noBeforeCheck.checked);
    noAfterCheck.addEventListener('change', () => afterTimeInput.disabled = !noAfterCheck.checked);

    // --- UPDATED LOGIN HANDLER ---
    async function handleLogin(forceScrape = false) {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const semester = document.getElementById('term').value;

        if (!username || !password) {
            loginStatus.textContent = 'Please enter username and password.';
            loginStatus.style.color = 'red';
            return;
        }

        loginStatus.textContent = forceScrape 
            ? 'Forcing re-scrape... This may take several minutes.' 
            : 'Logging in...';
        loginStatus.style.color = 'orange';

        try {
            const response = await fetch(`${API_URL}/api/login-and-scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, semester, forceScrape }) // Send the flag
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed.');
            }

            loginStatus.textContent = 'Success! Fetching courses...';
            loginStatus.style.color = 'green';
            await fetchCourses(semester);

            loginSection.style.display = 'none';
            dashboardSection.style.display = 'flex';
        } catch (error) {
            loginStatus.textContent = `Error: ${error.message}`;
            loginStatus.style.color = 'red';
        }
    }
    
    function handleLogout() {
        loginSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        loginStatus.textContent = '';
        courseSelect.innerHTML = '';
        scheduleDisplay.style.display = 'none';
        bestSchedules = [];
        currentScheduleIndex = 0;
    }

    async function fetchCourses(semester) {
        try {
            const response = await fetch(`${API_URL}/api/courses/${semester}`);
            const courses = await response.json();
            if (!response.ok) throw new Error(courses.error);

            courseSelect.innerHTML = '';
            for (const code in courses) {
                const option = document.createElement('option');
                option.value = code;
                option.textContent = `${code} — ${courses[code]}`;
                courseSelect.appendChild(option);
            }
        } catch (error) {
            scheduleStatus.textContent = `Error fetching courses: ${error.message}`;
            scheduleStatus.style.color = 'red';
        }
    }
    
    function getPreferences() {
        const [beforeHour, beforeMinute] = document.getElementById('before-time').value.split(':').map(Number);
        const [afterHour, afterMinute] = document.getElementById('after-time').value.split(':').map(Number);

        return {
            no_before: document.getElementById('no-before').checked,
            before_cutoff: beforeHour + beforeMinute / 60,
            no_after: document.getElementById('no-after').checked,
            after_cutoff: afterHour + afterMinute / 60,
            avoid_friday: document.getElementById('avoid-friday').checked,
            avoid_back_to_back: document.getElementById('avoid-b2b').checked,
            minimize_days: document.getElementById('minimize-days').checked
        };
    }

    async function handleGenerateSchedules() {
        const selectedCourses = Array.from(courseSelect.selectedOptions).map(opt => opt.value);
        const semester = document.getElementById('term').value;

        if (selectedCourses.length === 0) {
            scheduleStatus.textContent = 'Please select at least one course.';
            scheduleStatus.style.color = 'red';
            return;
        }

        scheduleStatus.textContent = 'Generating schedules...';
        scheduleStatus.style.color = 'orange';

        try {
            const response = await fetch(`${API_URL}/api/generate-schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selectedCourses,
                    preferences: getPreferences(),
                    semester
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            bestSchedules = data;
            if (bestSchedules.length > 0) {
                scheduleStatus.textContent = `Found ${bestSchedules.length} optimal schedule(s).`;
                scheduleStatus.style.color = 'green';
                currentScheduleIndex = 0;
                displaySchedule();
            } else {
                scheduleStatus.textContent = 'No possible schedules found with the selected courses.';
                scheduleStatus.style.color = 'red';
                scheduleDisplay.style.display = 'none';
            }
        } catch (error) {
            scheduleStatus.textContent = `Error: ${error.message}`;
            scheduleStatus.style.color = 'red';
        }
    }
    
    function navigateSchedules(direction) {
        if (bestSchedules.length === 0) return;
        currentScheduleIndex = (currentScheduleIndex + direction + bestSchedules.length) % bestSchedules.length;
        displaySchedule();
    }

    function displaySchedule() {
        if (bestSchedules.length === 0) {
            scheduleDisplay.style.display = 'none';
            return;
        }
        
        scheduleDisplay.style.display = 'block';
        const schedule = bestSchedules[currentScheduleIndex];
        
        scheduleInfo.textContent = `Schedule ${currentScheduleIndex + 1} of ${bestSchedules.length}`;
        
        const detailsHtml = '<strong>Lectures:</strong> ' + schedule.map(sec => `${sec.course_code}:${sec.section_id}`).join(', ');
        scheduleDetails.innerHTML = detailsHtml;

        plotSchedule(schedule);
    }
    
    function parseTimeToFloat(timeStr) {
        if(!timeStr || !timeStr.includes(':')) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours + minutes / 60;
    }

    function plotSchedule(schedule) {
        const ctx = document.getElementById('schedule-plot').getContext('2d');
        const days = ['M', 'T', 'W', 'R', 'F'];
        const dayColors = {};
        const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
        let colorIndex = 0;

        const datasets = [];
        schedule.forEach(section => {
            if (!dayColors[section.course_code]) {
                dayColors[section.course_code] = colors[colorIndex % colors.length];
                colorIndex++;
            }
            
            section.timeslots.forEach(ts => {
                const dayIndex = days.indexOf(ts[0]);
                if(dayIndex !== -1){
                    datasets.push({
                        label: section.course_code,
                        data: [{
                            x: [parseTimeToFloat(ts[1]), parseTimeToFloat(ts[2])],
                            y: ts[0]
                        }],
                        backgroundColor: dayColors[section.course_code]
                    });
                }
            });
        });

        if (scheduleChart) {
            scheduleChart.destroy();
        }

        scheduleChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: days,
                datasets: datasets
            },
            options: {
                indexAxis: 'y',
                scales: {
                    x: {
                        min: 8,
                        max: 20,
                        ticks: {
                           stepSize: 1,
                           callback: function(value) {
                               const hour = Math.floor(value);
                               const minute = Math.round((value - hour) * 60);
                               return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                           }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                         callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                const start = context.parsed.x[0];
                                const end = context.parsed.x[1];
                                const formatTime = (time) => {
                                    const h = Math.floor(time);
                                    const m = Math.round((time - h) * 60);
                                    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                                };
                                label += `${formatTime(start)} - ${formatTime(end)}`;
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }
});