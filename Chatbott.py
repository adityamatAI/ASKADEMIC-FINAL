import sys
import os
import asyncio
import streamlit as st
import pandas as pd
import nest_asyncio
from pydantic import BaseModel, ValidationError
from Projectt import CUDScraper, check_timing_changes
import itertools
import re
import matplotlib.pyplot as plt
import datetime

# Async setup for Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    nest_asyncio.apply()

# Display title in red
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

    # ensure we rename before ffill
    colmap = {
        "Course": "full_code",
        "Course Name": "course_name",
        "Credits": "credits",
        "Instructor": "instructor",
        "Room": "room",
        "Days": "days",
        "Start Time": "start_time",
        "End Time": "end_time",
        "Max Enrollment": "max_enrollment",
        "Total Enrollment": "total_enrollment"
    }
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
    if os.path.exists(fname):
        os.remove(fname)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    scraper = CUDScraper(user, pwd, sem, csv_filename=fname)
    loop.run_until_complete(scraper.run(headless=True))

def plot_schedule(sections: list[Section]):
    days = ['M','T','W','R','F']
    day_idx = {d: i for i,d in enumerate(days)}
    min_t = min(s for sec in sections for *_,s,_ in sec.timeslots)
    max_t = max(e for sec in sections for *_,_,e in sec.timeslots)

    fig, ax = plt.subplots(figsize=(10,6))
    cmap = plt.get_cmap('tab20')
    colors = {code: cmap(i%cmap.N) for i,code in enumerate({sec.course_code for sec in sections})}

    for sec in sections:
        for d,_,_,s,e in sec.timeslots:
            rect = plt.Rectangle((day_idx[d],s),1,e-s,
                                 facecolor=colors[sec.course_code],
                                 edgecolor='black', alpha=0.8)
            ax.add_patch(rect)
            ax.text(day_idx[d]+0.5, s+(e-s)/2, sec.course_code,
                    ha='center', va='center', color='white')

    ax.set_xlim(0, len(days))
    ax.set_ylim(max_t, min_t)
    ax.set_xticks([i+0.5 for i in range(len(days))])
    ax.set_xticklabels(days)
    yticks = []
    t = int(min_t*2)/2
    while t <= max_t:
        yticks.append(t); t += 0.5
    ax.set_yticks(yticks)
    ax.set_yticklabels([f"{int(v):02d}:{int((v-int(v))*60):02d}" for v in yticks])
    ax.set_xlabel('Day'); ax.set_ylabel('Time')
    plt.tight_layout()
    return fig

def count_morning_classes(schedule, cutoff: float) -> int:
    return sum(1 for sec in schedule for *_,start,_ in sec.timeslots if start < cutoff)
def count_evening_classes(schedule, cutoff: float) -> int:
    return sum(1 for sec in schedule for *_,start,_ in sec.timeslots if start > cutoff)
def count_friday_classes(schedule) -> int:
    return sum(1 for sec in schedule for day,*_ in sec.timeslots if day=='F')
def count_back_to_back(schedule) -> int:
    cnt, days = 0, {}
    for sec in schedule:
        for d,_,_,s,e in sec.timeslots:
            days.setdefault(d,[]).append((s,e))
    for times in days.values():
        times.sort(); prev=None
        for s,e in times:
            if prev is not None and s<=prev: cnt +=1
            prev=e
    return cnt
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

    # LOGIN PAGE
    if st.session_state.page == 'login':
        user = st.text_input('Username', key='u')
        pwd  = st.text_input('Password', type='password', key='p')
        term = st.selectbox('Term', list({'FA 2024-25':'71','SP 2024-25':'72',
                                          'SU 2024-25':'73','FA 2025-26':'75'}.keys()), key='t')
        if st.button('Login'):
            if user and pwd:
                sem_code = {'FA 2024-25':'71','SP 2024-25':'72',
                            'SU 2024-25':'73','FA 2025-26':'75'}[term]
                csv_file = f"course_offerings_{sem_code}.csv"
                with st.spinner("Verifying credentials…"):
                    valid = CUDScraper(user, pwd, sem_code, csv_filename=csv_file).verify_credentials()
                if valid:
                    st.session_state.update({
                        'username': user,
                        'password': pwd,
                        'sem': sem_code,
                        'page': 'dash'
                    })
                    return
                else:
                    st.error("Login failed. Check credentials.")
            else:
                st.error("Enter username and password.")
        return  # stop until reload

    # DASHBOARD
    if st.sidebar.button('Logout'):
          st.session_state.page = 'login'
          return

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
    st.sidebar.markdown("_Makes schedules that best match your preferences_")

    csv_file = f"course_offerings_{st.session_state.sem}.csv"
    if not os.path.exists(csv_file):
        with st.spinner("Retrieving course data…"):
            run_scraper(st.session_state.username, st.session_state.password,
                        st.session_state.sem, csv_file)
        st.success("Course data scraped.")

    st.header("Course Dashboard")
    sessions = load_sessions(csv_file)
    if not sessions:
        st.error("Failed to load data.")
        return

    df = pd.DataFrame([s.model_dump() for s in sessions])
    df['base_code'] = df['full_code'].apply(get_base_code)

    st.subheader(f"Term: {st.session_state.sem}")
    if st.button("Check Timing Changes"):
        run_scraper(st.session_state.username, st.session_state.password,
                    st.session_state.sem, csv_file)
        changes = check_timing_changes(csv_filename=csv_file)
        if changes:
            st.warning("Changes:")
            for c in changes:
                st.write(f"- {c}")
        else:
            st.success("No changes")

    unique = df[['base_code','course_name']].drop_duplicates('base_code')
    unique['label'] = unique.apply(lambda r: f"{r.base_code} — {r.course_name}", axis=1)
    picks = st.multiselect("Select Courses", unique['label'])

    if st.button("Generate"):
        codes = [p.split(" — ")[0] for p in picks]
        if not codes:
            st.warning("Pick courses")
            return
        cds = {}
        for c in codes:
            sub = df[df['base_code']==c]
            secs=[]
            for lec,grp in sub.groupby('full_code'):
                tsl=[]
                for _,r in grp.iterrows():
                    for d in r['days'].replace(',',''):
                        s=parse_time(r['start_time']); e=parse_time(r['end_time'])
                        tsl.append((d,r['start_time'],r['end_time'],s,e))
                if tsl: secs.append(Section(c,lec,tsl))
            cds[c]=secs
        scheds=generate_schedules(cds)
        scores=[score_schedule(s,no_before,no_after,avoid_friday,avoid_b2b,minimize_days,
                               before_cutoff,after_cutoff) for s in scheds]
        m=min(scores)
        st.session_state.best_schedules=[s for s,sc in zip(scheds,scores) if sc==m]
        st.session_state.idx=0

    if 'best_schedules' in st.session_state and st.session_state.best_schedules:
        best=st.session_state.best_schedules; total=len(best); idx=st.session_state.idx
        c1,_,c3=st.columns([1,6,1])
        with c1:
            if st.button("◀ Prev"): st.session_state.idx=max(0,idx-1)
        with c3:
            if st.button("Next ▶"): st.session_state.idx=min(total-1,idx+1)
        sched=best[idx]
        st.subheader(f"Best Schedule {idx+1} of {total}")
        st.write("**Lectures:** " + ", ".join(f"{sec.course_code}:{sec.section_id}" for sec in sched))
        st.pyplot(plot_schedule(sched))

if __name__=='__main__':
    main()
