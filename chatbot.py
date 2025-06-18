import sys
import os
import asyncio
import streamlit as st
import pandas as pd
import nest_asyncio
from pydantic import BaseModel, ValidationError
from scraper import CUDScraper, check_timing_changes
import itertools
import re
import matplotlib.pyplot as plt
import datetime
import subprocess


@st.cache_resource
def install_playwright_browser():
    """
    Installs the Playwright Chromium browser if not already installed.
    The @st.cache_resource decorator ensures this is only run once.
    """
    # We run the command with subprocess.
    # We only need chromium for this app.
    subprocess.run(["playwright", "install", "chromium"], check=True)

# Call the function to ensure the browser is installed before any scraper code runs.
install_playwright_browser()

# Async setup for Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    nest_asyncio.apply()

# App Title
def show_app_title():
    st.markdown("<h1 style='color:red;'>ASKADEMIC</h1>", unsafe_allow_html=True)

# Data models
tuple5 = tuple[str, str, str, float, float]

class Session(BaseModel):
    full_code: str
    course_name: str
    credits: str
    instructor: str
    room: str
    days: str
    start_time: str
    end_time: str
    max_enrollment: str
    total_enrollment: str

class Section:
    def __init__(self, course_code: str, section_id: str, timeslots: list[tuple5]):
        self.course_code = course_code
        self.section_id = section_id
        self.timeslots = timeslots
    def conflicts_with(self, other: 'Section') -> bool:
        for d1, *_ , s1, e1 in self.timeslots:
            for d2, *_ , s2, e2 in other.timeslots:
                if d1 == d2 and e1 > s2 and e2 > s1:
                    return True
        return False

def generate_schedules(courses: dict[str, list[Section]]) -> list[list[Section]]:
    combos = itertools.product(*(courses[code] for code in courses))
    return [list(c) for c in combos
            if all(not s1.conflicts_with(s2)
                   for s1, s2 in itertools.combinations(c, 2))]

def parse_time(t: str) -> float:
    try:
        dt = pd.to_datetime(t).time()
        return dt.hour + dt.minute/60.0
    except:
        return 0.0

def get_base_code(full_code: str) -> str:
    m = re.match(r"^([A-Za-z]+\d+)", full_code)
    return m.group(1) if m else full_code

def load_sessions(filename: str) -> list[Session]:
    if not os.path.exists(filename):
        return []
    df = pd.read_csv(filename, dtype=str)
    df.fillna("", inplace=True)
    colmap = {"Course":"full_code","Course Name":"course_name","Credits":"credits",
              "Instructor":"instructor","Room":"room","Days":"days",
              "Start Time":"start_time","End Time":"end_time",
              "Max Enrollment":"max_enrollment","Total Enrollment":"total_enrollment"}
    df.rename(columns=colmap, inplace=True)
    if "full_code" in df.columns:
        df["full_code"] = df["full_code"].replace("", pd.NA).ffill()
    else:
        st.error("CSV missing 'Course' column.")
        return []
    sessions = []
    for row in df.to_dict(orient="records"):
        try:
            sessions.append(Session(**row))
        except ValidationError as e:
            st.warning(f"Invalid session data: {e}")
    return sessions

def run_scraper(user: str, pwd: str, sem: str, fname: str) -> None:
    if os.path.exists(fname): os.remove(fname)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    scraper = CUDScraper(user, pwd, sem, csv_filename=fname)
    loop.run_until_complete(scraper.run(headless=True))

def plot_schedule(sections: list[Section]):
    days = ['M','T','W','R','F']
    day_idx = {d:i for i,d in enumerate(days)}
    min_t = min(s for sec in sections for *_,s,_ in sec.timeslots) if any(sec.timeslots for sec in sections) else 8
    max_t = max(e for sec in sections for *_,_,e in sec.timeslots) if any(sec.timeslots for sec in sections) else 18
    fig, ax = plt.subplots(figsize=(10,6))
    cmap = plt.get_cmap('tab20')
    colors = {code:cmap(i%cmap.N) for i,code in enumerate({sec.course_code for sec in sections})}
    for sec in sections:
        for d,_,_,s,e in sec.timeslots:
            ax.add_patch(plt.Rectangle((day_idx[d],s),1,e-s,facecolor=colors[sec.course_code],edgecolor='black',alpha=0.8))
            ax.text(day_idx[d]+0.5,s+(e-s)/2,sec.course_code,ha='center',va='center',color='white')
    ax.set_xlim(0,len(days)); ax.set_ylim(max_t,min_t)
    ax.set_xticks([i+0.5 for i in range(len(days))]); ax.set_xticklabels(days)
    yticks=[]; t=int(min_t*2)/2
    while t<=max_t: yticks.append(t); t+=0.5
    ax.set_yticks(yticks); ax.set_yticklabels([f"{int(v):02d}:{int((v-int(v))*60):02d}" for v in yticks])
    ax.set_xlabel('Day'); ax.set_ylabel('Time'); plt.tight_layout()
    return fig

