# artizART (`pibcad`)

**artizART** is an interactive Augmented Reality (AR) art scanner and 3D exhibition web application. Point a camera at physical paintings to recognize artworks in real time, project 6DoF-tracked 3D GLB models directly onto canvases, detect adjacent canvas pairs to unlock combined seam artworks, save discoveries to a personal collection, and upload new paintings with AI-powered 3D model generation.

---

## Features

- **Real-Time Painting Recognition & 6DoF Tracking**: Uses a Python/OpenCV computer-vision backend (ASIFT/RootSIFT feature matching + homography + `solvePnP`) to simultaneously detect multiple paintings in a camera frame, supporting both rear and mirrored front cameras.
- **Pair Seam Detection & Composite AR Models**: Evaluates the relative geometry and physical edge orientation (`A`, `B`, `C`, `D`) of two adjacent paintings (`irlo1` & `irlo2`) to trigger seamless combined 3D models (`seam-AA`, `seam-BB`, `seam-CC`, `seam-DD`).
- **3D WebGL Rendering**: Renders normalized `.glb` 3D models anchored to canvas poses using Three.js, with smooth state transitions and cross-fading.
- **Artist Studio & Meshy AI Integration**: Authenticated artists can upload new paintings and generate 3D `.glb` models from 2D artwork images via the Meshy AI API (`/artist`).
- **Saved Collection**: Users can bookmark scanned artworks and inspect their saved 3D models in an interactive viewer (`/saved`).
- **Live Calibration, HUD & Target Simulation**: Built-in AR diagnostics HUD, interactive 3D model calibration controls (scale, offset, rotation, wireframe, opacity), target compiler (`/compile`), and one-click target/pair simulations for testing without physical canvases.
- **Motorized Dual-Painting Exhibition Stand**: Einsy RAMBo C++ firmware (`embedded_stand/motoare_x_y_z_lock.ino`) that drives two stepper motors with 12:1 planetary gearboxes and Hall-effect magnet sensors placed every 90° to automatically rotate and align both paintings across seam orientations.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | SvelteKit, Svelte 5 (Runes), TypeScript, Tailwind CSS v4, Three.js |
| **CV Backend** | Python 3.11+, FastAPI, Uvicorn, OpenCV (`opencv-python-headless`), NumPy, Pydantic Settings |
| **Embedded Stand** | C++ (Arduino), Einsy RAMBo, `TMCStepper` (`TMC2130` over SPI), 12:1 Planetary Gearboxes, Hall-Effect Sensors |
| **Auth & Storage** | Supabase (Auth, PostgreSQL, Storage buckets for paintings & 3D models) |
| **3D Generation** | Meshy AI API |
| **Testing** | Vitest, `svelte-check` |
| **Deployment** | Vercel Multi-Services (`vercel.json`), Docker (`backend/Dockerfile`) |

---

## Project Structure

```text
pibcad/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI server (/health, /recognize)
│   │   ├── recognizer.py       # OpenCV ASIFT/RootSIFT + solvePnP detector
│   │   └── config.py           # Environment & Supabase configuration
│   ├── data/                   # Local painting catalog & reference images
│   ├── Dockerfile              # Container image for cloud backend deployment
│   └── requirements.txt        # Python dependencies
├── embedded_stand/
│   └── motoare_x_y_z_lock.ino  # Einsy RAMBo C++ firmware for motorized 2-painting stand
├── scripts/
│   ├── setup-backend.js        # Automated venv & dependency setup
│   ├── run-backend.js          # Cross-platform FastAPI dev launcher
│   ├── compile-targets.js      # Offline target manifest compiler
│   ├── convert-obj-to-glb.py   # OBJ-to-GLB 3D model converter
│   └── generate-demo-glbs.py   # Demo GLB generator
├── src/
│   ├── lib/
│   │   ├── 3d/                 # Three.js AR canvas, GLB loader, model normalization
│   │   ├── calibration/        # Interactive 3D model calibration panel
│   │   ├── camera/             # WebRTC camera stream management
│   │   ├── collection/         # Saved artworks & stability tracking
│   │   ├── gallery/            # Gallery service & WebGL coordinator
│   │   ├── manifest/           # Art manifest types & repository
│   │   ├── recognition/        # Real-time scanner state & API client
│   │   ├── seam/               # Pair seam geometry & pose projection
│   │   ├── server/             # Meshy AI server integration
│   │   ├── state/              # AR state machine (idle, single, loading, pair)
│   │   └── supabase/           # Supabase client & auth helpers
│   └── routes/
│       ├── +page.svelte        # Main AR scanner experience
│       ├── artist/             # Artist upload & 3D generation studio
│       ├── saved/              # User's saved artwork collection
│       ├── login/              # Supabase authentication
│       ├── compile/            # Target compiler UI
│       ├── _dev/calibration/   # Calibration persistence endpoint
│       └── api/                # SvelteKit API proxies (recognize, health, gallery, meshy)
├── static/
│   ├── demo/                   # Manifest, demo target images, and GLB models
│   └── demo-targets/           # Printable calibration & pair target sheets
├── supabase/migrations/        # Database schema migrations
└── vercel.json                 # Vercel Multi-Services configuration
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+ (3.11 recommended)

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Set Up the Python CV Backend

Run the automated setup script to create `backend/.venv`, install Python dependencies, and initialize environment files:

```bash
npm run setup:backend
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
# Client-safe Supabase credentials
PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only secrets
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
MESHY_API_KEY=your-meshy-api-key
```

> **Note:** If Supabase is not configured or unreachable, the CV backend automatically falls back to the local painting catalog in `backend/data/paintings.json`.

### 4. Run Locally

Start both the FastAPI CV backend and the SvelteKit frontend concurrently:

```bash
npm run dev
```

- **Frontend:** `http://localhost:5173`
- **Backend:** `http://localhost:8000`

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Run both the Python CV backend and SvelteKit dev server concurrently |
| `npm run dev:frontend` | Run only the Vite/SvelteKit frontend dev server |
| `npm run dev:backend` | Run only the FastAPI backend server |
| `npm run setup:backend` | Create Python virtual environment and install `backend/requirements.txt` |
| `npm run build` | Build the production SvelteKit application |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Run `svelte-kit sync` and `svelte-check` type verification |
| `npm test` | Run the Vitest unit test suite |
| `npm run compile:targets` | Compile AR target definitions |
| `npm run convert:obj` | Convert `.obj` 3D assets to `.glb` |

