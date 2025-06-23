// backend/scraper.js
const { chromium } = require('playwright');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const re = require('path');

class CUDScraper {
    constructor(username, password, semester, csvFilename = "course_offerings.csv") {
        this.username = username;
        this.password = password;
        this.semester = semester;
        this.url = "https://cudportal.cud.ac.ae/student/login.asp";
        this.csvFilename = csvFilename;
        this.playwright = null;
        this.browser = null;
        this.page = null;
    }

    async startBrowser(headless = true) {
        this.browser = await chromium.launch({ headless });
        this.page = await this.browser.newPage();
    }

    async login() {
        try {
            await this.page.goto(this.url, { timeout: 60000 });
            await this.page.fill("#txtUsername", this.username);
            await this.page.fill("#txtPassword", this.password);
            await this.page.waitForSelector("#idterm", { timeout: 30000 });
            await this.page.selectOption("#idterm", this.semester);

            // Promise.race is the JS equivalent of waiting for the first of two async events
            const loginPromise = Promise.race([
                this.page.waitForURL("**/student/index.asp**", { timeout: 30000 }),
                new Promise((_, reject) => {
                    this.page.once('dialog', async dialog => {
                        reject(new Error(dialog.message()));
                        await dialog.accept();
                    });
                })
            ]);

            await this.page.click("#btnLogin");
            await loginPromise;
            console.log("Login successful.");

        } catch (e) {
            if (e.message.includes("Invalid authorization credentials")) {
                throw new Error("Invalid credentials provided.");
            }
            throw new Error(`Login process failed: ${e.message}`);
        }
    }

    async verifyCredentials() {
        try {
            await this.startBrowser(true);
            await this.login();
            return true;
        } catch (e) {
            if (e.message.includes("Invalid credentials provided.")) {
                return false;
            }
            // Re-throw other errors
            throw e;
        } finally {
            await this.closeBrowser();
        }
    }

    async navigateToCourses() {
        await this.page.click("text=Course Offering");
        await this.page.waitForSelector("#displayFilter");
    }

    async scrapeCourses(filename = null) {
        if (!filename) filename = this.csvFilename;
        const courses = [];

        let totalPages = 1;
        try {
            const info = await this.page.locator("text=/Total Pages:/").innerText();
            const match = info.match(/Total Pages:\s*(\d+)/);
            if (match) totalPages = parseInt(match[1], 10);
        } catch (e) {
            // If the element doesn't exist, assume 1 page
        }

        for (let i = 1; i <= totalPages; i++) {
            const rows = await this.page.locator(".Portal_Group_Table tbody tr").all();
            let currentCourseCode = null;
            let currentCourseName = null;
            let currentCredits = null;

            for (const row of rows) {
                const cells = await row.locator("td").all();
                if (cells.length >= 9) { // This is a session row
                    const data = await Promise.all(cells.map(cell => cell.innerText()));
                    courses.push({
                        Course: currentCourseCode || '',
                        "Course Name": currentCourseName || '',
                        Credits: currentCredits || '',
                        Instructor: data[1].trim(),
                        Room: data[2].trim(),
                        Days: data[3].trim(),
                        "Start Time": data[5].trim(),
                        "End Time": data[6].trim(),
                        "Max Enrollment": data[7].trim(),
                        "Total Enrollment": data[8].trim(),
                    });
                } else if (cells.length === 3) { // This is a main course row
                    const data = await Promise.all(cells.map(cell => cell.innerText()));
                    currentCourseCode = data[0].trim();
                    currentCourseName = data[1].trim();
                    currentCredits = data[2].trim();
                }
            }

            if (i < totalPages) {
                try {
                    await this.page.getByRole("link", { name: String(i + 1), exact: true }).first().click();
                    await this.page.waitForSelector(".Portal_Group_Table", { timeout: 10000 });
                } catch (e) {
                    console.warn(`Could not navigate to page ${i + 1}. Stopping scrape.`);
                    break;
                }
            }
        }
        
        // Use csv-writer to save the data
        const csvWriter = createObjectCsvWriter({
            path: filename,
            header: [
                {id: 'Course', title: 'Course'},
                {id: 'Course Name', title: 'Course Name'},
                {id: 'Credits', title: 'Credits'},
                {id: 'Instructor', title: 'Instructor'},
                {id: 'Room', title: 'Room'},
                {id: 'Days', title: 'Days'},
                {id: 'Start Time', title: 'Start Time'},
                {id: 'End Time', title: 'End Time'},
                {id: 'Max Enrollment', title: 'Max Enrollment'},
                {id: 'Total Enrollment', title: 'Total Enrollment'},
            ]
        });

        // The python script had a weird empty row logic. Let's fix that.
        // We will fill down the course code.
        let lastCourse = {Course: '', 'Course Name': '', Credits: ''};
        const processedCourses = courses.map(course => {
            if(course.Course) {
                 lastCourse = {Course: course.Course, 'Course Name': course['Course Name'], Credits: course.Credits};
            } else {
                course.Course = lastCourse.Course;
                course['Course Name'] = lastCourse['Course Name'];
                course.Credits = lastCourse.Credits;
            }
            return course;
        });

        await csvWriter.writeRecords(processedCourses);
    }
    
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async run(headless = true) {
        try {
            await this.startBrowser(headless);
            await this.login();
            await this.navigateToCourses();
            await this.scrapeCourses();
        } finally {
            await this.closeBrowser();
        }
    }
}


// --- Helper function for checking changes ---

async function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        if (!fs.existsSync(filePath)) resolve(results);
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

function groupCourses(rows) {
    const groups = {};
    let lastCode = null;
    for (const row of rows) {
        const code = row['Course']?.trim() || lastCode;
        if (!code) continue;
        if (!groups[code]) groups[code] = [];
        groups[code].push(row);
        lastCode = code;
    }
    return groups;
}

async function checkTimingChanges(csvFilename) {
    const backupFilename = `backup_${path.basename(csvFilename)}`;
    try {
        await fs.access(csvFilename);
    } catch (e) {
        return ["Current course data not found. Please scrape first."];
    }

    const currentRows = await readCsv(csvFilename);
    
    try {
        await fs.access(backupFilename);
    } catch (e) {
        // Backup doesn't exist, create it and return no changes
        await fs.copyFile(csvFilename, backupFilename);
        return [];
    }
    
    const backupRows = await readCsv(backupFilename);
    
    const currentGroups = groupCourses(currentRows);
    const backupGroups = groupCourses(backupRows);
    
    const changes = [];

    for (const code in currentGroups) {
        const currentSessions = currentGroups[code];
        const backupSessions = backupGroups[code] || [];

        currentSessions.forEach((current, index) => {
            const backup = backupSessions[index];
            const curStart = current['Start Time']?.trim();
            const curEnd = current['End Time']?.trim();

            if (backup) {
                const backStart = backup['Start Time']?.trim();
                const backEnd = backup['End Time']?.trim();
                if (curStart !== backStart || curEnd !== backEnd) {
                    changes.push(`Course ${code} session ${index + 1} changed: new ${curStart}-${curEnd}, was ${backStart}-${backEnd}`);
                }
            } else {
                 changes.push(`Course ${code} session ${index + 1} is new: ${curStart}-${curEnd}`);
            }
        });
    }

    // Update backup for next run
    await fs.copyFile(csvFilename, backupFilename);
    return changes;
}

module.exports = { CUDScraper, checkTimingChanges, readCsv };