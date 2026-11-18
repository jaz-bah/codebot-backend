BEGIN;

-- 0) Demo user (emailVerified so OAuth linking / flows work) -----------------
INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "username", "role")
SELECT gen_random_uuid()::text, 'Demo', 'demo@gmail.com', true, now(), now(), 'demo', 'user'
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "email" = 'demo@gmail.com');

-- 1) Todos x5 -----------------------------------------------------------------
INSERT INTO "todo" ("user_id", "title", "description", "status", "priority", "due_date", "position")
SELECT u."id", v.title, v.description, v.status, v.priority, v.due_date,
       COALESCE((SELECT MAX(t."position") FROM "todo" t WHERE t."user_id" = u."id"), -1) + ROW_NUMBER() OVER ()
FROM "user" u
CROSS JOIN (VALUES
  ('Ship artboard module',       'CRUD + pagination + tests + migration',        'done',        'high',   NULL::timestamptz),
  ('Write notes e2e suite',      'scripts/e2e-notes.mjs registered in e2e-all',  'in_progress', 'medium', now() + interval '2 days'),
  ('Review OAuth proxy fix',     'Same-origin cookies via server.mjs proxy',     'pending',     'urgent', now() + interval '1 day'),
  ('Clean up stale dist',        'tsbuildinfo cache served an old build once',   'pending',     'low',    NULL::timestamptz),
  ('Plan presets v2',            'Shareable preset links',                       'pending',     'medium', now() + interval '7 days')
) AS v(title, description, status, priority, due_date)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "todo" t WHERE t."user_id" = u."id" AND t."title" = v.title);

-- 2) Experts x5 ----------------------------------------------------------------
INSERT INTO "expert" ("user_id", "title", "description")
SELECT u."id", v.title, v.description
FROM "user" u
CROSS JOIN (VALUES
  ('Senior React reviewer',      $d$Reviews components for hooks misuse, unnecessary re-renders and a11y gaps. Prefers small, composable pieces.$d$),
  ('NestJS architect',           $d$Thinks in modules and DI tokens. Will reject cross-module deep imports and unpiped request bodies.$d$),
  ('Postgres tuner',             $d$Indexes, EXPLAIN plans, expression indexes for NULL-distinct uniqueness. Speaks in query plans.$d$),
  ('CSS design-system nerd',     $d$Semantic tokens over hard-coded hex. CVA variants, container queries, zero !important.$d$),
  ('Release manager',            $d$Owns the checklist: build clean, migrations additive, e2e green, then deploy.$d$)
) AS v(title, description)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "expert" e WHERE e."user_id" = u."id" AND e."title" = v.title);

-- 3) Presets x5 -----------------------------------------------------------------
INSERT INTO "preset" ("user_id", "name", "language", "data")
SELECT u."id", v.name, v.language, v.data
FROM "user" u
CROSS JOIN (VALUES
  ('Button base', 'css', $code$.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  font-weight: 500;
  transition: background-color 150ms ease;
}

.btn:hover {
  background-color: var(--muted);
}$code$),
  ('Fetch wrapper', 'ts', $code$export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}$code$),
  ('Page skeleton', 'html', $code$<main class="page">
  <header class="page__header"></header>
  <section class="page__content"></section>
  <aside class="page__aside"></aside>
</main>$code$),
  ('React hook boilerplate', 'tsx', $code$export function useFeature() {
  const [state, setState] = useState<State>({ status: "idle" });

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "done" });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  return { state, run };
}$code$),
  ('JSON response envelope', 'json', $code${
  "statusCode": 200,
  "message": "OK",
  "data": {},
  "timestamp": "2026-11-10T00:00:00.000Z"
}$code$)
) AS v(name, language, data)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "preset" p WHERE p."user_id" = u."id" AND p."name" = v.name);