---

## API Endpoints

- `POST /api/recognize` — Proxies camera frames to the FastAPI CV backend (with local Python fallback) and returns detected painting IDs, canonical corners, snapped rotations, and 6DoF poses.
- `GET /api/health` — Returns live frontend and backend health diagnostics.
- `GET/POST /api/gallery` — Manages gallery artwork metadata.
- `POST /api/meshy` — Initiates and polls Meshy AI 2D-to-3D model generation tasks.
- `POST /_dev/calibration` — Persists 3D model calibration transforms into `static/demo/manifest.json` during development.

---

## Deployment

### Vercel (Multi-Services)

The repository includes a `vercel.json` configured for Vercel Multi-Services:
- **`app`**: SvelteKit frontend bound to the backend service via `BACKEND_URL`.
- **`backend`**: FastAPI service with entrypoint `app.main:app`.

Set `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `MESHY_API_KEY` in your Vercel project environment variables.

### Docker (Backend)

To deploy the CV backend standalone (e.g., Railway, Fly.io, Render, or Cloud Run):

```bash
cd backend
docker build -t artizart-backend .
docker run -p 8000:8000 artizart-backend
```

Then set `BACKEND_URL` on the SvelteKit frontend to point to the deployed container URL.

---

## Embedded Motorized Stand (Einsy RAMBo)

The physical dual-painting exhibition stand is controlled by C++ Arduino firmware located at [`embedded_stand/motoare_x_y_z_lock.ino`](embedded_stand/motoare_x_y_z_lock.ino), targeting an **Einsy RAMBo** board with onboard **TMC2130** stepper drivers configured over SPI (`TMCStepper`, `1000 mA` RMS, `16×` microstepping, SpreadCycle mode).

### Mechanical & Sensor Architecture

- **Drivetrain**: Two 200-step/rev stepper motors (axes **Y** and **Z**) coupled to **12:1 planetary gearboxes** (`3,200` microsteps per motor revolution → **`9,600` microsteps per 90° painting rotation**).
- **Magnetic Indexing (90° Increments)**: Each painting mount has magnets placed every **90°** and a dedicated active-LOW Hall-effect sensor (`INPUT_PULLUP`) to snap the canvases into exact cardinal orientations (`0°`, `90°`, `180°`, `270°`) for AR seam alignment.
- **Safety Cutoff**: If a magnet is not detected within `19,200` microsteps (`180°`, `2×` the target 90° travel), the motor automatically disables and logs an error over Serial (`115200 baud`).

### Einsy RAMBo Pinout

| Axis / Sensor | Role | STEP | DIR | ENABLE | CS (SPI) | Hall Sensor Pin |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Motor X** | Startup sequence (10 steps, `1000 µs` delay) | `37` | `49` | `29` | `41` | — |
| **Motor Y** | Painting 1 rotation (`12:1` gearbox) | `36` | `48` | `28` | `39` | `11` (Y Endstop `S`) |
| **Motor Z** | Painting 2 rotation (`12:1` gearbox) | `35` | `47` | `27` | `67` | `10` (Probe `S`) |

### Motion Control & State Machine

After Motor X completes its 10-step startup sequence, Motors Y and Z run **concurrently and non-blockingly** using `micros()` scheduling and a **trapezoidal speed ramp** (`30%` linear acceleration from `1400 µs` to `350 µs` half-step delay, cruise, and `30%` deceleration):

1. **`RAMPA_1`**: Rotates each painting smoothly until its Hall sensor detects the next 90° magnet (`LOW`).
2. **`ASTEPTARE` (Locked Hold)**: Keeps the stepper driver enabled (`ENABLE = LOW`) for **30 seconds** (`PAUZA_MS = 30000`) to hold the paintings rigidly aligned for AR scanning.
3. **`RAMPA_2`**: Starts the second 90° rotation, first waiting for the Hall sensor to clear (`HIGH`) so it does not immediately re-trigger on the starting magnet, then stopping at the next magnet.
4. **`GATA` (Unlocked)**: Disables the driver (`ENABLE = HIGH`) to release holding torque once the cycle finishes.

---

## Testing & Verification

```bash
# Run unit tests (seam math, AR state machine, model normalization, Meshy service, etc.)
npm test

# Type-check Svelte and TypeScript
npm run check

# Verify production build
npm run build
```
