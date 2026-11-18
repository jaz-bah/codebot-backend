-- Demo User Creation SQL Script
-- This script creates the demo user directly in the BetterAuth database
-- and populates it with all the demo content from the JSON file

-- Set up the demo user
WITH demo_user AS (
    INSERT INTO user (id, email, email_verified, password_hash, name, username, created_at, updated_at)
    VALUES (
        'demo-user-12345',  -- User ID
        'demo@gmail.com',   -- Email
        true,              -- Email verified (bypasses verification)
        'demo1234',        -- Password (will be hashed by BetterAuth)
        'Demo User',       -- Name
        'demo_user',        -- Username
        CURRENT_TIMESTAMP, -- Created at
        CURRENT_TIMESTAMP  -- Updated at
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, username
)

-- Create profile for the demo user
INSERT INTO profile (user_id, nickname, created_at, updated_at)
SELECT
    id,
    username,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM demo_user
ON CONFLICT (user_id) DO NOTHING;

-- Insert demo presets
INSERT INTO preset (id, user_id, name, language, data, created_at, updated_at)
VALUES
    (
        'preset-demo-1',
        'demo-user-12345',
        'React useEffect Hook',
        'typescript',
        'useEffect(() => {
  console.log('\''Component mounted'\'');
  return () => {
    console.log('\''Component unmounted'\'');
  };
}, []);',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'preset-demo-2',
        'demo-user-12345',
        'CSS Grid Layout',
        'css',
        '.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
  padding: 2rem;
}',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'preset-demo-3',
        'demo-user-12345',
        'Async/Await Pattern',
        'javascript',
        'async function fetchData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('\''Error fetching data:'\'', error);
    throw error;
  }
}',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'preset-demo-4',
        'demo-user-12345',
        'ES6 Arrow Functions',
        'javascript',
        'const numbers = [1, 2, 3, 4, 5];

const doubled = numbers.map(num => num * 2);
const filtered = numbers.filter(num => num > 2);
const sum = numbers.reduce((acc, num) => acc + num, 0);

console.log(doubled); // [2, 4, 6, 8, 10]',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'preset-demo-5',
        'demo-user-12345',
        'Tailwind CSS Button',
        'html',
        '<button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
  Click Me!
</button>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Insert demo components
INSERT INTO component (id, user_id, name, preview, created_at, updated_at)
VALUES
    (
        'component-demo-1',
        'demo-user-12345',
        'Responsive Card Component',
        'https://picsum.photos/seed/card1/400/300',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'component-demo-2',
        'demo-user-12345',
        'Navigation Bar',
        'https://picsum.photos/seed/navbar2/400/300',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'component-demo-3',
        'demo-user-12345',
        'Form Input Group',
        'https://picsum.photos/seed/form3/400/300',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'component-demo-4',
        'demo-user-12345',
        'Table Component',
        'https://picsum.photos/seed/table4/400/300',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'component-demo-5',
        'demo-user-12345',
        'Modal Dialog',
        'https://picsum.photos/seed/modal5/400/300',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Insert component files (only for components that need them)
INSERT INTO component_file (id, component_id, user_id, language, code, position, created_at, updated_at)
VALUES
    -- Component files for Component 1 (Card Component)
    (
        'file-demo-1-1',
        'component-demo-1',
        'demo-user-12345',
        'tsx',
        'export default function Card({ title, children }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-sm mx-auto">
      <h2 className="text-xl font-bold mb-4 text-gray-800">{title}</h2>
      <div className="text-gray-600">{children}</div>
    </div>
  );
}',
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'file-demo-1-2',
        'component-demo-1',
        'demo-user-12345',
        'css',
        '.card-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f3f4f6;
}',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    -- Component file for Component 2 (Navigation Bar)
    (
        'file-demo-2-1',
        'component-demo-2',
        'demo-user-12345',
        'tsx',
        'export function Navbar() {
  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="flex justify-between items-center max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold">Logo</h1>
        <ul className="flex space-x-4">
          <li><a href="/" className="hover:text-blue-300">Home</a></li>
          <li><a href="/about" className="hover:text-blue-300">About</a></li>
          <li><a href="/contact" className="hover:text-blue-300">Contact</a></li>
        </ul>
      </div>
    </nav>
  );
}',
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    -- Component files for Component 3 (Form Input Group)
    (
        'file-demo-3-1',
        'component-demo-3',
        'demo-user-12345',
        'tsx',
        'export function FormInput({ label, type = '\''text'\'', placeholder, value, onChange }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}',
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'file-demo-3-2',
        'component-demo-3',
        'demo-user-12345',
        'css',
        '.form-group {
  margin-bottom: 1.5rem;
}

.label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.input-field {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  transition: border-color 0.15s ease-in-out;
}

