import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/">Book of Life</Link>
        <div className="nav-actions">
          <Link href="/login">Sign in</Link>
          <Link className="button small" href="/app">Open app</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Cloud entries. Desktop-powered media.</p>
          <h1>One private journal library, available everywhere you sign in.</h1>
          <p>
            Book of Life keeps journal entries canonical in the cloud while desktop apps
            mirror Markdown files, process photos, generate thumbnails, and hold the full
            media archive when you want local ownership.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/login">Sign in to your library</Link>
            <Link className="button secondary" href="/app">Try the web app</Link>
          </div>
        </div>
        <div className="hero-panel" aria-label="System overview">
          <div className="node cloud">Cloud API</div>
          <div className="node-row">
            <div className="node">Web</div>
            <div className="node">Mobile</div>
            <div className="node">Desktop Host</div>
          </div>
          <div className="media-strip">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>

      <section className="feature-band">
        <article>
          <h2>Entries live in the cloud</h2>
          <p>Every client syncs from one canonical entry history with versioned revisions.</p>
        </article>
        <article>
          <h2>Desktop owns storage choices</h2>
          <p>Choose media folders, upload destinations, host mode, and cloud media policy.</p>
        </article>
        <article>
          <h2>Media can stay local</h2>
          <p>Upload thumbnails and previews by default, then choose which originals go cloud-side.</p>
        </article>
      </section>
    </main>
  );
}