-- 4) Tools x5 ---------------------------------------------------------------------
INSERT INTO "tool" ("user_id", "name", "description", "download_link")
SELECT u."id", v.name, v.description, v.link
FROM "user" u
CROSS JOIN (VALUES
  ('pgAdmin 4',          'Postgres administration and query tool',              'https://www.pgadmin.org/download/'),
  ('DBeaver Community',  'Universal database client for the Neon instance',     'https://dbeaver.io/download/'),
  ('Postman',            'API exploration for the /todos /artboards /notes routes', 'https://www.postman.com/downloads/'),
  ('TablePlus',          'Fast native DB GUI with a sane SQL editor',           'https://tableplus.com/download'),
  ('Neon CLI',           'Branch and manage the managed Postgres from a shell', 'https://github.com/neondatabase/neonctl/releases')
) AS v(name, description, link)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "tool" t WHERE t."user_id" = u."id" AND t."name" = v.name);

-- 5) IDE snippets x5 -----------------------------------------------------------------
INSERT INTO "ide_snippet" ("user_id", "language", "data")
SELECT u."id", v.language, v.data
FROM "user" u
CROSS JOIN (VALUES
  ('ts',   $code$console.log("debug:", { props, state });$code$),
  ('css',  $code$.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}$code$),
  ('html', $code$<button type="button" class="btn" aria-label="Close">
  <span aria-hidden="true">&times;</span>
</button>$code$),
  ('psql', $code$SELECT "id", "email", "emailVerified" FROM "user" WHERE "email" = 'demo@gmail.com';$code$),
  ('sh',   $code$npm run migration:run && npm run build && npm start$code$)
) AS v(language, data)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "ide_snippet" s WHERE s."user_id" = u."id" AND s."data" = v.data);

-- 6) Files (documents) x5 ---------------------------------------------------------------
INSERT INTO "document" ("user_id", "name", "description", "url")
SELECT u."id", v.name, v.description, v.url
FROM "user" u
CROSS JOIN (VALUES
  ('architecture-diagram.png', 'Component + data flow overview',   'https://res.cloudinary.com/demo/image/upload/sample.jpg'),
  ('brand-logo.png',           'Current logo, dark variant',       'https://res.cloudinary.com/demo/image/upload/dog.jpg'),
  ('hero-mock.png',            'Landing hero, desktop',            'https://res.cloudinary.com/demo/image/upload/kitten.jpg'),
  ('spec-draft.png',           'Artboard spec sketch',             'https://res.cloudinary.com/demo/image/upload/sample.jpg'),
  ('team-photo.png',           'Offsite photo for the about page', 'https://res.cloudinary.com/demo/image/upload/dog.jpg')
) AS v(name, description, url)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "document" d WHERE d."user_id" = u."id" AND d."name" = v.name);

-- 7) Components x3, each with 2 code files (html + css) ----------------------------------
WITH new_components AS (
  INSERT INTO "component" ("user_id", "name", "preview")
  SELECT u."id", v.name, v.preview
  FROM "user" u
  CROSS JOIN (VALUES
    ('Primary button',  'https://res.cloudinary.com/demo/image/upload/sample.jpg'),
    ('Pricing card',    'https://res.cloudinary.com/demo/image/upload/dog.jpg'),
    ('Navbar',          'https://res.cloudinary.com/demo/image/upload/kitten.jpg')
  ) AS v(name, preview)
  WHERE u."email" = 'demo@gmail.com'
    AND NOT EXISTS (SELECT 1 FROM "component" c WHERE c."user_id" = u."id" AND c."name" = v.name)
  RETURNING "id", "user_id", "name"
)
INSERT INTO "component_file" ("component_id", "user_id", "language", "code", "position")
SELECT c."id", c."user_id", v.language, v.code, v.pos
FROM new_components c
JOIN (VALUES
  ('Primary button', 0, 'html', $code$<button class="btn btn--primary" type="button">
  Get started
</button>$code$),
  ('Primary button', 1, 'css',  $code$.btn--primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.btn--primary:hover {
  background: color-mix(in srgb, var(--primary) 85%, black);
}$code$),
  ('Pricing card',   0, 'html', $code$<article class="pricing">
  <h3 class="pricing__title">Pro</h3>
  <p class="pricing__price">$12<span>/mo</span></p>
  <ul class="pricing__features">
    <li>Unlimited artboards</li>
    <li>Version history</li>
  </ul>
  <button class="btn btn--primary" type="button">Choose Pro</button>
</article>$code$),
  ('Pricing card',   1, 'css',  $code$.pricing {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}
.pricing__price span {
  color: var(--muted-foreground);
  font-size: 0.875rem;
}$code$),
  ('Navbar',         0, 'html', $code$<nav class="navbar">
  <a class="navbar__brand" href="/">Codebot</a>
  <ul class="navbar__links">
    <li><a href="/dashboard">Dashboard</a></li>
    <li><a href="/dashboard/note">Notepad</a></li>
  </ul>
</nav>$code$),
  ('Navbar',         1, 'css',  $code$.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
}
.navbar__links {
  display: flex;
  gap: 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}$code$)
) AS v(name, pos, language, code) ON v.name = c."name";

