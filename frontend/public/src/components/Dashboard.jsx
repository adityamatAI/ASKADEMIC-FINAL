// frontend/src/components/Dashboard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import SchedulePlot from './SchedulePlot';
import { generateSchedules, scoreSchedule } from '../utils/scheduler'; // We will create this file

const API_URL = 'http://localhost:5001/api';

const Dashboard = ({ session, onLogout }) => {
    const [allCourses, setAllCourses] = useState([]);
    const [selectedCourses, setSelectedCourses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState('');

    const [bestSchedules, setBestSchedules] = useState([]);
    const [scheduleIndex, setScheduleIndex] = useState(0);

    // --- Preferences State ---
    const [prefs, setPrefs] = useState({
        noBefore: false,
        beforeTime: '11:00',
        noAfter: false,
        afterTime: '17:00',
        avoidFriday: false,
        avoidB2B: false,
        minimizeDays: false,
    });
    
    const handlePrefChange = (e) => {
        const { name, type, checked, value } = e.target;
        setPrefs(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    // --- Data Fetching and Scraping ---
    useEffect(() => {
        const fetchCourseData = async () => {
            setIsLoading(true);
            setMessage('Retrieving course data...');
            try {
                const response = await axios.get(`${API_URL}/get-courses/${session.semester}`);
                setAllCourses(response.data);
                setMessage('');
            } catch (error) {
                if (error.response?.status === 404) {
                    setMessage('Course data not found. Scraping for the first time... This may take a minute.');
                    try {
                         await axios.post(`${API_URL}/scrape-courses`, session);
                         // After starting scrape, poll for the data
                         pollForData();
                    } catch (scrapeError) {
                         setMessage('Failed to start scraping process.');
                    }
                } else {
                    setMessage('Failed to load course data.');
                }
            } finally {
                setIsLoading(false);
            }
        };
        
        const pollForData = async (retries = 5) => {
            if (retries === 0) {
                setMessage("Scraping timed out. Please refresh and try again.");
                return;
            }
            try {
                const res = await axios.get(`${API_URL}/get-courses/${session.semester}`);
                setAllCourses(res.data);
                setMessage('Course data retrieved successfully!');
                setTimeout(() => setMessage(''), 3000); // Clear message after 3s
            } catch (e) {
                setTimeout(() => pollForData(retries - 1), 5000); // Wait 5s and retry
            }
        };

        fetchCourseData();
    }, [session]);

    const handleCheckChanges = async () => {
        setMessage('Re-scraping and checking for changes...');
        setIsLoading(true);
        try {
            const response = await axios.post(`${API_URL}/check-changes`, session);
            const { changes } = response.data;
            if (changes.length > 0) {
                const changesString = changes.join('\n');
                alert(`Timing Changes Detected:\n\n${changesString}`);
                setMessage('Changes detected!');
            } else {
                setMessage('No timing changes found.');
            }
        } catch (error) {
            setMessage('Error checking for changes.');
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- Schedule Generation ---
    const handleGenerateSchedules = () => {
        if (selectedCourses.length === 0) {
            setMessage('Please select courses to generate a schedule.');
            return;
        }
        setMessage('Generating schedules...');
        
        const courseCodes = selectedCourses.map(c => c.value);
        const schedules = generateSchedules(allCourses, courseCodes);

        if (schedules.length > 0) {
            const scored = schedules.map(s => ({
                schedule: s,
                score: scoreSchedule(s, prefs),
            }));
            
            scored.sort((a, b) => a.score - b.score);
            const minScore = scored[0].score;
            const best = scored.filter(s => s.score === minScore).map(s => s.schedule);

            setBestSchedules(best);
            setScheduleIndex(0);
            setMessage(`Found ${best.length} optimal schedule(s).`);
        } else {
            setBestSchedules([]);
            setMessage('No conflict-free schedules could be generated for the selected courses.');
        }
    };
    

    // Memoize options for react-select to avoid re-rendering
    const courseOptions = useMemo(() => {
        const uniqueCourses = {};
        allCourses.forEach(course => {
            const baseCode = (course.Course.match(/^[A-Za-z]+\d+/) || [course.Course])[0];
            if (baseCode && !uniqueCourses[baseCode]) {
                uniqueCourses[baseCode] = `${baseCode} — ${course['Course Name']}`;
            }
        });
        return Object.entries(uniqueCourses).map(([value, label]) => ({ value, label }));
    }, [allCourses]);

    return (
        <div className="dashboard-layout">
            <aside className="sidebar">
                <h3>Schedule Preferences</h3>
                
                <div className="pref-item">
                    <input type="checkbox" id="noBefore" name="noBefore" checked={prefs.noBefore} onChange={handlePrefChange} />
                    <label htmlFor="noBefore">No classes before:</label>
                    {prefs.noBefore && <input type="time" name="beforeTime" value={prefs.beforeTime} onChange={handlePrefChange} />}
                </div>

                <div className="pref-item">
                    <input type="checkbox" id="noAfter" name="noAfter" checked={prefs.noAfter} onChange={handlePrefChange} />
                    <label htmlFor="noAfter">No classes after:</label>
                    {prefs.noAfter && <input type="time" name="afterTime" value={prefs.afterTime} onChange={handlePrefChange} />}
                </div>

                <div className="pref-item">
                    <input type="checkbox" id="avoidFriday" name="avoidFriday" checked={prefs.avoidFriday} onChange={handlePrefChange} />
                    <label htmlFor="avoidFriday">No Friday classes</label>
                </div>
                 <div className="pref-item">
                    <input type="checkbox" id="avoidB2B" name="avoidB2B" checked={prefs.avoidB2B} onChange={handlePrefChange} />
                    <label htmlFor="avoidB2B">Avoid back-to-back</label>
                </div>
                 <div className="pref-item">
                    <input type="checkbox" id="minimizeDays" name="minimizeDays" checked={prefs.minimizeDays} onChange={handlePrefChange} />
                    <label htmlFor="minimizeDays">Minimize days on campus</label>
                </div>
                
                <button onClick={onLogout} className="logout-button">Logout</button>
            </aside>

            <section className="main-content">
                <h2>Course Dashboard</h2>
                <p>Term: {session.termName}</p>
                
                {message && <div className="message-box">{isLoading ? <div className="spinner"></div> : null} {message}</div>}

                <div className="controls">
                     <button onClick={handleCheckChanges} disabled={isLoading}>
                        Check for Timing Changes
                    </button>
                </div>
                
                <div className="course-selector">
                    <Select
                        isMulti
                        options={courseOptions}
                        onChange={setSelectedCourses}
                        placeholder="Select Courses..."
                        isLoading={allCourses.length === 0 && isLoading}
                    />
                </div>

                <div className="controls">
                    <button onClick={handleGenerateSchedules} disabled={isLoading || selectedCourses.length === 0}>
                        Generate Schedules
                    </button>
                </div>
                
                {bestSchedules.length > 0 && (
                    <div className="schedule-display">
                        <div className="schedule-header">
                            <h3>Best Schedule {scheduleIndex + 1} of {bestSchedules.length}</h3>
                            <div className="schedule-nav">
                                <button onClick={() => setScheduleIndex(Math.max(0, scheduleIndex - 1))} disabled={scheduleIndex === 0}>◀ Prev</button>
                                <button onClick={() => setScheduleIndex(Math.min(bestSchedules.length - 1, scheduleIndex + 1))} disabled={scheduleIndex === bestSchedules.length - 1}>Next ▶</button>
                            </div>
                        </div>
                        <p><strong>Sections:</strong> {bestSchedules[scheduleIndex].map(s => s.sectionId).join(', ')}</p>
                        <SchedulePlot schedule={bestSchedules[scheduleIndex]} />
                    </div>
                )}
            </section>
        </div>
    );
};

export default Dashboard;