.input-field:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Insert demo posts
INSERT INTO post (id, user_id, resource_type, resource_id, title, description, created_at, updated_at)
VALUES
    (
        'post-demo-1',
        'demo-user-12345',
        'preset',
        'preset-demo-1',
        'React useEffect Hook Best Practices',
        'A comprehensive guide on using useEffect hooks effectively in React components, including cleanup functions and dependency arrays.',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'post-demo-2',
        'demo-user-12345',
        'component',
        'component-demo-1',
        'Responsive Card Component Implementation',
        'Building a reusable and responsive card component with proper styling, accessibility features, and component structure.',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'post-demo-3',
        'demo-user-12345',
        'tool',
        'tool-demo-1',
        'ESLint Configuration for TypeScript Projects',
        'Essential ESLint setup and rules configuration for TypeScript projects to maintain code quality and consistency.',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'post-demo-4',
        'demo-user-12345',
        'expert',
        'expert-demo-1',
        'Modern JavaScript Patterns and Practices',
        'Exploring advanced JavaScript patterns, best practices, and modern techniques for writing clean and maintainable code.',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'post-demo-5',
        'demo-user-12345',
        'snippet',
        'snippet-demo-1',
        'CSS Animation for Dropdown Menus',
        'Smooth and accessible CSS animations for creating dropdown menus with proper transitions and user experience.',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Insert demo experts
INSERT INTO expert (id, user_id, title, description, created_at, updated_at)
VALUES
    (
        'expert-demo-1',
        'demo-user-12345',
        'Senior JavaScript Developer',
        '<p>Experienced JavaScript developer with 5+ years of expertise in building scalable web applications. Proficient in modern ES6+ features, reactive programming, and performance optimization.</p><p>Specialized in React, Node.js, and cloud architecture patterns. Passionate about writing clean, maintainable code and mentoring junior developers.</p>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'expert-demo-2',
        'demo-user-12345',
        'UI/UX Designer',
        '<p>Creative UI/UX designer with a strong eye for detail and user-centered design principles. Expert in Figma, Adobe Creative Suite, and design systems.</p><p>Specializes in creating intuitive interfaces, improving user engagement, and translating business requirements into elegant visual solutions.</p>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'expert-demo-3',
        'demo-user-12345',
        'DevOps Engineer',
        '<p>DevOps engineer specializing in cloud infrastructure, CI/CD pipelines, and automation. Experience with AWS, Docker, Kubernetes, and modern deployment strategies.</p><p>Expert in infrastructure as code, monitoring, and scaling applications for high availability.</p>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'expert-demo-4',
        'demo-user-12345',
        'Backend Developer',
        '<p>Backend developer with expertise in building robust server-side applications. Skilled in Node.js, Python, database design, and API development.</p><p>Focus on creating scalable architectures, implementing security best practices, and optimizing database performance.</p>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'expert-demo-5',
        'demo-user-12345',
        'Data Scientist',
        '<p>Data scientist with strong analytical skills and expertise in machine learning, data visualization, and statistical modeling.</p><p>Proficient in Python, R, SQL, and data visualization tools. Passionate about turning data into actionable insights and predictive models.</p>',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Insert demo tools
INSERT INTO tool (id, user_id, name, description, download_link, created_at, updated_at)
VALUES
    (
        'tool-demo-1',
        'demo-user-12345',
        'ESLint Configuration',
        'Essential ESLint setup for TypeScript projects with Airbnb style guide and React hooks rules',
        'https://github.com/airbnb/javascript',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'tool-demo-2',
        'demo-user-12345',
        'Prettier Code Formatter',
        'Modern code formatter that enforces consistent style across your codebase',
        'https://prettier.io/',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'tool-demo-3',
        'demo-user-12345',
        'Docker Compose Setup',
        'Docker Compose configuration for local development with PostgreSQL, Redis, and application services',
        'https://docs.docker.com/compose/',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'tool-demo-4',
        'demo-user-12345',
        'Jest Testing Framework',
        'Comprehensive testing framework for JavaScript applications with mocking and coverage reporting',
        'https://jestjs.io/',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'tool-demo-5',
        'demo-user-12345',
        'GitHook Pre-commit',
        'Pre-commit hooks for linting, formatting, and security checks before committing code',
        'https://git-scm.com/docs/githooks',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Post-creation actions to add votes to demo posts
UPDATE post SET vote_count = 15 WHERE id = 'post-demo-1';
UPDATE post SET vote_count = 8 WHERE id = 'post-demo-2';
UPDATE post SET vote_count = 23 WHERE id = 'post-demo-3';
UPDATE post SET vote_count = 12 WHERE id = 'post-demo-4';
UPDATE post SET vote_count = 6 WHERE id = 'post-demo-5';

COMMIT;