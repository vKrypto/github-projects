import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  LoaderCircle,
  Play,
  Search,
  Utensils,
  X,
} from "lucide-react";
import {
  followLink,
  guideHref,
  navigate,
  normalize,
  resolveGuide,
  taskGuides,
  useLibrary,
} from "./library";

const COPY = {
  exercise: {
    eyebrow: "EXERCISE GUIDE",
    index: "Exercise guides",
    steps: "How to perform",
    tips: "Tips",
    open: "How to perform",
    Icon: Dumbbell,
  },
  food: {
    eyebrow: "FOOD GUIDE",
    index: "Food guides",
    steps: "How to prepare",
    tips: "How to eat it",
    open: "Food guide",
    Icon: Utensils,
  },
};

// Original illustrations have no external source page to link to.
function Credit({ photo }) {
  return photo.source ? (
    <a href={photo.source} target="_blank" rel="noreferrer">
      {photo.credit}
    </a>
  ) : (
    photo.credit
  );
}

export function GuideLink({ type, id, className, children, ...props }) {
  return (
    <a
      className={className}
      href={guideHref(type, id)}
      onClick={followLink}
      {...props}
    >
      {children}
    </a>
  );
}

export function GuideThumb({ guide, size = "small", onOpen }) {
  const photo = guide.photos[0];
  return (
    <button
      type="button"
      className={`guide-thumb ${size}`}
      onClick={onOpen}
      aria-label={`View ${guide.photos.length > 1 ? `${guide.photos.length} photos` : "photo"} of ${guide.name}`}
      title={guide.name}
    >
      <img src={photo.thumb} alt="" loading="lazy" decoding="async" />
      {guide.photos.length > 1 && (
        <span className="guide-thumb-count">{guide.photos.length}</span>
      )}
    </button>
  );
}

// Thumbnail plus link, for rows and steps that cover several exercises.
export function GuideChips({ type, guides, onOpen }) {
  return (
    <span className="guide-chips">
      {guides.map((guide) => (
        <span className="guide-chip" key={guide.id}>
          <GuideThumb guide={guide} size="tiny" onOpen={() => onOpen(guide)} />
          <GuideLink type={type} id={guide.id}>
            {guide.name}
          </GuideLink>
        </span>
      ))}
    </span>
  );
}