-- 8) Artboards x5 ----------------------------------------------------------------------------
INSERT INTO "artboard" ("user_id", "title", "content")
SELECT u."id", v.title, v.content
FROM "user" u
CROSS JOIN (VALUES
  ('Landing wireframe',
   $svg$<path d="M20.0 30.0L280.0 30.0"/><path d="M20.0 30.0L20.0 60.0"/><path d="M280.0 30.0L280.0 60.0"/><path d="M20.0 60.0L280.0 60.0"/><text x="30" y="52" font-size="14">LOGO</text><path d="M20.0 90.0L180.0 90.0"/><path d="M20.0 110.0L150.0 110.0"/><path d="M200.0 80.0H270.0V105.0H200.0Z"/><text x="212" y="97" font-size="11">Sign up</text>$svg$),
  ('User flow — sign in',
   $svg$<text x="20" y="30" font-size="14">Start</text><path d="M60.0 25.0L120.0 25.0"/><path d="M115.0 20.0L120.0 25.0"/><path d="M120.0 25.0L115.0 30.0"/><path d="M130.0 10.0H230.0V40.0H130.0Z"/><text x="142" y="29" font-size="11">Verify</text><path d="M240.0 25.0L300.0 25.0"/><path d="M295.0 20.0L300.0 25.0"/><path d="M300.0 25.0L295.0 30.0"/><text x="305" y="30" font-size="14">Dashboard</text>$svg$),
  ('Logo draft',
   $svg$<path d="M150.0 20.0A60.0 60.0 0 1 1 149.9 20.0Z"/><path d="M110.0 60.0L190.0 60.0"/><path d="M150.0 85.0L150.0 35.0"/><text x="105" y="130" font-size="18">CODEBOT</text>$svg$),
  ('Button states',
   $svg$<path d="M20.0 20.0H120.0V50.0H20.0Z"/><text x="35" y="39" font-size="11">Default</text><path d="M20.0 70.0H120.0V100.0H20.0Z"/><text x="40" y="89" font-size="11">Hover</text><path d="M20.0 120.0H120.0V150.0H20.0Z"/><text x="41" y="139" font-size="11">Active</text><path d="M20.0 170.0H120.0V200.0H20.0Z"/><text x="40" y="189" font-size="11">Disabled</text>$svg$),
  ('Auth architecture',
   $svg$<text x="20" y="30" font-size="13">Browser</text><path d="M90.0 25.0L160.0 25.0"/><path d="M155.0 20.0L160.0 25.0"/><text x="95" y="18" font-size="11">cookie</text><text x="170" y="30" font-size="13">Proxy</text><path d="M230.0 25.0L300.0 25.0"/><path d="M295.0 20.0L300.0 25.0"/><text x="310" y="30" font-size="13">Nest</text><path d="M350.0 25.0L420.0 25.0"/><path d="M415.0 20.0L420.0 25.0"/><text x="430" y="30" font-size="13">Neon</text>$svg$)
) AS v(title, content)
WHERE u."email" = 'demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM "artboard" a WHERE a."user_id" = u."id" AND a."title" = v.title);

