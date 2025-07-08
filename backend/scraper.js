const { chromium } = require('playwright');
const csv = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');

class CUDScraper {
    constructor(username, password, semester, csvFilename = "course_offerings.csv") {
        this.username = username;
        this.password = password;
        this.semester = semester;
        this.url = "https://cudportal.cud.ac.ae/student/login.asp";
        this.playwright = null;
        this.browser = null;
        this.page = null;
        this.csv_filename = csvFilename;
    }

    async start_browser(headless = true) {
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

            let loginError = null;
            this.page.on('dialog', async dialog => {
                if (dialog.message().includes("Invalid authorization credentials")) {
                    loginError = "Invalid credentials provided.";
                } else {
                    loginError = `An unexpected dialog appeared: ${dialog.message()}`;
                }
                await dialog.accept();
            });

            await this.page.click("#btnLogin");

            try {
                await this.page.waitForURL("**/student/index.asp**", { timeout: 30000 });
            } catch (e) {
                if (loginError) {
                    throw new Error(loginError);
                }
                throw e;
            }

            if (loginError) {
                throw new Error(loginError);
            }

            console.log("Login successful.");
        } catch (e) {
            if (e.message.includes("Invalid credentials provided.")) {
                throw e;
            }
            throw new Error(`Login process failed: ${e}`);
        }
    }

    async verify_credentials() {
        try {
            await this.start_browser(true);
            await this.login();
            return true;
        } catch (e) {
            if (e.message.includes("Invalid credentials provided.")) {
                return false;
            }
            throw e;
        } finally {
            await this.close_browser();
        }
    }

    async navigate_to_courses() {
        await this.page.click("text=Course Offering");
        await this.page.waitForSelector("#displayFilter");
    }

    // In backend/scraper.js

    async scrape_courses() {
        const coursesDict = {};
        let total_pages = 1;
        try {
            const infoElement = this.page.locator("text=/Total Pages:/");
            await infoElement.waitFor({ timeout: 5000 });
            const info = await infoElement.textContent();
            const m = info.match(/Total Pages:\s*(\d+)/);
            if (m) {
                total_pages = parseInt(m[1], 10);
                console.log(`Found a total of ${total_pages} pages.`);
            }
        } catch (e) {
            console.log("Could not determine total pages, will only scrape page 1.");
            total_pages = 1;
        }

        for (let page_num = 1; page_num <= total_pages; page_num++) {
            console.log(`Scraping page ${page_num}...`);
            await this.page.waitForSelector(".Portal_Group_Table", { state: 'visible', timeout: 10000 });

            const rows = await this.page.locator(".Portal_Group_Table > tbody > tr").all();
            for (let i = 0; i < rows.length; i++) {
                const main_row = rows[i];
                const cells = await main_row.locator("td").all();
                if (cells.length < 7) continue;

                const code = (await cells[0].innerText()).trim();
                const name = (await cells[1].innerText()).trim();
                const credits = (await cells[2].innerText()).trim();

                if (i + 1 >= rows.length) continue;
                const sessionContainerRow = rows[i + 1];
                if (await sessionContainerRow.locator("table").count() === 0) continue;

                const sessionRows = await sessionContainerRow.locator("table > tbody > tr").all();
                for (let j = 1; j < sessionRows.length; j++) {
                    const td = await sessionRows[j].locator("td").all();
                    if (td.length < 8) continue;

                    const instr = (await td[0].innerText()).trim();
                    const room = (await td[1].innerText()).trim();
                    const days = (await td[2].innerText()).trim();
                    const start = (await td[4].innerText()).trim();
                    const end = (await td[5].innerText()).trim();
                    const max_e = (await td[6].innerText()).trim();
                    const tot_e = (await td[7].innerText()).trim();

                    if (!coursesDict[code]) {
                        coursesDict[code] = { course_name: name, credits: credits, sessions: [] };
                    }
                    coursesDict[code].sessions.push({
                        instructor: instr, room: room, days: days,
                        start_time: start, end_time: end,
                        max_enroll: max_e, total_enroll: tot_e
                    });
                }
                i++;
            }

            // --- NEW MORE ROBUST PAGINATION LOGIC ---
            if (page_num < total_pages) {
                try {
                    let nextElement;
                    if (page_num % 10 === 0) {
                        console.log(`On page ${page_num}, preparing to click "Next".`);
                        nextElement = this.page.getByRole('link', { name: 'Next' });
                    } else {
                        const nextPageNum = page_num + 1;
                        console.log(`Preparing to click page number ${nextPageNum}.`);
                        nextElement = this.page.getByRole('link', { name: String(nextPageNum), exact: true });
                    }
                    
                    // Wait for the link to be visible and stable before clicking
                    await nextElement.waitFor({ state: 'visible', timeout: 10000 });
                    await nextElement.click();
                    
                    // IMPORTANT: Wait for a clear indication the next page has loaded.
                    // We check that the page number text has updated.
                    console.log(`Waiting for page ${page_num + 1} to load...`);
                    await this.page.waitForSelector(`text=Viewing Page #${page_num + 1}`, { timeout: 15000 });
                    console.log(`Page ${page_num + 1} loaded successfully.`);

                } catch (err) {
                    console.error(`Failed to navigate from page ${page_num}. Stopping scrape. Error: ${err}`);
                    break;
                }
            }
        }
        console.log("Scraping finished.");
        return coursesDict;
    }
    async close_browser() {
        if (this.browser && this.browser.isConnected()) {
            await this.browser.close();
        }
    }

    async run(headless = true) {
        try {
            await this.start_browser(headless);
            await this.login();
            await this.navigate_to_courses();
            const courses = await this.scrape_courses();
            return courses;
        } finally {
            await this.close_browser();
        }
    }
}

module.exports = { CUDScraper };