def count_morning_classes(schedule, cutoff: float) -> int:
    return sum(1 for sec in schedule for *_,start,_ in sec.timeslots if start < cutoff)

def count_evening_classes(schedule, cutoff: float) -> int:
    return sum(1 for sec in schedule for *_,start,_ in sec.timeslots if start > cutoff)

def count_friday_classes(schedule) -> int:
    return sum(1 for sec in schedule for day,*_ in sec.timeslots if day=='F')

def count_back_to_back(schedule) -> int:
    """
    Counts pairs of classes that are "back-to-back".

    This function implements the user's specific definition:
    A pair is back-to-back if the time gap between the end of one class
    and the start of the next is less than 1.5 minutes.

    This correctly penalizes:
    - Case 1: End at 11:00, Start at 11:00 (0-minute gap).
    - Case 2: End at 10:59, Start at 11:00 (1-minute gap).

    It assumes the schedule has already been pre-filtered for true overlaps.
    """
    back_to_back_count = 0
    daily_timeslots = {}
    
    # A tolerance of 1.5 minutes, converted to the float representation of hours.
    # (1.5 / 60.0) = 0.025
    MINIMUM_GAP_TOLERANCE = 1.5 / 60.0

    # 1. Group all class times by the day of the week.
    for section in schedule:
        for day, _, _, start_time, end_time in section.timeslots:
            daily_timeslots.setdefault(day, []).append((start_time, end_time))

    # 2. For each day, check for back-to-back instances.
    for day, timeslots in daily_timeslots.items():
        if len(timeslots) < 2:
            continue

        # 3. Sort the classes chronologically by their start time.
        sorted_times = sorted(timeslots)
        
        # 4. Compare each class with the one immediately preceding it.
        for i in range(1, len(sorted_times)):
            previous_end_time = sorted_times[i-1][1]
            current_start_time = sorted_times[i][0]
            
            # 5. Check if the gap is smaller than our defined tolerance.
            if (current_start_time - previous_end_time) < MINIMUM_GAP_TOLERANCE:
                back_to_back_count += 1
                
    return back_to_back_count

def count_days_used(schedule) -> int:
    return len({d for sec in schedule for d,*_ in sec.timeslots})

def score_schedule(schedule, no_before: bool, no_after: bool,
                   avoid_friday: bool, avoid_back_to_back: bool,
                   minimize_days: bool, before_cutoff: float,
                   after_cutoff: float) -> int:
    score = 0
    if no_before: score += count_morning_classes(schedule, before_cutoff)
    if no_after:  score += count_evening_classes(schedule, after_cutoff)
    if avoid_friday: score += count_friday_classes(schedule)
    if avoid_back_to_back: score += count_back_to_back(schedule)
    if minimize_days: score += count_days_used(schedule)
    return score

