from playwright.async_api import async_playwright
import asyncio
import csv
import os
import re

class CUDScraper:
    def __init__(self, username, password, semester, csv_filename="course_offerings.csv"):
        self.username = username
        self.password = password
        self.semester = semester
        self.url = "https://cudportal.cud.ac.ae/student/login.asp"
        self.playwright = None
        self.browser = None
        self.page = None
        self.csv_filename = csv_filename

    async def start_browser(self, headless=True):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=headless)
        self.page = await self.browser.new_page()

    async def login(self):
        try:
            await self.page.goto(self.url, timeout=15000)
            await self.page.fill("#txtUsername", self.username)
            await self.page.fill("#txtPassword", self.password)
            await self.page.wait_for_selector("#idterm", timeout=10000)
            await self.page.select_option("#idterm", self.semester)

            loop = asyncio.get_running_loop()
            dialog_future = loop.create_future()

            async def handle_dialog(dialog):
                if not dialog_future.done():
                    dialog_future.set_result(dialog.message)
                await dialog.accept()

            self.page.on("dialog", handle_dialog)

            try:
                await self.page.click("#btnLogin")
                success_task = asyncio.create_task(self.page.wait_for_url("**/student/index.asp**", timeout=15000))
                failure_task = dialog_future
                done, pending = await asyncio.wait([success_task, failure_task], return_when=asyncio.FIRST_COMPLETED)

                for task in pending:
                    task.cancel()

                if failure_task in done:
                    error_message = failure_task.result()
                    if "Invalid authorization credentials" in error_message:
                        raise RuntimeError("Invalid credentials provided.")
                    else:
                        raise RuntimeError(f"An unexpected dialog appeared: {error_message}")

                if success_task in done:
                    await success_task
                    print("Login successful.")
                    return
            finally:
                self.page.remove_listener("dialog", handle_dialog)
        except Exception as e:
            if "Invalid credentials provided." in str(e):
                raise e
            raise RuntimeError(f"Login process failed: {e}")

    def verify_credentials(self):
        async def _check():
            try:
                await self.start_browser(headless=True)
                await self.login()
                return True
            except RuntimeError as e:
                if "Invalid credentials provided." in str(e):
                    return False
                else:
                    raise e
            finally:
                await self.close_browser()
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(_check())
        except Exception as e:
            raise RuntimeError(f"An unexpected error occurred during verification: {e}")

    async def navigate_to_courses(self):
        await self.page.click("text=Course Offering")
        await self.page.wait_for_selector("#displayFilter")

    async def apply_filters(self):
        pass

    async def scrape_courses(self, filename=None):
        if filename is None:
            filename = self.csv_filename
        courses_dict = {}
        total_pages = 1
        try:
            info = await self.page.query_selector("text=Viewing Page")
            if info:
                txt = await info.inner_text()
                m = re.search(r'Total Pages:\s*(\d+)', txt)
                if m:
                    total_pages = int(m.group(1))
        except:
            total_pages = 1
        page_num = 1
        while page_num <= total_pages:
            rows = await self.page.query_selector_all(".Portal_Group_Table tbody tr")
            i = 0
            while i < len(rows):
                main_row = rows[i]
                cells = await main_row.query_selector_all("td")
                if len(cells) < 3:
                    i += 1
                    continue
                code = (await cells[0].inner_text()).strip()
                name = (await cells[1].inner_text()).strip()
                credits = (await cells[2].inner_text()).strip()
                session_row = None
                if i + 1 < len(rows):
                    poss = rows[i + 1]
                    if await poss.query_selector("table"):
                        session_row = poss
                        i += 2
                    else:
                        i += 1
                else:
                    i += 1
                if not session_row:
                    continue
                for tr in (await session_row.query_selector_all("tr"))[1:]:
                    td = await tr.query_selector_all("td")
                    if len(td) < 9:
                        continue
                    instr = (await td[1].inner_text()).strip()
                    room = (await td[2].inner_text()).strip()
                    days = (await td[3].inner_text()).strip()
                    start = (await td[5].inner_text()).strip()
                    end = (await td[6].inner_text()).strip()
                    max_e = (await td[7].inner_text()).strip()
                    tot_e = (await td[8].inner_text()).strip()
                    courses_dict.setdefault(code, {"course_name": name, "credits": credits, "sessions": []})["sessions"].append({
                        "instructor": instr, "room": room, "days": days,
                        "start_time": start, "end_time": end,
                        "max_enroll": max_e, "total_enroll": tot_e
                    })
            if page_num < total_pages:
                try:
                    next_num = page_num + 1
                    link = self.page.get_by_role("link", name=str(next_num)).first
                    await link.click()
                    await self.page.wait_for_selector(".Portal_Group_Table")
                except:
                    break
            page_num += 1
        with open(filename, "w", newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(["No.", "Course", "Course Name", "Credits", "Instructor", "Room", "Days", "Start Time", "End Time", "Max Enrollment", "Total Enrollment"])
            cnt = 1
            for code, info in courses_dict.items():
                first = True
                for s in info["sessions"]:
                    if first:
                        w.writerow([cnt, code, info["course_name"], info["credits"], s["instructor"], s["room"], s["days"], s["start_time"], s["end_time"], s["max_enroll"], s["total_enroll"]])
                        first = False
                    else:
                        w.writerow(["", "", "", "", s["instructor"], s["room"], s["days"], s["start_time"], s["end_time"], s["max_enroll"], s["total_enroll"]])
                cnt += 1

    async def close_browser(self):
        if self.browser and self.browser.is_connected():
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def run(self, headless=True):
        try:
            await self.start_browser(headless=headless)
            await self.login()
            await self.navigate_to_courses()
            await self.apply_filters()
            await self.scrape_courses()
        finally:
            await self.close_browser()

def check_timing_changes(csv_filename="course_offerings.csv"):
    if not os.path.exists(csv_filename):
        return ["Current course data not found."]
    with open(csv_filename, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        current_rows = list(reader)
    sem_backup_name = f"backup_{os.path.basename(csv_filename)}"
    if not os.path.exists(sem_backup_name):
        with open(sem_backup_name, 'w', newline='', encoding='utf-8') as sb:
            writer = csv.DictWriter(sb, fieldnames=current_rows[0].keys())
            writer.writeheader()
            writer.writerows(current_rows)
        return []
    with open(sem_backup_name, newline='', encoding='utf-8') as bf:
        backup_rows = list(csv.DictReader(bf))
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
    backup_groups = group_by_course(backup_rows)
    changes = []
    for code, cur_sessions in current_groups.items():
        back_sessions = backup_groups.get(code, [])
        for idx, cur in enumerate(cur_sessions):
            cur_start = cur.get('Start Time', '').strip()
            cur_end = cur.get('End Time', '').strip()
            if idx < len(back_sessions):
                back = back_sessions[idx]
                back_start = back.get('Start Time', '').strip()
                back_end = back.get('End Time', '').strip()
                if cur_start != back_start or cur_end != back_end:
                    changes.append(f"Course {code} session {idx + 1} changed: new {cur_start}-{cur_end}, was {back_start}-{back_end}")
            else:
                changes.append(f"Course {code} session {idx + 1} is new: {cur_start}-{cur_end}")
    with open(sem_backup_name, 'w', newline='', encoding='utf-8') as sb:
        writer = csv.DictWriter(sb, fieldnames=current_rows[0].keys())
        writer.writeheader()
        writer.writerows(current_rows)
    return changes

# This block is for testing the script directly from the command line.
# It is NOT used when the Streamlit app imports this file.
if __name__ == "__main__":
    pass