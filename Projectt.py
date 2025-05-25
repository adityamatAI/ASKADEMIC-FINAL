from playwright.async_api import async_playwright
import asyncio
import csv
import os

class CUDScraper:
    def __init__(self, username, password, semester, csv_filename="course_offerings.csv", max_concurrency: int = 4):
        self.username = username
        self.password = password
        self.semester = semester
        self.login_url = "https://cudportal.cud.ac.ae/student/login.asp"
        self.csv_filename = csv_filename
        self._sem = asyncio.Semaphore(max_concurrency)
        self.playwright = None
        self.browser = None
        self.filtered_url = None
        self.storage_state = None

    async def start_browser(self, headless=True):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=headless)

    async def initial_login_and_filter(self):
        # Single page context to login and apply filter, then capture state
        context = await self.browser.new_context()
        page = await context.new_page()
        # login
        await page.goto(self.login_url, timeout=15000)
        await page.fill("#txtUsername", self.username)
        await page.fill("#txtPassword", self.password)
        await page.wait_for_selector("#idterm", timeout=10000)
        await page.select_option("#idterm", self.semester)
        await page.click("#btnLogin")
        await page.wait_for_selector("a:has-text('Course Offering')", timeout=20000)
        # navigate to offerings & apply filter
        await page.click("text=Course Offering")
        await page.wait_for_selector("#displayFilter")
        await page.click("#displayFilter")
        await page.select_option("#idDivisions", "SEAST")
        await page.click("#btnSubmit")
        # wait for loaded table
        await page.wait_for_selector(".Portal_Group_Table", timeout=20000)
        # capture filtered URL and storage state
        self.filtered_url = page.url
        self.storage_state = await context.storage_state()
        # cleanup
        await page.close()
        await context.close()

    async def scrape_page(self, page_number: int) -> dict:
        # throttle concurrency
        async with self._sem:
            # new context reusing logged-in state
            context = await self.browser.new_context(storage_state=self.storage_state)
            page = await context.new_page()
            try:
                # jump straight into the already-filtered listing
                await page.goto(self.filtered_url, wait_until="networkidle")
                # click to page number
                await page.click(f'a:has-text("{page_number}")')
                await page.wait_for_selector(".Portal_Group_Table", timeout=15000)

                local = {}
                rows = await page.query_selector_all(".Portal_Group_Table tbody tr")
                skipped = 0
                i = 0
                while i < len(rows):
                    cells = await rows[i].query_selector_all("td")
                    if len(cells) < 3:
                        i += 1
                        continue
                    code = (await cells[0].inner_text()).strip()
                    name = (await cells[1].inner_text()).strip()
                    creds = (await cells[2].inner_text()).strip()
                    # detect session table
                    session_row = None
                    if i+1 < len(rows) and await rows[i+1].query_selector("table"):
                        session_row = rows[i+1]
                        i += 2
                    else:
                        i += 1
                    if not session_row:
                        skipped += 1
                        continue
                    all_rows = await session_row.query_selector_all("tr")
                    session_rows = all_rows[1:]
                    local.setdefault(code, {"course_name": name, "credits": creds, "sessions": []})
                    for sr in session_rows:
                        cols = await sr.query_selector_all("td")
                        if len(cols) < 9:
                            continue
                        sess = { key: (await cols[idx].inner_text()).strip()
                                 for idx, key in zip([1,2,3,5,6,7,8],
                                                     ["instructor","room","days","start_time","end_time","max_enroll","total_enroll"]) }
                        local[code]["sessions"].append(sess)
                print(f"Page {page_number}: parsed {len(local)} courses, skipped {skipped}")
                return local
            finally:
                await page.close()
                await context.close()

    async def scrape_courses(self):
        # login + filter once
        await self.initial_login_and_filter()
        # launch tasks
        total_pages = 8
        tasks = [asyncio.create_task(self.scrape_page(n)) for n in range(1, total_pages+1)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        # handle errors
        for idx, result in enumerate(results, start=1):
            if isinstance(result, Exception):
                print(f"⚠️ page {idx} failed: {result}")
                results[idx-1] = {}
        # merge + dedupe
        courses = {}
        for local in results:
            for code, info in local.items():
                entry = courses.setdefault(code, {"course_name": info["course_name"],
                                                 "credits": info["credits"],
                                                 "sessions": [],
                                                 "_seen": set()})
                for s in info["sessions"]:
                    key = (s["days"], s["start_time"], s["end_time"], s["instructor"])
                    if key in entry["_seen"]: continue
                    entry["_seen"].add(key)
                    entry["sessions"].append(s)
        # drop seen
        for e in courses.values(): del e["_seen"]
        # write CSV
        with open(self.csv_filename, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["No.","Course","Course Name","Credits",
                        "Instructor","Room","Days","Start Time","End Time","Max Enrollment","Total Enrollment"])
            c = 1
            for code, info in courses.items():
                first = True
                for s in info["sessions"]:
                    row = [c if first else "", code if first else "", info["course_name"] if first else "",
                           info["credits"] if first else "", s["instructor"], s["room"], s["days"],
                           s["start_time"], s["end_time"], s["max_enroll"], s["total_enroll"]]
                    w.writerow(row)
                    first = False
                c += 1
        print(f"\nDone! Saved to {self.csv_filename}")

    async def close(self):
        await self.browser.close()
        await self.playwright.stop()

    async def run(self, headless=True):
        await self.start_browser(headless)
        await self.scrape_courses()
        await self.close()

    def verify_credentials(self):
        return asyncio.run(self._verify())

    async def _verify(self):
        await self.start_browser(headless=True)
        try:
            # only login, no scrape
            context = await self.browser.new_context()
            page = await context.new_page()
            await page.goto(self.login_url, timeout=15000)
            await page.fill("#txtUsername", self.username)
            await page.fill("#txtPassword", self.password)
            await page.wait_for_selector("#idterm", timeout=10000)
            await page.select_option("#idterm", self.semester)
            await page.click("#btnLogin")
            await page.wait_for_selector("a:has-text('Course Offering')", timeout=20000)
            return True
        except:
            return False
        finally:
            await self.close()


def check_timing_changes(csv_filename="course_offerings.csv", backup_filename="course_offerings_backup.csv"):
    """
    Checks for timing changes by grouping course lecture rows together.
    For each course lecture group (the group starts with a row having a Course value),
    it compares each session's 'Start Time' and 'End Time' with the corresponding session
    in the backup. If any session's timing has changed or a new session is added,
    it outputs a message with the course lecture and the new timings.
    """
    changes = []
    current_rows = []
    # Load current CSV data.
    if os.path.exists(csv_filename):
        with open(csv_filename, "r", newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                current_rows.append(row)
    else:
        return ["Current course data not found."]
    
    # Group current data by course lecture.
    current_groups = {}
    group_key = None
    for row in current_rows:
        if row["Course"].strip():
            group_key = row["Course"].strip()
            current_groups[group_key] = [row]
        else:
            if group_key:
                current_groups[group_key].append(row)
    
    # Load backup CSV data and group similarly.
    backup_groups = {}
    if os.path.exists(backup_filename):
        backup_rows = []
        with open(backup_filename, "r", newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                backup_rows.append(row)
        group_key = None
        for row in backup_rows:
            if row["Course"].strip():
                group_key = row["Course"].strip()
                backup_groups[group_key] = [row]
            else:
                if group_key:
                    backup_groups[group_key].append(row)
    
    # Compare each course group.
    for course, sessions in current_groups.items():
        if course in backup_groups:
            backup_sessions = backup_groups[course]
            # Compare session by session (using index).
            for idx, cur in enumerate(sessions):
                # If a session row has timing info (non-empty 'Start Time' or 'End Time')
                cur_start = cur["Start Time"].strip() if cur["Start Time"] else ""
                cur_end = cur["End Time"].strip() if cur["End Time"] else ""
                if idx < len(backup_sessions):
                    back = backup_sessions[idx]
                    back_start = back["Start Time"].strip() if back["Start Time"] else ""
                    back_end = back["End Time"].strip() if back["End Time"] else ""
                    if cur_start != back_start or cur_end != back_end:
                        change_msg = (f"Course {course} session {idx + 1} timing changed: "
                                      f"new Start Time: {cur_start}, new End Time: {cur_end}.")
                        changes.append(change_msg)
                else:
                    # New session added
                    change_msg = (f"Course {course} session {idx + 1} is new with timings: "
                                  f"Start Time: {cur_start}, End Time: {cur_end}.")
                    changes.append(change_msg)
    
    # Update the backup CSV with current data (overwrite).
    if current_rows:
        with open(backup_filename, "w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=current_rows[0].keys())
            writer.writeheader()
            writer.writerows(current_rows)
    
    return changes

if __name__ == "__main__":
    async def main():
        username = "your_username"
        password = "your_password"
        scraper = CUDScraper(username, password)
        await scraper.run(headless=False)  # Run in non-headless mode for debugging
    asyncio.run(main()) 