def main():
    show_app_title()
    if 'page' not in st.session_state:
        st.session_state.page = 'login'

    if st.session_state.page == 'login':
        user = st.text_input('Username', key='u')
        pwd  = st.text_input('Password', type='password', key='p')
        term = st.selectbox('Term', list({'FA 2025-26':'75'}.keys()), key='t')

        if st.button('Login'):
            if not (user and pwd):
                st.error('Enter username and password.')
            else:
                sem_map = {'FA 2025-26':'75'}
                sem_code = sem_map.get(term)
                if not sem_code:
                    st.error(f'Unknown term: {term}')
                else:
                    with st.spinner('Verifying credentials…'):
                        # --- THIS IS THE FIX ---
                        # We removed the try...except block here.
                        # verify_credentials() now safely returns True or False.
                        ok = CUDScraper(user, pwd, sem_code).verify_credentials()
                    
                    if ok:
                        st.session_state.sem = sem_code
                        st.session_state.username = user
                        st.session_state.password = pwd
                        st.session_state.page = 'dash'
                        st.rerun() 
                    else:
                        # This will now only show a single, clean error message on failure.
                        st.error('Invalid credentials.')
        return

    if st.session_state.page == 'dash':
        if st.sidebar.button('Logout'):
            for k in ['username','password','sem','best_schedules','idx']:
                st.session_state.pop(k, None)
            st.session_state.page = 'login'
            st.rerun()

        st.sidebar.header('Schedule Preferences')
        no_before = st.sidebar.checkbox('No classes before:')
        if no_before:
            t0 = st.sidebar.time_input('Start before', value=datetime.time(11,0))
            before_cutoff = t0.hour + t0.minute/60.0
        else:
            before_cutoff = 0.0
        no_after = st.sidebar.checkbox('No classes after:')
        if no_after:
            t1 = st.sidebar.time_input('End after', value=datetime.time(17,0))
            after_cutoff = t1.hour + t1.minute/60.0
        else:
            after_cutoff = 24.0
        avoid_friday = st.sidebar.checkbox('No Friday classes')
        avoid_b2b = st.sidebar.checkbox('No back-to-back classes')
        minimize_days = st.sidebar.checkbox('Minimize days')
        st.sidebar.markdown('_Makes schedules that best match your preferences_')

        csv_file = f"course_offerings_{st.session_state.sem}.csv"
        if not os.path.exists(csv_file):
            with st.spinner('Retrieving course data…'):
                run_scraper(st.session_state.username, st.session_state.password, st.session_state.sem, csv_file)
            st.success('Course data scraped.')

        sessions = load_sessions(csv_file)
        if not sessions:
            st.error('Failed to load data.')
            return

        df = pd.DataFrame([s.model_dump() for s in sessions])
        df['base_code'] = df['full_code'].apply(get_base_code)

        st.header('Course Dashboard')
        st.subheader(f"Term: {st.session_state.sem}")
        if st.button('Check Timing Changes'):
            run_scraper(st.session_state.username, st.session_state.password, st.session_state.sem, csv_file)
            changes = check_timing_changes(csv_filename=csv_file)
            if changes:
                st.warning('Changes:')
                for c in changes:
                    st.write(f'- {c}')
            else:
                st.success('No changes')

        unique = df[['base_code','course_name']].drop_duplicates('base_code')
        unique['label'] = unique.apply(lambda r: f"{r.base_code} — {r.course_name}", axis=1)
        picks = st.multiselect('Select Courses', unique['label'])

        if st.button('Generate'):
            codes = [p.split(' — ')[0] for p in picks]
            if not codes:
                st.warning('Pick courses')
            else:
                cds = {}
                for c in codes:
                    sub = df[df['base_code']==c]
                    secs = []
                    for lec, grp in sub.groupby('full_code'):
                        tsl = []
                        for _, r in grp.iterrows():
                            for d in r['days'].replace(',',''):
                                s = parse_time(r['start_time'])
                                e = parse_time(r['end_time'])
                                tsl.append((d, r['start_time'], r['end_time'], s, e))
                        if tsl:
                            secs.append(Section(c, lec, tsl))
                    cds[c] = secs
                scheds = generate_schedules(cds)
                if scheds:
                    scores = [score_schedule(s, no_before, no_after, avoid_friday, avoid_b2b, minimize_days, before_cutoff, after_cutoff) for s in scheds]
                    m = min(scores)
                    st.session_state.best_schedules = [s for s, sc in zip(scheds, scores) if sc == m]
                    st.session_state.idx = 0
                else:
                    st.warning('No possible schedules')

        if 'best_schedules' in st.session_state and st.session_state.best_schedules:
            best = st.session_state.best_schedules
            total = len(best)
            idx = st.session_state.idx
            c1, _, c3 = st.columns([1,6,1])
            with c1:
                if st.button('◀ Prev'):
                    st.session_state.idx = max(0, idx-1)
            with c3:
                if st.button('Next ▶'):
                    st.session_state.idx = min(total-1, idx+1)
            
            idx = st.session_state.idx
            sched = best[idx]
            
            st.subheader(f'Best Schedule {idx+1} of {total}')
            st.write('**Lectures:** ' + ', '.join(f"{sec.course_code}:{sec.section_id}" for sec in sched))
            st.pyplot(plot_schedule(sched))

if __name__ == '__main__':
    main()