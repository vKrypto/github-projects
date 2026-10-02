import React, { useMemo, useState } from "react";
import { ArrowUpRight, Copy, Check, Search, LoaderCircle } from "lucide-react";
import { GUIDE_TYPES, guideHref, normalize, useLibrary } from "./library";
import { GuideLink } from "./Guide";

const LABELS = { exercise: "Exercises", food: "Foods" };
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function CopyLink({ href }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.origin + href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          window.prompt("Copy this link", window.location.origin + href);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

// Admin listing of every frontend-only guide page from public/library.
export default function StaticPages() {
  const libraries = {
    exercise: useLibrary("exercise"),
    food: useLibrary("food"),
  };
  const [type, setType] = useState("exercise");
  const [filter, setFilter] = useState("");
  const { library, error } = libraries[type];
  const rows = useMemo(
    () =>
      library
        ? Object.entries(library.items).filter(([id, item]) =>
            normalize(`${id} ${item.name} ${item.aliases.join(" ")}`).includes(
              normalize(filter),
            ),
          )
        : [],
    [library, filter],
  );
  const count = (t) => Object.keys(libraries[t].library?.items || {}).length;
  const photos = GUIDE_TYPES.reduce(
    (n, t) =>
      n +
      Object.values(libraries[t].library?.items || {}).reduce(
        (m, item) => m + item.photos.length,
        0,
      ),
    0,
  );

  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">ADMINISTRATION</span>
        <h1>Static pages</h1>
        <p>
          Exercise and food guides served from the frontend mapping in
          public/library. Plan cards link here automatically when an exercise or
          meal matches.
        </p>
      </div>
      <div className="static-summary">
        <span className="status-pill">{count("exercise")} exercise guides</span>
        <span className="status-pill">{count("food")} food guides</span>
        <span className="status-pill">{photos} photos</span>
      </div>
      <div className="static-toolbar">
        <div className="static-tabs" role="tablist" aria-label="Guide type">
          {GUIDE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={type === t}
              className={type === t ? "selected" : ""}
              onClick={() => setType(t)}
            >
              {LABELS[t]} <span>{count(t)}</span>
            </button>
          ))}
        </div>
        <label className="guide-filter static-filter">
          <Search size={15} />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Filter ${LABELS[type].toLowerCase()}`}
            aria-label={`Filter ${LABELS[type].toLowerCase()}`}
          />
        </label>
        <GuideLink type={type} className="outline static-index-link">
          Open {LABELS[type].toLowerCase()} index <ArrowUpRight size={13} />
        </GuideLink>
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error.message}
        </div>
      ) : !library ? (
        <div className="guide-loading">
          <LoaderCircle className="spin" size={20} /> Loading pages…
        </div>
      ) : (
        <section className="admin-table static-table" role="tabpanel">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Link</th>
                <th>Photos</th>
                {type === "exercise" && <th>Video</th>}
                <th>Matches plan text</th>
                <th>Photo licences</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, item]) => {
                const href = guideHref(type, id);
                const licences = [
                  ...new Set(item.photos.map((p) => p.license)),
                ];
                return (
                  <tr key={id}>
                    <td>
                      <span className="static-page-name">
                        <img src={item.photos[0].thumb} alt="" loading="lazy" />
                        {item.name}
                      </span>
                    </td>
                    <td>
                      <code>{href}</code>
                    </td>
                    <td>{item.photos.length}</td>
                    {type === "exercise" && (
                      <td>
                        {item.video ? (
                          <a
                            className="static-video"
                            href={`https://www.youtube.com/watch?v=${item.video.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title={item.video.title}
                          >
                            {clock(item.video.seconds)} · {item.video.channel}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td
                      className="static-aliases"
                      title={item.aliases.join(", ")}
                    >
                      {item.aliases.slice(0, 3).join(", ")}
                      {item.aliases.length > 3 &&
                        ` +${item.aliases.length - 3}`}
                    </td>
                    <td className="static-licences">{licences.join(", ")}</td>
                    <td>
                      <div className="admin-actions">
                        <GuideLink type={type} id={id} className="outline">
                          <ArrowUpRight size={13} />
                          Open
                        </GuideLink>
                        <CopyLink href={href} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="empty-state">No pages match “{filter}”.</div>
          )}
        </section>
      )}
    </>
  );
}
