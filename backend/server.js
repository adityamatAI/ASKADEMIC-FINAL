// backend/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { CUDScraper, checkTimingChanges, readCsv } = require('./scraper.js');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors()); // Allow requests from the React frontend
app.use(express.json()); // To parse JSON bodies

// --- API ENDPOINTS ---

// Endpoint to verify credentials
app.post('/api/verify-credentials', async (req, res) => {
    const { username, password, semester } = req.body;
    if (!username || !password || !semester) {
        return res.status(400).json({ error: 'Username, password, and semester are required.' });
    }
    
    console.log(`Verifying credentials for user: ${username}`);
    const scraper = new CUDScraper(username, password, semester);
    try {
        const isValid = await scraper.verifyCredentials();
        if (isValid) {
            res.status(200).json({ success: true, message: 'Credentials are valid.' });
        } else {
            res.status(401).json({ success: false, error: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'An unexpected error occurred during verification.' });
    }
});

// Endpoint to trigger a full scrape
app.post('/api/scrape-courses', async (req, res) => {
    const { username, password, semester } = req.body;
    const filename = `course_offerings_${semester}.csv`;

    console.log(`Starting scrape for semester: ${semester}`);
    const scraper = new CUDScraper(username, password, semester, filename);
    try {
        // Run in a non-blocking way
        scraper.run(true)
          .then(() => console.log(`Scraping for ${semester} completed successfully.`))
          .catch(err => console.error(`Scraping for ${semester} failed:`, err));

        res.status(202).json({ message: 'Scraping process started. It will run in the background.' });
    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to start scraping process.' });
    }
});

// Endpoint to get the course data from CSV
app.get('/api/get-courses/:semester', async (req, res) => {
    const { semester } = req.params;
    const filename = `course_offerings_${semester}.csv`;

    if (!fs.existsSync(filename)) {
        return res.status(404).json({ error: 'Course data not found. Please run a scrape first.' });
    }

    try {
        const data = await readCsv(filename);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read course data.' });
    }
});

// Endpoint to check for timing changes
app.post('/api/check-changes', async (req, res) => {
    const { username, password, semester } = req.body;
    const filename = `course_offerings_${semester}.csv`;
    
    // First, re-scrape the data to get the latest version
    console.log(`Checking changes for semester: ${semester}`);
    const scraper = new CUDScraper(username, password, semester, filename);
    try {
        await scraper.run(true);
        const changes = await checkTimingChanges(filename);
        res.status(200).json({ changes });
    } catch (error) {
        console.error('Change check error:', error);
        res.status(500).json({ error: 'An error occurred while checking for changes.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});