export function PhotoFocus({ type, guide, start = 0, onClose }) {
  const photos = guide.photos;
  const [index, setIndex] = useState(start);
  const closeButton = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const photo = photos[index];
  const step = (by) =>
    setIndex((i) => (i + by + photos.length) % photos.length);

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keys = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      } else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("keydown", keys, true);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
    // Keyboard handling is set up once per opening.
  }, []);

  return createPortal(
    <div
      className="photo-focus"
      role="dialog"
      aria-modal="true"
      aria-label={`${guide.name} photos`}
      onClick={() => close.current()}
    >
      <div className="photo-focus-frame" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <strong>{guide.name}</strong>
            <span>
              {photos.length > 1 && `${index + 1} of ${photos.length} · `}
              {photo.caption}
            </span>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="photo-focus-close"
            onClick={() => close.current()}
            aria-label="Close photos"
          >
            <X size={20} />
          </button>
        </header>
        <div className="photo-focus-stage">
          <img
            key={photo.src}
            src={photo.src}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
          />
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="photo-focus-nav previous"
                onClick={() => step(-1)}
                aria-label="Previous photo"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="photo-focus-nav next"
                onClick={() => step(1)}
                aria-label="Next photo"
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </div>
        {photos.length > 1 && (
          <div className="photo-focus-strip">
            {photos.map((p, i) => (
              <button
                type="button"
                key={p.src}
                className={i === index ? "selected" : ""}
                aria-label={`Show photo ${i + 1}: ${p.caption}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
              >
                <img src={p.thumb} alt="" />
              </button>
            ))}
          </div>
        )}
        <footer>
          <small>
            {photo.source ? "Photo" : "Image"}: <Credit photo={photo} /> ·{" "}
            {photo.license}
          </small>
          {type && (
            <GuideLink
              type={type}
              id={guide.id}
              className="photo-focus-guide"
              onClick={(event) => {
                close.current();
                followLink(event);
              }}
            >
              {COPY[type].open} <ArrowUpRight size={14} />
            </GuideLink>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// Guides for every exercise or dish named in a task's full instructions.
export function TaskGuides({ task }) {
  const type = task.role === "meal" ? "food" : "exercise";
  const { library } = useLibrary(type);
  const [focus, setFocus] = useState(null);
  const guides = task.role === "care" ? [] : taskGuides(library, task);
  if (!guides.length) return null;
  return (
    <div className="task-guides">
      <h3>{type === "food" ? "Food guide" : "Exercise guides"}</h3>
      <GuideChips type={type} guides={guides} onOpen={setFocus} />
      {focus && (
        <PhotoFocus type={type} guide={focus} onClose={() => setFocus(null)} />
      )}
    </div>
  );
}

const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// Click-to-play: nothing loads from YouTube until the viewer asks for it.
function VideoGuide({ video }) {
  const [playing, setPlaying] = useState(false);
  const watch = `https://www.youtube.com/watch?v=${video.id}`;
  return (
    <section className="guide-section guide-video">
      <h2>Watch how it's done</h2>
      <div className="video-frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${video.title}`}
          >
            <img
              src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
              alt=""
              loading="lazy"
            />
            <span className="video-play">
              <Play size={26} fill="currentColor" />
            </span>
            <span className="video-duration">{clock(video.seconds)}</span>
          </button>
        )}
      </div>
      <p className="video-meta">
        {video.title} · {video.channel} ·{" "}
        <a href={watch} target="_blank" rel="noreferrer">
          Open on YouTube
        </a>
      </p>
    </section>
  );
}

function GuideArticle({ type, guide }) {
  const [focus, setFocus] = useState(null);
  const copy = COPY[type];
  return (
    <article className="guide-article">
      <span className="eyebrow">{copy.eyebrow}</span>
      <h1>{guide.name}</h1>
      <p className="guide-summary">{guide.summary}</p>
      <dl className="guide-facts">
        {Object.entries(guide.facts).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={`guide-photos count-${guide.photos.length}`}>
        {guide.photos.map((photo, index) => (
          <figure key={photo.src}>
            <button
              type="button"
              onClick={() => setFocus(index)}
              aria-label={`Enlarge photo: ${photo.caption}`}
            >
              <img
                src={photo.src}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
              />
            </button>
            <figcaption>{photo.caption}</figcaption>
          </figure>
        ))}
      </div>
      {guide.video && <VideoGuide video={guide.video} />}
      <section className="guide-section">
        <h2>{copy.steps}</h2>
        <ol className="guide-steps">
          {guide.steps.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ol>
      </section>
      <section className="guide-section">
        <h2>{copy.tips}</h2>
        <ul className="guide-tips">
          {guide.tips.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      <p className="guide-note">
        {type === "exercise"
          ? "General guidance only. Stop if anything hurts, and follow advice from your doctor or physiotherapist about any injury or condition."
          : "General guidance only. Your plan's recipe sets the exact portions; check ingredients against your allergies."}
      </p>
      <footer className="guide-credits">
        <h2>Image credits</h2>
        <ul>
          {guide.photos.map((photo) => (
            <li key={photo.src}>
              {photo.caption}: <Credit photo={photo} />, {photo.license}
            </li>
          ))}
        </ul>
      </footer>
      {focus !== null && (
        <PhotoFocus
          guide={guide}
          start={focus}
          onClose={() => setFocus(null)}
        />
      )}
    </article>
  );
}

function GuideIndex({ type, library, missing }) {
  const [filter, setFilter] = useState("");
  const copy = COPY[type];
  const items = useMemo(
    () =>
      Object.entries(library.items).filter(([, item]) =>
        normalize(`${item.name} ${item.aliases.join(" ")}`).includes(
          normalize(filter),
        ),
      ),
    [library, filter],
  );
  return (
    <section className="guide-index">
      <span className="eyebrow">GUIDE LIBRARY</span>
      <h1>{copy.index}</h1>
      {missing && (
        <p className="guide-missing" role="status">
          There is no guide for “{missing}” yet. Choose one of the guides below.
        </p>
      )}
      <label className="guide-filter">
        <Search size={16} />
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${Object.keys(library.items).length} guides`}
          aria-label={`Filter ${copy.index.toLowerCase()}`}
        />
      </label>
      <div className="guide-grid">
        {items.map(([id, item]) => (
          <GuideLink type={type} id={id} className="guide-card" key={id}>
            <img src={item.photos[0].thumb} alt="" loading="lazy" />
            <span>{item.name}</span>
          </GuideLink>
        ))}
      </div>
      {items.length === 0 && <p className="muted">No guides match.</p>}
    </section>
  );
}

export default function GuidePage({ type, query }) {
  const { library, error } = useLibrary(type);
  const guide = library && query ? resolveGuide(library, query) : null;
  const other = type === "exercise" ? "food" : "exercise";
  const OtherIcon = COPY[other].Icon;

  useEffect(() => {
    const previous = document.title;
    document.title = guide
      ? `${guide.name} · Forma`
      : `${COPY[type].index} · Forma`;
    return () => {
      document.title = previous;
    };
  }, [type, guide?.name]);

  // Canonical address for items found by free text, e.g. ?q=Dumbbell Bicep Curls.
  useEffect(() => {
    if (guide && query !== guide.id)
      window.history.replaceState(
        window.history.state,
        "",
        guideHref(type, guide.id),
      );
  }, [type, query, guide?.id]);

  const back = (event) => {
    event.preventDefault();
    if (window.history.state?.forma) window.history.back();
    else navigate("/");
  };

  return (
    <div className="guide-page">
      <header className="guide-topbar">
        <a href="/" className="guide-back" onClick={back}>
          <ChevronLeft size={18} /> Back to plan
        </a>
        <a href="/" className="brand guide-brand" onClick={back}>
          <span className="brand-mark">
            <Activity size={20} />
          </span>
          <span className="brand-name">
            forma<span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Guides">
          <GuideLink type={type} className="guide-nav-link">
            All {type === "exercise" ? "exercises" : "foods"}
          </GuideLink>
          <GuideLink type={other} className="guide-nav-link">
            <OtherIcon size={14} />{" "}
            {other === "exercise" ? "Exercises" : "Foods"}
          </GuideLink>
        </nav>
      </header>
      <main className="guide-main">
        {error ? (
          <div className="error-banner" role="alert">
            {error.message} Reload the page to try again.
          </div>
        ) : !library ? (
          <div className="guide-loading">
            <LoaderCircle className="spin" size={22} /> Loading guide…
          </div>
        ) : guide ? (
          <GuideArticle type={type} guide={guide} key={guide.id} />
        ) : (
          <GuideIndex type={type} library={library} missing={query || null} />
        )}
      </main>
    </div>
  );
}