-- 9) Notes x5 (workspace_file rows + 1:1 note content) ----------------------------------------
WITH new_files AS (
  INSERT INTO "workspace_file" ("user_id", "name", "type", "parent_id", "position")
  SELECT
    u."id",
    v.name,
    'file',
    NULL,
    COALESCE(
      (SELECT MAX(w."position") FROM "workspace_file" w
       WHERE w."user_id" = u."id" AND w."parent_id" IS NULL),
      -1
    ) + ROW_NUMBER() OVER ()
  FROM "user" u
  CROSS JOIN (VALUES
    ('creeds.html'),
    ('meeting-notes.html'),
    ('api-cheatsheet.html'),
    ('reading-list.html'),
    ('deploy-checklist.html')
  ) AS v(name)
  WHERE u."email" = 'demo@gmail.com'
    AND NOT EXISTS (
      SELECT 1 FROM "workspace_file" w
      WHERE w."user_id" = u."id"
        AND w."parent_id" IS NULL
        AND lower(w."name") = lower(v.name)
    )
  RETURNING "id", "user_id", "name"
)
INSERT INTO "note" ("file_id", "user_id", "content")
SELECT f."id", f."user_id", v.content
FROM new_files f
JOIN (VALUES
  ('creeds.html', $html$<h1>Common env creeds</h1><pre><code>MONGODB_URI=mongodb+srv://Codebot:4srpuHY7ggA3STe8@cluster0.if6fpxx.mongodb.net/codebot-v03
NEXTAUTH_SECRET=properAuth3456
GITHUB_ID=Ov23liRs0QIA0FyyRb0Is
GITHUB_SECRET=d6e4fb87b0a5e19b7904abfcda084c9c6c000649
CLOUDINARY_CLOUD_NAME=di2z3avrhf</code></pre><p>Copy to <code>.env.local</code> and fill real values. Never commit <code>.env.local</code>.</p>$html$),
  ('meeting-notes.html', $html$<h1>Standup — notes</h1><ul><li>Artboard module shipped (CRUD + search + sort)</li><li>OAuth state_mismatch root-caused: cross-site cookies via PSL — fixed by same-origin proxy</li><li>Next: seed demo data for the walkthrough</li></ul><p>Owner: Beats</p>$html$),
  ('api-cheatsheet.html', $html$<h1>API cheat sheet</h1><ul><li><strong>Todos</strong> — GET/POST /todos, PATCH /todos/:id, PATCH /todos/reorder</li><li><strong>Artboards</strong> — GET/POST /artboards, PATCH /artboards/:id, DELETE /artboards/:id</li><li><strong>Notes</strong> — GET /files/tree, PATCH /notes/:fileId</li></ul><p>All routes are session-cookie authenticated (<code>credentials: include</code>).</p>$html$),
  ('reading-list.html', $html$<h1>Reading list</h1><ul><li>BetterAuth 1.7 docs — databaseHooks + rateLimit internals</li><li>TypeORM migrations vs synchronize (why we keep it false)</li><li>Public Suffix List — why onrender.com subdomains are cross-site</li></ul>$html$),
  ('deploy-checklist.html', $html$<h1>Deploy checklist</h1><ol><li>npm run build (backend + frontend)</li><li>npm run migration:run against prod DATABASE_URL</li><li>Render: redeploy backend, then frontend</li><li>Smoke: GET /health, sign-in, /todos, /artboards</li></ol>$html$)
) AS v(name, content) ON v.name = f."name"
WHERE NOT EXISTS (SELECT 1 FROM "note" n WHERE n."file_id" = f."id");

COMMIT;
