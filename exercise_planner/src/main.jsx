import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  LayoutDashboard,
  Dumbbell,
  Utensils,
  Sparkles,
  Settings,
  LogOut,
  Plus,
  Flame,
  Droplets,
  Clock,
  MoreHorizontal,
  Leaf,
  X,
  Users,
  Upload,
  TrendingUp,
  LoaderCircle,
  AlertCircle,
  KeyRound,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { api, localDate, dateObject, labelDate, shiftDate } from "./api";
import PlanCards from "./PlanCards";
import GuidePage, { TaskGuides } from "./Guide";
import StaticPages from "./StaticPages";
import { guideRoute } from "./library";
import { MACRO_LABELS } from "./quantities";
import "./style.css";
const DEFAULT_PROFILE = {
  name: "Sample User",
  email: "admin@example.com",
  focus: ["Physique", "Overall wellness", "Skin care", "Hair care"],
  body_areas: ["Arms", "Legs", "Torso"],
  custom_area: "Core stability and balanced strength",
  diet: ["Vegetarian"],
  allergies: "None",
  weight: 75,
  height: 175,
  age: 29,
  level: "Beginner",
  goal: "Maintain & feel better",
  skin_type: "Combination",
  hair_type: "Wavy",
  care_early: false,
  equipment: "Gym access with dumbbells, bench, treadmill and cable machine",
  limitations: "No known limitations",
  notifications: true,
  timezone: "Asia/Kolkata",
};
const ACTIVE = ["queued", "generating", "reviewing", "revising"];
const NAV = [
  [LayoutDashboard, "Overview"],
  [CalendarDays, "My calendar"],
  [Dumbbell, "Workout plan"],
  [Utensils, "Meal plan"],
  [Sparkles, "Care routines"],
  [TrendingUp, "Progress"],
];
const ADMIN_PAGES = ["Users", "Static pages"];
const ADMIN_NAV = [
  [Users, "Users"],
  [BookOpen, "Static pages"],
];
const statusKey = (date, id) => `${date}/${id}`;
function App() {
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("forma.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobileViewport, setMobileViewport] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [planView, setPlanView] = useState(() => {
    try {
      return localStorage.getItem("forma.planView") === "minimal"
        ? "minimal"
        : "cards";
    } catch {
      return "cards";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("forma.planView", planView);
    } catch {
      // The view still switches when browser storage is unavailable.
    }
  }, [planView]);
  const sidebarCollapsed = mobileViewport
    ? !mobileSidebarOpen
    : desktopSidebarCollapsed;
  useEffect(() => {
    try {
      localStorage.setItem(
        "forma.sidebarCollapsed",
        String(desktopSidebarCollapsed),
      );
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
  }, [desktopSidebarCollapsed]);
  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 900px)");
    const resize = (event) => {
      setMobileViewport(event.matches);
      setMobileSidebarOpen(false);
    };
    viewport.addEventListener("change", resize);
    return () => viewport.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const close = (event) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileSidebarOpen]);
  const [history, setHistory] = useState([]);
  const [preferences, setPreferences] = useState([]),
    [adjustmentDays, setAdjustmentDays] = useState(7);
  const [account, setAccount] = useState(null),
    [profile, setProfile] = useState(null),
    [plan, setPlan] = useState(null),
    [job, setJob] = useState(null);
  const [page, setPage] = useState("Overview"),
    [modal, setModal] = useState(null),
    [date, setDate] = useState(localDate()),
    [statuses, setStatuses] = useState({}),
    [checkins, setCheckins] = useState({}),
    [media, setMedia] = useState([]),
    [notifications, setNotifications] = useState([]);
  const [form, setForm] = useState(DEFAULT_PROFILE),
    [step, setStep] = useState(1),
    [files, setFiles] = useState({ equipment: [], body: [] }),
    [tab, setTab] = useState("All activities"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [users, setUsers] = useState([]),
    [credentials, setCredentials] = useState(null),
    [impersonating, setImpersonating] = useState(false),
    [selectedTask, setSelectedTask] = useState(null);
  const isAdmin = account?.role === "admin";
  useEffect(() => {
    if (isAdmin && !ADMIN_PAGES.includes(page)) setPage("Users");
  }, [isAdmin, page]);
  const noticeTimer = useRef();
  const toast = (message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 5000);
  };
  function reset() {
    setAccount(null);
    setProfile(null);
    setPlan(null);
    setJob(null);
    setStatuses({});
    setCheckins({});
    setHistory([]);
    setPreferences([]);
    setMedia([]);
    setNotifications([]);
    setUsers([]);
    setPage("Overview");
    setImpersonating(false);
    setCredentials(null);
    setError("");
  }
  async function refresh() {
    const me = await api("/me");
    setImpersonating(Boolean(me.impersonating));
    setAccount(me.account);
    setProfile(me.profile);
    setPlan(me.plan);
    setJob(me.job);
    setNotifications(me.notifications);
    setPreferences(me.preferences || []);
    if (me.account.role === "admin") {
      // Platform staff: no plan or tracking of their own.
      setUsers(await api("/admin/users"));
      setStatuses({});
      setCheckins({});
      setMedia([]);
      setHistory([]);
      return me;
    }
    {
      const [tracking, photos] = await Promise.all([
        api("/progress"),
        api("/media"),
      ]);
      setStatuses(
        Object.fromEntries(
          tracking.statuses.map((s) => [
            statusKey(s.date, s.task_id),
            s.status,
          ]),
        ),
      );
      setCheckins(
        Object.fromEntries(tracking.checkins.map((c) => [c.date, c])),
      );
      setMedia(photos);
      setHistory(tracking.history || []);
    }
    return me;
  }
  useEffect(() => {
    let alive = true;
    api("/me")
      .then(async () => {
        if (alive) {
          const me = await refresh();
          if (me.account.role === "admin") setPage("Users");
        }
      })
      .catch((e) => {
        if (e.status !== 401 && alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(noticeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!job || !ACTIVE.includes(job.status)) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const next = await api("/jobs/" + job.id);
        if (cancelled) return;
        setJob(next);
        if (next.status === "completed") {
          const me = await refresh();
          if (next.action !== "generate" && me.plan?.last_change)
            setDate(me.plan.last_change.start_date);
          toast(next.message || "Your reviewed plan is ready.");
        } else if (next.status === "failed") setError(next.message);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [job?.id, job?.status]);
  async function action(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function openOnboarding() {
    setForm({
      ...DEFAULT_PROFILE,
      ...profile,
      name: profile?.name || account?.name || "",
      email: profile?.email || account?.email || "",
    });
    setStep(1);
    setFiles({ equipment: [], body: [] });
    setModal("onboarding");
    setError("");
  }
  async function signup(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await action(async () => {
      const result = await api("/auth/signup", {
        method: "POST",
        body: values,
      });
      setAccount(result.account);
      setForm({
        ...DEFAULT_PROFILE,
        name: result.account.name,
        email: result.account.email,
      });
      setCredentials(result.generated_password);
      setStep(1);
      setModal("onboarding");
    });
  }
  async function login(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await action(async () => {
      await api("/auth/login", { method: "POST", body: values });
      setModal(null);
      await refresh();
      setPage("Overview");
      const me = await api("/me");
      if (me.account.role === "admin") setPage("Users");
      else if (!me.profile) {
        setForm({
          ...DEFAULT_PROFILE,
          name: me.account.name,
          email: me.account.email,
        });
        setStep(1);
        setModal("onboarding");
      }
    });
  }
  async function startPlanning() {
    const next = await api("/plans/generate", { method: "POST" });
    setJob(next);
    setPage("Overview");
    toast("Planning started. You can stay here while the agents work.");
  }
  async function retryPlanning() {
    const next = await api("/jobs/" + job.id + "/retry", { method: "POST" });
    setJob(next);
    toast("Retry started. Your saved preferences will be used.");
  }
  function openAdjustment(mode) {
    setAdjustmentDays(mode === "refine" ? Math.min(7, remainingDays) : 7);
    setError("");
    setModal(mode);
  }
  async function submitAdjustment(e) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const mode = modal;
    await action(async () => {
      const next = await api("/plans/" + mode, {
        method: "POST",
        body: { days: adjustmentDays, preferences: values.get("preferences") },
      });
      setJob(next);
      setModal(null);
      setPage("Overview");
      setPreferences(await api("/preferences"));
      toast("Your preferences are saved. Your plan update is being reviewed.");
    });
  }
  async function uploadFiles(kind, selectedFiles) {
    for (const file of selectedFiles) {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      body.append("selected_date", date);
      await api("/media", { method: "POST", body });
    }
    setMedia(await api("/media"));
  }
  async function submitOnboarding(e) {
    e.preventDefault();
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    await action(async () => {
      const body = {
        ...form,
        weight: Number(form.weight),
        height: Number(form.height),
        age: Number(form.age),
      };
      const saved = await api("/profile", { method: "PUT", body });
      setProfile(saved);
      setAccount({ ...account, name: saved.name, email: saved.email });
      for (const kind of ["equipment", "body"]) {
        await uploadFiles(kind, files[kind]);
        setFiles((f) => ({ ...f, [kind]: [] }));
      }
      await startPlanning();
      setModal(null);
    });
  }
  const days = plan?.days || [];
  const selectedDay = days.find((d) => d.date === date);
  const tasks = selectedDay?.tasks || [];
  const name = account?.name?.split(" ")[0] || "there";
  const water = checkins[date]?.water || 0;
  const completed = tasks.filter(
    (t) => statuses[statusKey(date, t.id)] === "completed",
  ).length;
  const skipped = tasks.filter(
    (t) => statuses[statusKey(date, t.id)] === "skipped",
  ).length;
  const adherence = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;
  const meals = tasks.filter((t) => t.role === "meal"),
    workouts = tasks.filter((t) => t.role === "workout");
  const week = selectedDay?.week || 1;
  const weekDays = days.filter((d) => d.week === week);
  const totalWeeks = Math.max(1, Math.ceil(days.length / 7));
  const remainingDays = Math.min(
    28,
    days.filter((d) => d.date >= localDate()).length,
  );
  const adjustmentStart =
    modal === "extend"
      ? [shiftDate(plan?.end_date || localDate(), 1), localDate()].sort().at(-1)
      : [plan?.start_date || localDate(), localDate()].sort().at(-1);
  const allCompleted = days.reduce(
    (n, d) =>
      n +
      d.tasks.filter((t) => statuses[statusKey(d.date, t.id)] === "completed")
        .length,
    0,
  );
  const dueDays = days.filter(
    (d) =>
      d.date <= localDate() ||
      d.tasks.some((t) => statuses[statusKey(d.date, t.id)]),
  );
  const dueTasks = dueDays.reduce((n, d) => n + d.tasks.length, 0);
  const activeDays = dueDays.filter((d) =>
    d.tasks.some((t) => statuses[statusKey(d.date, t.id)] === "completed"),
  ).length;
  const overall = dueTasks ? Math.round((allCompleted / dueTasks) * 100) : 0;
  const inProgress = job && ACTIVE.includes(job.status);
  const currentPhotos = media.filter(
    (m) => m.kind === "progress" && m.date === date,
  );
  async function mark(task, status) {
    await action(async () => {
      await api("/tasks/status", {
        method: "PUT",
        body: { date, task_id: task.id, status },
      });
      setStatuses((s) => ({ ...s, [statusKey(date, task.id)]: status }));
    });
  }
  async function saveWater(value) {
    await action(async () => {
      const body = {
        date,
        water: value,
        weight: checkins[date]?.weight || null,
        notes: checkins[date]?.notes || "",
      };
      await api("/checkins", { method: "PUT", body });
      setCheckins((c) => ({ ...c, [date]: body }));
    });
  }
  const visibleTasks = tasks.filter((t) =>
    page === "Workout plan"
      ? t.role === "workout"
      : page === "Meal plan"
        ? t.role === "meal"
        : page === "Care routines"
          ? t.role === "care"
          : tab === "Workouts"
            ? t.role === "workout"
            : tab === "Meals"
              ? t.role === "meal"
              : true,
  );
  const feedbackText =
    dueTasks === 0
      ? "Your first small win is waiting. Complete an activity to start tracking your rhythm."
      : overall >= 75
        ? "You’re building a steady rhythm. Keep the same sustainable pace and leave room for recovery."
        : overall >= 40
          ? "You’re making progress. Try choosing one meal and one movement activity to anchor each day."
          : "A fresh start is always available. Pick one manageable activity today and tell us what could make the plan fit better.";
  if (loading)
    return (
      <div className="loading-screen">
        <Activity size={40} />
        <LoaderCircle className="spin" />
        Opening your wellness space…
      </div>
    );
  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}${mobileSidebarOpen ? " mobile-sidebar-open" : ""}`}
    >
      {mobileSidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <aside>
        <div className="sidebar-heading">
          <a
            className="brand"
            aria-label="Forma home"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage(account?.role === "admin" ? "Users" : "Overview");
              setMobileSidebarOpen(false);
            }}
          >
            <span className="brand-mark">
              <Activity size={24} />
            </span>
            <span className="brand-name">
              forma<span className="brand-dot">.</span>
            </span>
          </a>
          <button
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="side-navigation"
            onClick={() =>
              mobileViewport
                ? setMobileSidebarOpen((open) => !open)
                : setDesktopSidebarCollapsed((collapsed) => !collapsed)
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
        </div>
        <div className="workspace">
          <div className="avatar small">{name[0].toUpperCase()}</div>
          <div>
            <b>{isAdmin ? "Administration" : "My wellness space"}</b>
            <small>
              {isAdmin
                ? "Platform management"
                : account
                  ? "Personal workspace"
                  : "Your next chapter"}
            </small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-label">{isAdmin ? "PLATFORM" : "YOUR SPACE"}</div>
        <nav id="side-navigation" aria-label="Main navigation">
          {(isAdmin ? ADMIN_NAV : NAV).map(([Icon, p]) => (
            <button
              className={page === p ? "active" : ""}
              key={p}
              aria-label={p}
              aria-current={page === p ? "page" : undefined}
              title={sidebarCollapsed ? p : undefined}
              onClick={() => {
                if (account) {
                  setPage(p);
                  window.scrollTo({ top: 0, behavior: "instant" });
                  if (p === "Overview") setDate(localDate());
                } else setModal("login");
                setMobileSidebarOpen(false);
              }}
            >
              <Icon size={19} />
              <span className="nav-text">{p}</span>
              {p === "Care routines" && !profile?.care_early && (
                <span className="soon">WEEK 3</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!isAdmin && (
            <div className="journey">
              <div className="journey-icon">
                <Leaf size={20} />
              </div>
              <b>A little better, every day.</b>
              <p>
                Small steps. Lasting change.
                <br />
                You’ve got this.
              </p>
              <span>
                YOUR WELLNESS JOURNEY <ArrowUpRight size={14} />
              </span>
              <div className="mini-track">
                <i
                  style={{
                    width: plan ? `${(week / totalWeeks) * 100}%` : "0%",
                  }}
                />
              </div>
              <small>
                {plan ? `Week ${week} of ${totalWeeks}` : "Made around you"}
              </small>
            </div>
          )}
          <button
            className="settings"
            aria-label="Settings"
            title={sidebarCollapsed ? "Settings" : undefined}
            onClick={() => {
              setModal(account ? "settings" : "login");
              setMobileSidebarOpen(false);
            }}
          >
            <Settings size={18} />
            <span className="nav-text">Settings</span>
          </button>
          <button
            className="profile"
            aria-label="Open account menu"
            title={sidebarCollapsed ? account?.name || "Sign in" : undefined}
            onClick={() => {
              setModal(account ? "settings" : "login");
              setMobileSidebarOpen(false);
            }}
          >
            <div className="avatar">{name[0].toUpperCase()}</div>
            <div>
              <b>{account?.name || "Your wellness journey"}</b>
              <small>
                {account?.role === "admin"
                  ? "Administrator"
                  : account
                    ? "Personal account"
                    : "Sign in to get started"}
              </small>
            </div>
            <MoreHorizontal size={20} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            {isAdmin ? "Administration" : "My wellness space"}{" "}
            <ChevronRight size={14} />
            <span>{account ? page : "Welcome"}</span>
          </div>
          <div className="header-right">
            <span className="live-dot" />
            {isAdmin
              ? "Platform administration"
              : account
                ? "Your personal wellness space"
                : "A plan that fits your life"}
            <button
              onClick={() => setModal(account ? "settings" : "login")}
              className="avatar small"
            >
              {name[0].toUpperCase()}
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {impersonating && (
            <div className="session-banner">
              Viewing {account?.name}’s workspace
              <button
                onClick={() =>
                  action(async () => {
                    await api("/admin/return", { method: "POST" });
                    setImpersonating(false);
                    await refresh();
                    setPage("Users");
                  })
                }
              >
                Return to admin <ArrowRight size={15} />
              </button>
            </div>
          )}
          {!account ? (
            <div className="welcome">
              <div className="welcome-copy">
                <span className="pill">
                  <span /> PERSONAL WELLNESS, SIMPLIFIED
                </span>
                <h1>
                  Your goals.
                  <br />
                  Your pace.
                  <br />
                  <em>Your daily rhythm.</em>
                </h1>
                <p>
                  A four-week plan for movement, meals, and self-care.
                  Thoughtfully made for your body, your preferences, and your
                  everyday.
                </p>
                <div className="welcome-features">
                  {[
                    [Dumbbell, "Move with purpose"],
                    [Utensils, "Eat for your goals"],
                    [Sparkles, "Make room for care"],
                  ].map(([Icon, t]) => (
                    <span key={t}>
                      <Icon size={18} />
                      {t}
                    </span>
                  ))}
                </div>
                <div className="welcome-note">
                  <Leaf size={26} />
                  <span>
                    Consistency over perfection.
                    <small>Small steps. Lasting change.</small>
                  </span>
                </div>
              </div>
              <form className="signup-card" onSubmit={signup}>
                <span className="eyebrow">LET’S START WITH YOU</span>
                <h2>Welcome to Forma.</h2>
                <p>Create your profile. We’ll take care of the plan.</p>
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Alex Morgan"
                  />
                </label>
                <label>
                  Email for notifications
                  <input
                    name="email"
                    autoComplete="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Password <small>(optional)</small>
                  <input
                    name="password"
                    autoComplete="new-password"
                    type="password"
                    minLength={8}
                    maxLength={128}
                    placeholder="At least 8 characters"
                  />
                </label>
                <small>
                  Leave blank to receive a generated password for future
                  sign-ins.
                </small>
                <button className="primary" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Create profile <ArrowRight size={17} />
                    </>
                  )}
                </button>
                <div className="signup-footer">
                  Already have an account?{" "}
                  <button type="button" onClick={() => setModal("login")}>
                    Sign in
                  </button>
                </div>
                <button
                  type="button"
                  className="admin-link"
                  onClick={() => setModal("login")}
                >
                  Administrator sign in <ArrowUpRight size={13} />
                </button>
              </form>
            </div>
          ) : isAdmin && page === "Static pages" ? (
            <StaticPages />
          ) : isAdmin ? (
            <>
              <div className="page-heading">
                <span className="eyebrow">ADMINISTRATION</span>
                <h1>Users</h1>
                <p>Manage tenant accounts and their wellness spaces.</p>
              </div>
              <section className="admin-panel">
                <h2>
                  <Plus size={18} /> Add user
                </h2>
                <form
                  className="admin-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const element = e.currentTarget;
                    const body = Object.fromEntries(new FormData(element));
                    action(async () => {
                      const result = await api("/admin/users", {
                        method: "POST",
                        body,
                      });
                      if (result.generated_password)
                        setCredentials(result.generated_password);
                      setUsers(await api("/admin/users"));
                      element.reset();
                      toast("User created.");
                    });
                  }}
                >
                  <label>
                    Email
                    <input
                      name="email"
                      required
                      type="email"
                      placeholder="user@example.com"
                    />
                  </label>
                  <label>
                    Name
                    <input name="name" required placeholder="Full name" />
                  </label>
                  <label>
                    Password (optional)
                    <input
                      name="password"
                      type="password"
                      minLength={8}
                      placeholder="Min. 8 characters"
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Add user
                  </button>
                </form>
                {credentials && (
                  <div className="credential-box">
                    Generated password: <code>{credentials}</code>
                    <button onClick={() => setCredentials(null)}>
                      <X size={15} />
                    </button>
                  </div>
                )}
                <small>
                  Each user has a separate profile, plan, tracking history, and
                  media folder.
                </small>
              </section>
              <section className="admin-table">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Tenant ID</th>
                      <th>Created</th>
                      <th>Profile</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>{u.name}</td>
                        <td>
                          <code>{u.id.slice(0, 12)}…</code>
                        </td>
                        <td>
                          {labelDate(u.created.slice(0, 10), {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td>
                          <span className="status-pill">
                            {u.onboarded ? "Onboarded" : "New"}
                          </span>
                        </td>
                        <td>
                          <div className="admin-actions">
                            <button
                              className="outline"
                              onClick={() => {
                                setSelectedTask(u);
                                setModal("password");
                              }}
                            >
                              <KeyRound size={13} />
                              Set password
                            </button>
                            <button
                              className="outline"
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    "/admin/users/" + u.id + "/impersonate",
                                    { method: "POST" },
                                  );
                                  setImpersonating(true);
                                  setPage("Overview");
                                  await refresh();
                                })
                              }
                            >
                              <ArrowRight size={13} />
                              Login as
                            </button>
                            <button
                              className="danger"
                              onClick={() => {
                                setSelectedTask(u);
                                setModal("delete-user");
                              }}
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div className="empty-state">
                    No users yet. Add the first account above.
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div className="eyebrow">
                  {labelDate(date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }).toUpperCase()}
                </div>
                <div className="heading-row">
                  <div>
                    <h1>
                      {page === "Overview"
                        ? `A fresh day, ${name}.`
                        : page === "My calendar"
                          ? "Your daily rhythm."
                          : page === "Progress"
                            ? "Every step adds up."
                            : page === "Workout plan"
                              ? "Built for your strength."
                              : page === "Meal plan"
                                ? "Nourish your potential."
                                : "Care starts with you."}
                      <span className="sun">
                        {page === "Overview" ? "✳" : ""}
                      </span>
                    </h1>
                    <p>
                      {page === "Overview"
                        ? "Show up for yourself. We’ll take care of the plan."
                        : "Your personal wellness journey, one day at a time."}
                    </p>
                  </div>
                  <div className="plan-actions">
                    {plan && (
                      <>
                        <button
                          className="outline"
                          disabled={inProgress || busy || !remainingDays}
                          onClick={() => openAdjustment("refine")}
                          title={
                            !remainingDays
                              ? "No upcoming days remain. Extend your plan to continue."
                              : "Refine upcoming days"
                          }
                        >
                          <Sparkles size={15} />
                          Refine current plan
                        </button>
                        <button
                          className="outline"
                          disabled={inProgress || busy}
                          onClick={() => openAdjustment("extend")}
                        >
                          <Plus size={15} />
                          Extend Plan
                        </button>
                      </>
                    )}
                    <button
                      className="outline"
                      disabled={inProgress}
                      onClick={openOnboarding}
                    >
                      <Settings size={15} />
                      Customize plan
                    </button>
                  </div>
                </div>
              </div>
              {plan?.last_change && (
                <div className="plan-change-summary">
                  <Check size={17} />
                  <span>
                    Plan{" "}
                    {plan.last_change.action === "refine"
                      ? "refined"
                      : "extended"}{" "}
                    · {plan.last_change.days} days ·{" "}
                    {labelDate(plan.last_change.start_date, {
                      month: "short",
                      day: "numeric",
                    })}
                    –
                    {labelDate(plan.last_change.end_date, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}

              {credentials && (
                <div className="credential-box">
                  Save this password for future sign-ins:{" "}
                  <code>{credentials}</code>
                  <button
                    onClick={() => setCredentials(null)}
                    aria-label="Dismiss password"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {inProgress && (
                <section className="planning-banner" aria-live="polite">
                  <LoaderCircle className="spin" size={24} />
                  <div>
                    <h3>
                      {job.action === "refine"
                        ? "Refining your current plan"
                        : job.action === "extend"
                          ? "Extending your plan"
                          : "Preparing your four-week plan"}
                    </h3>
                    <p>{job.message}</p>
                    <small>Your progress is saved. You can return later.</small>
                  </div>
                  <span>{job.status}</span>
                </section>
              )}
              {job?.status === "failed" && (
                <section className="planning-banner failed">
                  <AlertCircle size={24} />
                  <div>
                    <h3>Planning needs another try</h3>
                    <p>{job.message}</p>
                  </div>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => action(retryPlanning)}
                  >
                    Retry
                  </button>
                </section>
              )}
              {!plan ? (
                <section className="hero empty-hero">
                  <div className="hero-content">
                    <span className="pill">
                      <span /> YOUR FOUR-WEEK JOURNEY
                    </span>
                    <h2>
                      {inProgress
                        ? "Good things are taking shape."
                        : "A plan made around you."}
                    </h2>
                    <p>
                      {inProgress
                        ? "Your agents are preparing and reviewing your meals, movement and care."
                        : "Tell us about your goals, preferences, and everyday life to build your first plan."}
                    </p>
                    {!inProgress && (
                      <button
                        onClick={
                          profile ? () => action(startPlanning) : openOnboarding
                        }
                      >
                        {profile ? "Prepare Planning" : "Complete onboarding"}
                        <ArrowRight size={17} />
                      </button>
                    )}
                  </div>
                  <div className="hero-art">
                    <div className="orbit one" />
                    <div className="orbit two" />
                    <div className="art-disc">
                      <Leaf size={56} strokeWidth={1} />
                    </div>
                    <span className="art-star">✳</span>
                  </div>
                </section>
              ) : (
                <>
                  {page !== "Progress" && (
                    <div className="hero">
                      <div className="hero-content">
                        <span className="pill">
                          <span /> WEEK {week} ·{" "}
                          {[
                            "BUILDING THE FOUNDATION",
                            "FINDING YOUR RHYTHM",
                            "GROWING WITH INTENTION",
                            "CELEBRATING CONSISTENCY",
                          ][week - 1] || "KEEPING YOUR RHYTHM"}
                        </span>
                        <h2>Consistency over perfection.</h2>
                        <p>
                          A balanced plate. A little movement. A moment for you.
                          <br />
                          Your next chapter starts with today.
                        </p>
                        <button
                          onClick={() => {
                            setDate(
                              days.find((d) => d.date === localDate())?.date ||
                                days[0].date,
                            );
                            setPage("My calendar");
                          }}
                        >
                          Let’s make today count <ArrowRight size={17} />
                        </button>
                      </div>
                      <div className="hero-art">
                        <div className="orbit one" />
                        <div className="orbit two" />
                        <div className="art-disc">
                          <Leaf size={56} strokeWidth={1} />
                        </div>
                        <span className="art-star">✳</span>
                        <div className="art-label">
                          <span />
                          Designed around you
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="stats">
                    <Stat
                      icon={<Check size={19} />}
                      label="Daily progress"
                      value={`${adherence}%`}
                      detail={`${completed} of ${tasks.length} activities completed`}
                      color="green"
                    >
                      <div className="progress-track">
                        <i style={{ width: `${adherence}%` }} />
                      </div>
                    </Stat>
                    <Stat
                      icon={<Flame size={19} />}
                      label="Calories planned"
                      value={meals
                        .reduce((n, t) => n + t.calories, 0)
                        .toLocaleString()}
                      unit="kcal"
                      detail="Estimated meal energy"
                      color="orange"
                    >
                      <div className="stat-bottom">
                        <span className="dot orange" />
                        {(
                          selectedDay?.daily_calorie_target ??
                          plan.daily_calorie_target
                        ).toLocaleString()}{" "}
                        kcal daily target
                      </div>
                    </Stat>
                    <Stat
                      icon={<Dumbbell size={19} />}
                      label="Movement goal"
                      value={workouts.reduce((n, t) => n + t.minutes, 0)}
                      unit="min"
                      detail={profile?.goal || "Movement at your pace"}
                      color="purple"
                    >
                      <div className="stat-bottom">
                        <span className="dot purple" />
                        {workouts.reduce((n, t) => n + t.calories, 0)} kcal
                        estimated burn
                      </div>
                    </Stat>
                    <Stat
                      icon={<Droplets size={19} />}
                      label="Water intake"
                      value={(water * 0.25).toFixed(1)}
                      unit="L"
                      detail={`${water} glasses logged today`}
                      color="blue"
                    >
                      <div className="water-row">
                        {Array.from({ length: 10 }, (_, i) => (
                          <button
                            disabled={busy}
                            key={i}
                            onClick={() =>
                              saveWater(i + 1 === water ? 0 : i + 1)
                            }
                            className={i < water ? "filled" : ""}
                            aria-label={`Log ${i + 1} glasses`}
                          >
                            <Droplets size={15} />
                          </button>
                        ))}
                        <button
                          disabled={busy}
                          className="water-plus"
                          onClick={() => saveWater(Math.min(20, water + 1))}
                          aria-label="Add glass"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </Stat>
                  </div>
                  {page === "Progress" ? (
                    <>
                      <section className="progress-page">
                        <div className="section-heading">
                          <div>
                            <h2>
                              {days.length > 28
                                ? "Your progress over time"
                                : "Your four-week progress"}
                            </h2>
                            <p>
                              Activity completion, based on your saved tracking.
                            </p>
                          </div>
                          <span className="status-pill">
                            {overall}% adherence
                          </span>
                        </div>
                        <div className="long-chart">
                          {days.map((d) => {
                            const pct = d.tasks.length
                              ? Math.round(
                                  (d.tasks.filter(
                                    (t) =>
                                      statuses[statusKey(d.date, t.id)] ===
                                      "completed",
                                  ).length /
                                    d.tasks.length) *
                                    100,
                                )
                              : 0;
                            return (
                              <button
                                key={d.date}
                                title={`${d.date}: ${pct}% complete`}
                                onClick={() => {
                                  setDate(d.date);
                                  setPage("My calendar");
                                }}
                              >
                                <div className="long-bar-space">
                                  <i style={{ height: `${pct}%` }} />
                                </div>
                                <small>
                                  {labelDate(d.date, { day: "numeric" })}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                        <div className="progress-summary">
                          <div>
                            <b>{allCompleted}</b>
                            <small>Activities completed</small>
                          </div>
                          <div>
                            <b>{activeDays}</b>
                            <small>Active days</small>
                          </div>
                          <div>
                            <b>
                              {days.reduce(
                                (n, d) =>
                                  n +
                                  d.tasks.filter(
                                    (t) =>
                                      statuses[statusKey(d.date, t.id)] ===
                                      "skipped",
                                  ).length,
                                0,
                              )}
                            </b>
                            <small>Activities skipped</small>
                          </div>
                        </div>
                        <p className="progress-feedback">{feedbackText}</p>
                      </section>
                      <section className="progress-page">
                        <div className="section-heading">
                          <h2>Weight check-ins</h2>
                          <button
                            className="text-button"
                            onClick={() => setModal("checkin")}
                          >
                            Add check-in <Plus size={16} />
                          </button>
                        </div>
                        <WeightChart checkins={checkins} />
                      </section>
                      {history.length > 0 && (
                        <section className="progress-page">
                          <h2>Previous plans</h2>
                          <p className="muted">
                            Your earlier progress stays with you when your plan
                            changes.
                          </p>
                          {history.map((h) => (
                            <div className="history-row" key={h.id}>
                              <div>
                                <b>
                                  {h.start_date} – {h.end_date}
                                </b>
                                <small>
                                  {h.completed} completed · {h.skipped} skipped
                                  · {h.total} planned
                                </small>
                              </div>
                              <span>{h.adherence}%</span>
                              <div className="progress-track">
                                <i style={{ width: `${h.adherence}%` }} />
                              </div>
                            </div>
                          ))}
                        </section>
                      )}
                      <section className="progress-page">
                        <h2>Progress photos</h2>
                        <p className="muted">
                          Your private photo journal. Photo analysis is part of
                          Phase 2.
                        </p>
                        <PhotoGrid
                          photos={media.filter((m) => m.kind === "progress")}
                          remove={(id) =>
                            action(async () => {
                              await api("/media/" + id, { method: "DELETE" });
                              setMedia(await api("/media"));
                            })
                          }
                        />
                      </section>
                    </>
                  ) : (
                    <div className="lower-grid">
                      <section className="daily" id="daily">
                        <div className="section-heading">
                          <div>
                            <h2>
                              {page === "Workout plan"
                                ? "Your workouts"
                                : page === "Meal plan"
                                  ? "Your meals"
                                  : page === "Care routines"
                                    ? "Your care routines"
                                    : "Your daily plan"}
                              <span className="count">
                                {tasks.length} activities
                              </span>
                            </h2>
                            <p>Your exercises, portions, and daily totals.</p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => {
                              setDate(
                                days.find((d) => d.date === localDate())
                                  ?.date || days[0].date,
                              );
                              setPage("My calendar");
                            }}
                          >
                            Today <ArrowUpRight size={16} />
                          </button>
                        </div>
                        <div className="calendar-tools">
                          <button
                            className="outline"
                            disabled={week === 1}
                            onClick={() => setDate(days[(week - 2) * 7].date)}
                          >
                            <ChevronLeft size={14} />
                            Previous week
                          </button>
                          <span>
                            Week {week} of {totalWeeks}
                          </span>
                          <button
                            className="outline"
                            disabled={week >= totalWeeks}
                            onClick={() => setDate(days[week * 7].date)}
                          >
                            Next week
                            <ChevronRight size={14} />
                          </button>
                        </div>
                        <div className="date-strip full-date-strip">
                          {weekDays.map((d) => (
                            <button
                              onClick={() => setDate(d.date)}
                              key={d.date}
                              className={date === d.date ? "selected" : ""}
                            >
                              <small>
                                {labelDate(d.date, {
                                  weekday: "short",
                                }).toUpperCase()}
                              </small>
                              <b>{labelDate(d.date, { day: "2-digit" })}</b>
                              <span className="date-dot" />
                            </button>
                          ))}
                        </div>
                        <div className="tabs">
                          {["All activities", "Workouts", "Meals"].map((t) => (
                            <button
                              key={t}
                              onClick={() => {
                                setTab(t);
                                if (!["Overview", "My calendar"].includes(page))
                                  setPage("My calendar");
                              }}
                              className={tab === t ? "selected" : ""}
                            >
                              {t}
                            </button>
                          ))}
                          <span>
                            {labelDate(date, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          {visibleTasks.some((t) => t.role !== "care") && (
                            <div
                              className="view-toggle"
                              role="group"
                              aria-label="Plan view"
                            >
                              {[
                                ["cards", LayoutGrid, "Cards"],
                                ["minimal", Rows3, "Minimal"],
                              ].map(([value, Icon, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={planView === value}
                                  className={
                                    planView === value ? "selected" : ""
                                  }
                                  onClick={() => setPlanView(value)}
                                >
                                  <Icon size={13} />
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="task-list">
                          {visibleTasks.length > 0 && (
                            <PlanCards
                              tasks={visibleTasks}
                              view={planView}
                              targets={
                                selectedDay?.daily_nutrition_targets ||
                                plan.daily_nutrition_targets
                              }
                              date={date}
                              today={date === localDate()}
                              statuses={statuses}
                              busy={busy}
                              mark={mark}
                              onDetails={(task) => {
                                setSelectedTask(task);
                                setModal("task");
                              }}
                            />
                          )}
                          {visibleTasks.length === 0 && (
                            <div className="empty-state">
                              <Sparkles size={28} />
                              <h3>
                                {page === "Care routines"
                                  ? "Make room for a little care."
                                  : "No activities here yet."}
                              </h3>
                              <p>
                                {page === "Care routines"
                                  ? profile.focus.some((f) =>
                                      f.includes("care"),
                                    )
                                    ? `Care begins on day ${plan.care_start_day}. Select week 3 to see your routines, or start earlier below.`
                                    : "Add skin or hair care to your focus in Customize plan."
                                  : "Select a date in your plan."}
                              </p>
                              {page === "Care routines" &&
                                profile.focus.some((f) => f.includes("care")) &&
                                !profile.care_early && (
                                  <button
                                    className="outline"
                                    disabled={inProgress || busy}
                                    onClick={() =>
                                      action(async () => {
                                        const saved = await api("/profile", {
                                          method: "PUT",
                                          body: {
                                            ...profile,
                                            care_early: true,
                                          },
                                        });
                                        setProfile(saved);
                                        await startPlanning();
                                      })
                                    }
                                  >
                                    Start care early <ArrowRight size={15} />
                                  </button>
                                )}
                            </div>
                          )}
                        </div>
                        <div className="daily-footer">
                          <span>
                            <span className="live-dot" />
                            {completed} completed · {skipped} skipped
                          </span>
                          <button onClick={() => setModal("feedback")}>
                            Share feedback <ArrowRight size={14} />
                          </button>
                        </div>
                      </section>
                      <div className="right-column">
                        <section className="weekly">
                          <div className="section-heading">
                            <h2>Your week at a glance</h2>
                            <TrendingUp size={18} />
                          </div>
                          <p>Small wins make a big difference.</p>
                          <div className="chart">
                            {weekDays.map((d) => {
                              const value = d.tasks.length
                                ? Math.round(
                                    (d.tasks.filter(
                                      (t) =>
                                        statuses[statusKey(d.date, t.id)] ===
                                        "completed",
                                    ).length /
                                      d.tasks.length) *
                                      100,
                                  )
                                : 0;
                              return (
                                <button
                                  className="bar-column"
                                  key={d.date}
                                  title={`${d.date}: ${value}% completed`}
                                  onClick={() => setDate(d.date)}
                                >
                                  <div className="bar-space">
                                    <div
                                      className={
                                        "bar " +
                                        (d.date === date ? "today" : "")
                                      }
                                      style={{ height: `${value}%` }}
                                    />
                                  </div>
                                  <span
                                    className={
                                      d.date === date ? "today-label" : ""
                                    }
                                  >
                                    {labelDate(d.date, { weekday: "narrow" })}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="chart-legend">
                            <span className="dot green" />
                            Activity completion<span>Week {week}</span>
                          </div>
                          <div className="weekly-summary">
                            <div>
                              <b>
                                {
                                  weekDays.filter((d) =>
                                    d.tasks.some(
                                      (t) =>
                                        statuses[statusKey(d.date, t.id)] ===
                                        "completed",
                                    ),
                                  ).length
                                }
                                <span> days</span>
                              </b>
                              <small>Active this week</small>
                            </div>
                            <div>
                              <b>
                                {Math.round(
                                  (weekDays.reduce(
                                    (n, d) =>
                                      n +
                                      d.tasks.filter(
                                        (t) =>
                                          statuses[statusKey(d.date, t.id)] ===
                                          "completed",
                                      ).length,
                                    0,
                                  ) /
                                    Math.max(
                                      1,
                                      weekDays.reduce(
                                        (n, d) => n + d.tasks.length,
                                        0,
                                      ),
                                    )) *
                                    100,
                                )}
                                <span>%</span>
                              </b>
                              <small>Weekly adherence</small>
                            </div>
                          </div>
                        </section>
                        <section className="insight">
                          <span className="insight-label">
                            <Sparkles size={15} />A NOTE FOR YOU
                          </span>
                          <h3>
                            {overall >= 75
                              ? "Your rhythm is taking shape."
                              : "Small wins still count."}
                          </h3>
                          <p>{feedbackText}</p>
                          <div>
                            <span className="leaf-circle">
                              <Leaf size={16} />
                            </span>
                            Your wellness companion
                          </div>
                        </section>
                        <section className="photo-card">
                          <div className="photo-icon">
                            <Upload size={20} />
                          </div>
                          <div>
                            <h3>See how far you’ve come</h3>
                            <p>Add a private photo or a daily check-in.</p>
                          </div>
                          <button
                            onClick={() => setModal("checkin")}
                            aria-label="Add check-in"
                          >
                            <Plus size={18} />
                          </button>
                        </section>
                        {currentPhotos.length > 0 && (
                          <PhotoGrid
                            photos={currentPhotos}
                            remove={(id) =>
                              action(async () => {
                                await api("/media/" + id, { method: "DELETE" });
                                setMedia(await api("/media"));
                              })
                            }
                          />
                        )}
                      </div>
                    </div>
                  )}
                  <section className="plan-note">
                    <span>
                      <Check size={15} />
                      Reviewed plan · {plan.model}
                    </span>
                    <p>{plan.review_summary}</p>
                    <button
                      className="text-button"
                      onClick={() => setModal("plan-info")}
                    >
                      View planning assumptions <ArrowUpRight size={14} />
                    </button>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            Made for your everyday. Built for your wellbeing.
            <span>
              <span className="dot green" />
              {busy
                ? "Saving…"
                : account
                  ? "Stored in your wellness space"
                  : "A little better, every day"}
            </span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <div
            className={`modal ${modal === "onboarding" ? "onboarding-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              disabled={busy}
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={21} />
            </button>
            {error && (
              <div className="error-banner" role="alert">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            {modal === "login" ? (
              <form onSubmit={login}>
                <span className="eyebrow">YOUR WELLNESS SPACE</span>
                <h2>Welcome back.</h2>
                <p>Sign in to your account or administration.</p>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    defaultValue="admin@example.com"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    defaultValue="admin123"
                    required
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Sign in <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
            ) : modal === "refine" || modal === "extend" ? (
              <form onSubmit={submitAdjustment}>
                <span className="eyebrow">YOUR PLAN, YOUR PREFERENCES</span>
                <h2>
                  {modal === "refine" ? "Refine current plan" : "Extend Plan"}
                </h2>
                <p>
                  {modal === "refine"
                    ? "Adjust upcoming days while keeping your completed and skipped activities."
                    : "Continue your journey with new days after the current plan."}
                </p>
                <label>
                  What would you like to change?
                  <textarea
                    name="preferences"
                    required
                    maxLength={4000}
                    placeholder={
                      modal === "refine"
                        ? "e.g. Keep workouts under 30 minutes and add quick vegetarian lunches."
                        : "e.g. Continue with more leg strength and simple meal prep."
                    }
                  />
                </label>
                <label>
                  Number of days
                  <select
                    value={adjustmentDays}
                    onChange={(e) => setAdjustmentDays(Number(e.target.value))}
                  >
                    {Array.from(
                      { length: modal === "refine" ? remainingDays : 28 },
                      (_, i) => i + 1,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "day" : "days"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mandatory-note">
                  <CalendarDays size={17} />
                  {labelDate(adjustmentStart, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  –{" "}
                  {labelDate(shiftDate(adjustmentStart, adjustmentDays - 1), {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <p className="muted">
                  Your note is saved for future plan generation. Each request
                  covers at most 28 days and is reviewed before appearing on
                  your dashboard.
                </p>
                <button
                  className="primary"
                  disabled={busy || inProgress || !adjustmentDays}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      {modal === "refine" ? "Refine plan" : "Extend plan"}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
            ) : modal === "onboarding" ? (
              <form onSubmit={submitOnboarding}>
                <span className="eyebrow">YOUR JOURNEY · STEP {step} OF 3</span>
                <h2>
                  {step === 1
                    ? "What matters to you?"
                    : step === 2
                      ? "A little about your body."
                      : "Make it fit your life."}
                </h2>
                <p>
                  Sample defaults are prefilled. Review them to match your own
                  body and preferences before preparing a plan.
                </p>
                {credentials && (
                  <div className="credential-box">
                    Save your sign-in password: <code>{credentials}</code>
                  </div>
                )}
                {step === 1 ? (
                  <>
                    <div className="form-row">
                      <Field
                        label="Your name"
                        value={form.name}
                        required
                        onChange={(v) => setForm({ ...form, name: v })}
                      />
                      <Field
                        label="Notification email"
                        type="email"
                        value={form.email}
                        required
                        onChange={(v) => setForm({ ...form, email: v })}
                      />
                    </div>
                    <label>Your focus (select one or more)</label>
                    <Choices
                      options={[
                        "Physique",
                        "Overall wellness",
                        "Skin care",
                        "Hair care",
                      ]}
                      value={form.focus}
                      onChange={(focus) => setForm({ ...form, focus })}
                    />
                    {form.focus.length === 0 && (
                      <small className="invalid">
                        Choose at least one focus to continue.
                      </small>
                    )}
                    <div className="mandatory-note">
                      <Utensils size={17} />A balanced meal plan is included in
                      every journey.
                    </div>
                    {form.focus.some((f) =>
                      ["Physique", "Overall wellness"].includes(f),
                    ) && (
                      <>
                        <label>Body areas (optional, select any)</label>
                        <Choices
                          options={[
                            "Arms",
                            "Legs",
                            "Torso",
                            "Back",
                            "Shoulders",
                            "Full body",
                          ]}
                          value={form.body_areas}
                          onChange={(body_areas) =>
                            setForm({ ...form, body_areas })
                          }
                        />
                        <Field
                          label="Your own body focus"
                          placeholder="e.g. core stability or posture"
                          value={form.custom_area}
                          onChange={(v) => setForm({ ...form, custom_area: v })}
                        />
                        <Select
                          label="Your goal"
                          options={[
                            "Build muscle",
                            "Maintain & feel better",
                            "Lose fat",
                          ]}
                          value={form.goal}
                          onChange={(v) => setForm({ ...form, goal: v })}
                        />
                      </>
                    )}
                  </>
                ) : step === 2 ? (
                  <>
                    <div className="form-row">
                      <Field
                        label="Age"
                        type="number"
                        min="18"
                        max="100"
                        required
                        value={form.age}
                        onChange={(v) => setForm({ ...form, age: v })}
                      />
                      <Field
                        label="Height (cm)"
                        type="number"
                        min="100"
                        max="250"
                        required
                        value={form.height}
                        onChange={(v) => setForm({ ...form, height: v })}
                      />
                      <Field
                        label="Weight (kg)"
                        type="number"
                        min="30"
                        max="350"
                        step="0.1"
                        required
                        value={form.weight}
                        onChange={(v) => setForm({ ...form, weight: v })}
                      />
                    </div>
                    <Select
                      label="Current fitness level"
                      options={["Beginner", "Intermediate", "Advanced"]}
                      value={form.level}
                      onChange={(v) => setForm({ ...form, level: v })}
                    />
                    <Field
                      label="Injuries, limitations, or things to avoid (optional)"
                      value={form.limitations}
                      placeholder="Help us adapt your movement and meals"
                      onChange={(v) => setForm({ ...form, limitations: v })}
                    />
                    {form.focus.includes("Skin care") && (
                      <Select
                        label="Skin type (optional)"
                        options={[
                          "",
                          "Not sure",
                          "Dry",
                          "Oily",
                          "Combination",
                          "Sensitive",
                          "Normal",
                        ]}
                        value={form.skin_type}
                        onChange={(v) => setForm({ ...form, skin_type: v })}
                      />
                    )}{" "}
                    {form.focus.includes("Hair care") && (
                      <Field
                        label="Hair type (optional)"
                        value={form.hair_type}
                        placeholder="e.g. straight, curly, fine, dry"
                        onChange={(v) => setForm({ ...form, hair_type: v })}
                      />
                    )}{" "}
                    {form.focus.some((f) => f.includes("care")) && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={form.care_early}
                          onChange={(e) =>
                            setForm({ ...form, care_early: e.target.checked })
                          }
                        />
                        Start care in week 1 (otherwise week 3)
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label>Food preferences (optional, select any)</label>
                    <Choices
                      options={[
                        "Vegetarian",
                        "Vegan",
                        "Gluten-free",
                        "Dairy-free",
                      ]}
                      value={form.diet}
                      onChange={(diet) => setForm({ ...form, diet })}
                    />
                    <Field
                      label="Allergies & food exclusions"
                      value={form.allergies}
                      placeholder="e.g. peanuts, dairy, shellfish — or none"
                      onChange={(v) => setForm({ ...form, allergies: v })}
                    />
                    {form.focus.some((f) =>
                      ["Physique", "Overall wellness"].includes(f),
                    ) && (
                      <>
                        <Field
                          label="Available equipment (optional)"
                          value={form.equipment}
                          placeholder="No equipment? Gym access is assumed."
                          onChange={(v) => setForm({ ...form, equipment: v })}
                        />
                        <label>
                          Equipment photos (optional)
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            onChange={(e) =>
                              setFiles({
                                ...files,
                                equipment: Array.from(e.target.files),
                              })
                            }
                          />
                        </label>
                        <label>
                          Full-body photo (optional)
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) =>
                              setFiles({
                                ...files,
                                body: Array.from(e.target.files),
                              })
                            }
                          />
                        </label>
                        <small>
                          Photos help tailor exercise suggestions. Upload only
                          what you’re comfortable sharing; they’re stored
                          privately in your tenant folder.
                        </small>
                        <PhotoGrid
                          photos={media.filter((m) => m.kind !== "progress")}
                          remove={(id) =>
                            action(async () => {
                              await api("/media/" + id, { method: "DELETE" });
                              setMedia(await api("/media"));
                            })
                          }
                        />
                      </>
                    )}
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.notifications}
                        onChange={(e) =>
                          setForm({ ...form, notifications: e.target.checked })
                        }
                      />
                      Email me when my plan is ready
                    </label>
                    <small>
                      Dashboard notifications always work. Email delivery
                      requires SMTP configuration.
                    </small>
                    <div className="mandatory-note">
                      <Sparkles size={17} />
                      Your agents plan four weeks, then review and refine the
                      result.
                    </div>
                  </>
                )}
                <div className="onboarding-actions">
                  {step > 1 && (
                    <button
                      className="outline"
                      disabled={busy}
                      type="button"
                      onClick={() => setStep(step - 1)}
                    >
                      <ChevronLeft size={15} />
                      Back
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={busy || form.focus.length === 0 || inProgress}
                    type="submit"
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={17} />
                        Saving your preferences…
                      </>
                    ) : (
                      <>
                        {step < 3 ? "Continue" : "Prepare Planning"}
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : modal === "task" ? (
              <>
                <span className="eyebrow">
                  {selectedTask.category} · {selectedTask.time}
                </span>
                <h2>{selectedTask.title}</h2>
                <p>{selectedTask.description}</p>
                <div className="task-detail-meta">
                  <Clock size={16} />
                  {selectedTask.minutes} min{" "}
                  {selectedTask.calories > 0 && (
                    <>
                      <Flame size={16} />
                      {selectedTask.calories} kcal estimated{" "}
                      {selectedTask.role === "workout" ? "burn" : ""}
                    </>
                  )}
                  {selectedTask.nutrition && (
                    <span className="detail-macros">
                      {MACRO_LABELS.map(
                        ([key, label]) =>
                          `${selectedTask.nutrition[key]} g ${label}`,
                      ).join(" · ")}
                    </span>
                  )}
                </div>
                {selectedTask.ingredients.length > 0 && (
                  <>
                    <h3>Ingredients & portions</h3>
                    <ul>
                      {selectedTask.ingredients.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
                <h3>
                  {selectedTask.role === "meal"
                    ? "Preparation"
                    : "Your routine"}
                </h3>
                <ol>
                  {selectedTask.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <TaskGuides task={selectedTask} />
                <div className="mandatory-note">
                  Week {week}: {selectedTask.week_note}
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/tasks/status", {
                        method: "PUT",
                        body: {
                          date,
                          task_id: selectedTask.id,
                          status: "completed",
                        },
                      });
                      setStatuses((s) => ({
                        ...s,
                        [statusKey(date, selectedTask.id)]: "completed",
                      }));
                      setModal(null);
                    })
                  }
                >
                  Mark completed <Check size={17} />
                </button>
              </>
            ) : modal === "feedback" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = new FormData(e.currentTarget).get("text");
                  action(async () => {
                    await api("/feedback", { method: "POST", body: { text } });
                    setModal(null);
                    toast(
                      "Feedback saved. Your next plan will take it into account.",
                    );
                  });
                }}
              >
                <h2>How’s your plan feeling?</h2>
                <p>Tell us what’s working and what could fit better.</p>
                <textarea
                  name="text"
                  required
                  maxLength={4000}
                  placeholder="What would you change?"
                />
                <button className="primary" disabled={busy}>
                  Save feedback <Check size={16} />
                </button>
              </form>
            ) : modal === "checkin" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget);
                  action(async () => {
                    const body = {
                      date,
                      water,
                      weight: values.get("weight")
                        ? Number(values.get("weight"))
                        : null,
                      notes: values.get("notes"),
                    };
                    await api("/checkins", { method: "PUT", body });
                    setCheckins((s) => ({ ...s, [date]: body }));
                    const photos = values
                      .getAll("photos")
                      .filter((f) => f.size);
                    await uploadFiles("progress", photos);
                    setModal(null);
                    toast("Your daily check-in is saved.");
                  });
                }}
              >
                <h2>Your daily check-in.</h2>
                <p>
                  {labelDate(date, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  · Small changes add up.
                </p>
                <label>
                  Weight (kg, optional)
                  <input
                    type="number"
                    name="weight"
                    min="30"
                    max="350"
                    step="0.1"
                    defaultValue={checkins[date]?.weight || ""}
                  />
                </label>
                <label>
                  How are you feeling?
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={checkins[date]?.notes || ""}
                    placeholder="Energy, sleep, or a small win"
                  />
                </label>
                <label>
                  Progress photos (optional)
                  <input
                    type="file"
                    name="photos"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <>
                      Save check-in <Check size={16} />
                    </>
                  )}
                </button>
              </form>
            ) : modal === "plan-info" ? (
              <>
                <span className="eyebrow">YOUR PLANNING TEAM</span>
                <h2>Thoughtfully planned. Reviewed.</h2>
                <p>{plan.review_summary}</p>
                {Object.entries(plan.summaries).map(([r, s]) => (
                  <div className="role-summary" key={r}>
                    <h3>{r} agent</h3>
                    <p>{s}</p>
                    <small>{plan.revisions[r]} revisions · max 3</small>
                  </div>
                ))}
                <h3>Assumptions</h3>
                <ul>
                  {plan.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <small>
                  Weekly templates repeat with the progression instructions
                  shown on each activity. Calories and burn are estimates.
                </small>
              </>
            ) : modal === "password" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const password = new FormData(e.currentTarget).get(
                    "password",
                  );
                  action(async () => {
                    await api(
                      account.role === "admin" && selectedTask?.id
                        ? "/admin/users/" + selectedTask.id + "/password"
                        : "/auth/password",
                      { method: "PUT", body: { password } },
                    );
                    setModal(null);
                    toast("Password updated.");
                  });
                }}
              >
                <h2>Set a new password.</h2>
                <p>
                  {account.role === "admin" && selectedTask?.id
                    ? selectedTask.email
                    : account.email}
                </p>
                <label>
                  Password
                  <input
                    type="password"
                    name="password"
                    minLength={8}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save password <KeyRound size={16} />
                </button>
              </form>
            ) : modal === "delete-user" ? (
              <>
                <h2>Delete {selectedTask.name}?</h2>
                <p>
                  This deletes the account, plans, tracking, sessions, and
                  uploaded media for {selectedTask.email}.
                </p>
                <button
                  className="primary danger-button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/admin/users/" + selectedTask.id, {
                        method: "DELETE",
                      });
                      setUsers(await api("/admin/users"));
                      setModal(null);
                      toast("User and tenant data deleted.");
                    })
                  }
                >
                  Delete account <Trash2 size={16} />
                </button>
              </>
            ) : (
              <>
                <h2>
                  {isAdmin ? "Administrator settings." : "Your settings."}
                </h2>
                <p>
                  {account?.name}
                  <br />
                  {account?.email}
                </p>
                {isAdmin && (
                  <button
                    className="outline full"
                    onClick={() => {
                      setSelectedTask(null);
                      setModal("password");
                    }}
                  >
                    Change password <KeyRound size={16} />
                  </button>
                )}
                {account && !isAdmin && (
                  <>
                    <button
                      className="outline full"
                      disabled={inProgress}
                      onClick={openOnboarding}
                    >
                      Edit profile & regenerate plan
                    </button>
                    <button
                      className="outline full"
                      onClick={() => {
                        setSelectedTask(null);
                        setModal("password");
                      }}
                    >
                      Change password <KeyRound size={16} />
                    </button>
                    <div className="saved-preferences">
                      <h3>Planning preferences</h3>
                      {preferences.length ? (
                        preferences
                          .slice()
                          .reverse()
                          .map((p) => (
                            <div key={p.id}>
                              <p>{p.text}</p>
                              <small>
                                {p.action === "refine"
                                  ? "Refinement"
                                  : "Extension"}{" "}
                                · {p.days} days ·{" "}
                                {labelDate(p.created.slice(0, 10), {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </small>
                            </div>
                          ))
                      ) : (
                        <p>
                          Your refine and extend notes will be saved here for
                          future plans.
                        </p>
                      )}
                    </div>
                    <div className="notifications">
                      <h3>Notifications</h3>
                      {notifications.length ? (
                        notifications.map((n) => (
                          <div key={n.id}>
                            <p>{n.message}</p>
                            <small>
                              {labelDate(n.created.slice(0, 10), {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              · Email: {n.email_status.replaceAll("_", " ")}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p>Your plan updates will appear here.</p>
                      )}
                    </div>
                  </>
                )}
                <button
                  className="outline full"
                  onClick={() =>
                    action(async () => {
                      await api("/auth/logout", { method: "POST" });
                      reset();
                      setModal(null);
                    })
                  }
                >
                  Sign out <LogOut size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ icon, label, value, unit, detail, color, children }) {
  return (
    <section className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        <span>{unit}</span>
      </div>
      <p>{detail}</p>
      {children}
    </section>
  );
}
function Field({ label, value, onChange, ...props }) {
  return (
    <label>
      {label}
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Select({ label, options, value, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option value={o} key={o}>
            {o || "Prefer not to say"}
          </option>
        ))}
      </select>
    </label>
  );
}
function Choices({ options, value, onChange }) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value.includes(o)}
          className={value.includes(o) ? "chosen" : ""}
          onClick={() =>
            onChange(
              value.includes(o) ? value.filter((v) => v !== o) : [...value, o],
            )
          }
        >
          {o}
          {value.includes(o) && <Check size={12} />}
        </button>
      ))}
    </div>
  );
}
function PhotoGrid({ photos, remove }) {
  return photos.length ? (
    <div className="photo-grid">
      {photos.map((p) => (
        <div key={p.id}>
          <a href={p.url} target="_blank" rel="noreferrer">
            <img src={p.url} alt={`${p.kind} photo from ${p.date}`} />
          </a>
          <span>
            {p.date}
            <button aria-label="Delete photo" onClick={() => remove(p.id)}>
              <Trash2 size={12} />
            </button>
          </span>
        </div>
      ))}
    </div>
  ) : (
    <p className="muted">No photos uploaded yet.</p>
  );
}
function WeightChart({ checkins }) {
  const points = Object.values(checkins)
    .filter((c) => c.weight)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length)
    return (
      <div className="empty-state">
        No weight check-ins yet. Add one whenever you’re ready.
      </div>
    );
  const min = Math.min(...points.map((c) => c.weight)) - 1,
    max = Math.max(...points.map((c) => c.weight)) + 1;
  const x = (i) => 30 + i * (540 / Math.max(1, points.length - 1)),
    y = (v) => 150 - ((v - min) / (max - min)) * 120;
  return (
    <>
      <svg
        className="weight-chart"
        viewBox="0 0 600 180"
        role="img"
        aria-label="Weight check-in trend"
      >
        <path
          d={points
            .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.weight)}`)
            .join(" ")}
          fill="none"
          stroke="#bed8aa"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.weight)} r="4" fill="#bed8aa" />
            <text
              x={x(i)}
              y={y(p.weight) - 12}
              textAnchor="middle"
              fill="#a5b89a"
              fontSize="11"
            >
              {p.weight} kg
            </text>
            <text
              x={x(i)}
              y="173"
              textAnchor="middle"
              fill="#879a7c"
              fontSize="10"
            >
              {p.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
      <div className="weight-history">
        {points.map((p) => (
          <span key={p.date}>
            {p.date}
            <b>{p.weight} kg</b>
          </span>
        ))}
      </div>
    </>
  );
}
// Guide pages (/exercise/?q=…, /food/?q=…) render over the plan, which stays
// mounted so returning from a guide keeps the selected day, modal and scroll.
function Root() {
  const [route, setRoute] = useState(() => guideRoute());
  const current = useRef(route);
  const planScroll = useRef(0);
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const update = () => {
      const next = guideRoute();
      if (next && !current.current) planScroll.current = window.scrollY;
      current.current = next;
      setRoute(next);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const routeKey = route ? `${route.type}/${route.query}` : "";
  useLayoutEffect(() => {
    window.scrollTo(0, routeKey ? 0 : planScroll.current);
  }, [routeKey]);
  return (
    <>
      <div style={{ display: route ? "none" : "contents" }}>
        <App />
      </div>
      {route && <GuidePage type={route.type} query={route.query} />}
    </>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
