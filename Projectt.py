from playwright.async_api import async_playwright
import asyncio
import csv
import os

class CUDScraper:
    def __init__(self, username, password, semester, csv_filename="course_offerings.csv"):
        # Initialize login credentials, semester value, and target portal URL
        self.username = username
        self.password = password
        self.semester = semester
        self.url = "https://cudportal.cud.ac.ae/student/login.asp"
        self.playwright = None
        self.browser = None
        self.page = None
        self.csv_filename = csv_filename

    async def start_browser(self, headless=True):
        # Starts a Playwright Chromium browser instance asynchronously
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=headless)
        self.page = await self.browser.new_page()
        print("Browser started.")

    async def login(self):
        try:
            print("Loading login page...")
            await self.page.goto(self.url, timeout=15000)  # 15s timeout

            # Fill in username and password
            await self.page.fill("#txtUsername", self.username)
            await self.page.fill("#txtPassword", self.password)

            # Wait for the term dropdown to appear and then select the term.
            # Update the selector if necessary. 
            await self.page.wait_for_selector("#idterm", timeout=10000)
            await self.page.select_option("#idterm", self.semester)

            # Click the login button
            await self.page.click("#btnLogin")
            await self.page.wait_for_timeout(5000)  # brief pause

            # Wait for the Course Offering link to confirm successful login
            await self.page.wait_for_selector("a:has-text('Course Offering')", timeout=20000)
            print("Login successful.")
        except Exception as e:
            raise RuntimeError(f" Login failed: {e}")



    async def navigate_to_courses(self):
        """Navigates to the Course Offerings page."""
        await self.page.click("text=Course Offering")
        await self.page.wait_for_selector("#displayFilter")
        print(" Navigated to Course Offerings.")

    async def apply_filters(self, division="SEAST"):
        # Applies division filter (e.g., SEAST) to show relevant courses
        await self.page.click("#displayFilter")
        await self.page.select_option("#idDivisions", division)
        await self.page.click("#btnSubmit")
        await self.page.wait_for_selector(".Portal_Group_Table")
        print(f" Filter applied for division: {division}")

    async def scrape_courses(self, filename="course_offerings.csv"):
        """
        Scrapes all course offering pages, parses sessions for each course,
        and saves the structured data into a CSV.
        """
        print(" Starting course scraping...")

        # Dictionary to group sessions by course_code.
        courses_dict = {}
        skipped_courses = 0
        total_pages = 8  # Fixed based on your project spec

        # Group sessions by course_code and handle pages iteratively
        for page_number in range(1, total_pages + 1):
            # Look for session tables and parse each session into the dict
            print(f"\n Scraping Page {page_number}...")
            rows = await self.page.query_selector_all(".Portal_Group_Table tbody tr")
            i = 0
            while i < len(rows):
                # Treat current row as the course row.
                main_row = rows[i]
                course_cells = await main_row.query_selector_all("td")
                if len(course_cells) < 3:
                    i += 1
                    continue

                course_code = (await course_cells[0].inner_text()) or ""
                course_code = course_code.strip()
                course_name = (await course_cells[1].inner_text()) or ""
                course_name = course_name.strip()
                credits = (await course_cells[2].inner_text()) or ""
                credits = credits.strip()

                # Check if next row exists and contains a nested session table.
                session_row = None
                if i + 1 < len(rows):
                    possible_session = rows[i + 1]
                    nested_table = await possible_session.query_selector("table")
                    if nested_table is not None:
                        session_row = possible_session
                        i += 2
                    else:
                        i += 1
                else:
                    i += 1

                # If there's no session row, skip this course.
                if not session_row:
                    print(f" Skipped {course_code} (no session table)")
                    skipped_courses += 1
                    continue

                all_session_rows = await session_row.query_selector_all("tr")
                session_rows = all_session_rows[1:]  # Skip header row

                # Create or update the dictionary entry for the course.
                if course_code not in courses_dict:
                    courses_dict[course_code] = {
                        "course_name": course_name,
                        "credits": credits,
                        "sessions": []
                    }

                for session in session_rows:
                    cells = await session.query_selector_all("td")
                    if len(cells) < 9:
                        continue

                    instructor   = (await cells[1].inner_text()) or ""
                    room         = (await cells[2].inner_text()) or ""
                    days         = (await cells[3].inner_text()) or ""
                    start_time   = (await cells[5].inner_text()) or ""
                    end_time     = (await cells[6].inner_text()) or ""
                    max_enroll   = (await cells[7].inner_text()) or ""
                    total_enroll = (await cells[8].inner_text()) or ""

                    # Strip values to avoid extra whitespace.
                    instructor = instructor.strip()
                    room = room.strip()
                    days = days.strip()
                    start_time = start_time.strip()
                    end_time = end_time.strip()
                    max_enroll = max_enroll.strip()
                    total_enroll = total_enroll.strip()

                    courses_dict[course_code]["sessions"].append({
                        "instructor": instructor,
                        "room": room,
                        "days": days,
                        "start_time": start_time,
                        "end_time": end_time,
                        "max_enroll": max_enroll,
                        "total_enroll": total_enroll
                    })

            # Go to next page 
            if page_number < total_pages:
                try:
                    await self.page.click(f'text="{page_number + 1}"')
                    await self.page.wait_for_timeout(2000)
                except Exception as e:
                    print(f" Failed to click page {page_number + 1}: {e}")
                    break

        # Save parsed and grouped session data into the CSV
        with open(filename, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow([
                "No.", "Course", "Course Name", "Credits",
                "Instructor", "Room", "Days",
                "Start Time", "End Time", "Max Enrollment", "Total Enrollment"
            ])

            course_counter = 1  # Increment once per course
            for code, info in courses_dict.items():
                sessions = info["sessions"]
                first_session = True
                for s in sessions:
                    if first_session:
                        writer.writerow([
                            course_counter,
                            code or "",
                            info["course_name"] or "",
                            info["credits"] or "",
                            s["instructor"] or "",
                            s["room"] or "",
                            s["days"] or "",
                            s["start_time"] or "",
                            s["end_time"] or "",
                            s["max_enroll"] or "",
                            s["total_enroll"] or ""
                        ])
                        first_session = False
                    else:
                        writer.writerow([
                            "", "", "", "",
                            s["instructor"] or "",
                            s["room"] or "",
                            s["days"] or "",
                            s["start_time"] or "",
                            s["end_time"] or "",
                            s["max_enroll"] or "",
                            s["total_enroll"] or ""
                        ])
                course_counter += 1

        print(f"\n Done! Saved grouped course data to '{filename}'")
        print(f" Skipped {skipped_courses} course blocks with no session table")

    async def close_browser(self):
        """Closes the browser session."""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        print(" Browser closed.")

    async def run(self, headless=True):
        # Full scraping pipeline: login, apply filters, scrape, and close browser
        try:
            await self.start_browser(headless)
            await self.login()
            await self.navigate_to_courses()
            await self.apply_filters()
            await self.scrape_courses(self.csv_filename)
        finally:
            await self.close_browser()

    def verify_credentials(self):
        async def _check():
            try:
                await self.start_browser(headless=True)
                await self.login()
                return True
            except Exception:
                return False
            finally:
                await self.close_browser()
        return asyncio.run(_check())


def check_timing_changes(csv_filename="course_offerings.csv"):
    """
    Checks for timing changes by comparing the live CSV against a single
    semester-level backup file (backup_<csv_filename>) in the current directory.
    """
    # Read current data
    if not os.path.exists(csv_filename):
        return ["Current course data not found."]

    with open(csv_filename, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        current_rows = list(reader)

    # Determine backup filename
    sem_backup_name = f"backup_{os.path.basename(csv_filename)}"

    # On first run, create backup and exit
    if not os.path.exists(sem_backup_name):
        with open(sem_backup_name, 'w', newline='', encoding='utf-8') as sb:
            writer = csv.DictWriter(sb, fieldnames=current_rows[0].keys())
            writer.writeheader()
            writer.writerows(current_rows)
        return []  # No previous data to compare

    # Load backup data
    with open(sem_backup_name, newline='', encoding='utf-8') as bf:
        backup_rows = list(csv.DictReader(bf))

    # Helper: group rows by course code
    def group_by_course(rows):
        groups = {}
        last_code = None
        for row in rows:
            code = row['Course'].strip() or last_code
            if not code:
                continue
            groups.setdefault(code, []).append(row)
            last_code = code
        return groups

    current_groups = group_by_course(current_rows)
    backup_groups  = group_by_course(backup_rows)

    changes = []

    # Compare each course
    for code, cur_sessions in current_groups.items():
        back_sessions = backup_groups.get(code, [])
        for idx, cur in enumerate(cur_sessions):
            cur_start = cur.get('Start Time','').strip()
            cur_end   = cur.get('End Time','').strip()
            if idx < len(back_sessions):
                back = back_sessions[idx]
                back_start = back.get('Start Time','').strip()
                back_end   = back.get('End Time','').strip()
                if cur_start != back_start or cur_end != back_end:
                    changes.append(
                        f"Course {code} session {idx+1} changed: "
                        f"new {cur_start}-{cur_end}, was {back_start}-{back_end}"
                    )
            else:
                changes.append(
                    f"Course {code} session {idx+1} is new: {cur_start}-{cur_end}"
                )

    # Overwrite semester backup for next comparison
    with open(sem_backup_name, 'w', newline='', encoding='utf-8') as sb:
        writer = csv.DictWriter(sb, fieldnames=current_rows[0].keys())
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