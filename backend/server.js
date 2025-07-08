const express = require('express');
const cors = require('cors');
const fs = require('fs'); // <-- Add File System module
const path = require('path'); // <-- Add Path module
const { CUDScraper } = require('./scraper');
const { generateSchedules, processCourseData, scoreSchedule, getBaseCode } = require('./scheduleGenerator');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// --- NEW: Define the path for our data file ---
const dataFilePath = path.join(__dirname, 'course_data.json');
let courseDataCache = {}; // Cache is still useful for speed after initial load

// --- NEW: Function to load data from file into cache ---
const loadDataFromFile = () => {
    if (fs.existsSync(dataFilePath)) {
        console.log('Loading existing course data from file...');
        const fileData = fs.readFileSync(dataFilePath, 'utf-8');
        const jsonData = JSON.parse(fileData);
        // The data is stored under a semester key in the file
        const semesterKey = Object.keys(jsonData)[0];
        if(semesterKey){
            courseDataCache[semesterKey] = jsonData[semesterKey];
            console.log(`Data for semester ${semesterKey} loaded into cache.`);
        }
    } else {
        console.log('No existing course data file found.');
    }
};


app.post('/api/login-and-scrape', async (req, res) => {
    // --- NEW: Added forceScrape parameter ---
    const { username, password, semester, forceScrape } = req.body;
    if (!username || !password || !semester) {
        return res.status(400).json({ error: 'Username, password, and semester are required.' });
    }

    // --- NEW: Check if we should use existing data ---
    if (courseDataCache[semester] && !forceScrape) {
        console.log(`Using cached data for semester ${semester}.`);
        return res.json({ message: 'Login successful, using existing course data.' });
    }

    // --- SCRAPING LOGIC ---
    const scraper = new CUDScraper(username, password, semester);
    try {
        console.log(forceScrape ? 'Forcing re-scrape...' : 'No data found, starting scrape...');
        const isValid = await scraper.verify_credentials();
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        
        console.log("Scraping data...");
        const data = await scraper.run();
        courseDataCache[semester] = data;
        
        // --- NEW: Save the newly scraped data to the file ---
        fs.writeFileSync(dataFilePath, JSON.stringify({ [semester]: data }, null, 2));
        console.log(`Scraping complete. Data saved to ${dataFilePath}`);

        res.json({ message: 'Login successful and course data scraped.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/courses/:semester', (req, res) => {
    const { semester } = req.params;
    const data = courseDataCache[semester];
    if (data) {
        const uniqueCourses = {};
        for (const fullCode in data) {
            const baseCode = getBaseCode(fullCode);
            if (!uniqueCourses[baseCode]) {
                uniqueCourses[baseCode] = data[fullCode].course_name;
            }
        }
        res.json(uniqueCourses);
    } else {
        res.status(404).json({ error: 'Course data not found. Please login and scrape first.' });
    }
});

// The generate-schedules endpoint remains the same
app.post('/api/generate-schedules', (req, res) => {
    const { selectedCourses, preferences, semester } = req.body;
    const data = courseDataCache[semester];

    if (!data) {
        return res.status(404).json({ error: 'Course data not found. Please scrape data first.' });
    }

    const sectionsByCourse = processCourseData(data);
    
    const coursesToSchedule = {};
    selectedCourses.forEach(code => {
        if (sectionsByCourse[code]) {
            coursesToSchedule[code] = sectionsByCourse[code];
        }
    });

    if (Object.keys(coursesToSchedule).length === 0) {
        return res.status(400).json({ error: 'No valid courses selected.' });
    }

    const allSchedules = generateSchedules(coursesToSchedule);

    if (allSchedules.length > 0) {
        const scores = allSchedules.map(s => scoreSchedule(s, preferences));
        const minScore = Math.min(...scores);
        const bestSchedules = allSchedules.filter((s, i) => scores[i] === minScore);
        res.json(bestSchedules);
    } else {
        res.json([]);
    }
});


app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    loadDataFromFile(); // --- NEW: Load data when server starts ---
});