# BEAM Analytics — Data Health Platform

BEAM Analytics is a SaaS tool that helps small and medium businesses understand and improve the quality of their data — no data engineering background required.

Upload a spreadsheet, get a plain-English health score, and see exactly which fields need attention.

---

## What It Does

| Feature | Description |
|---|---|
| **File Upload** | Upload CSV or Excel files (up to 50 MB) via a drag-and-drop interface |
| **File Overview** | Instant charts and key metrics for any uploaded dataset |
| **Data Health Score** | A score from 0–100 (with letter grade) covering completeness, uniqueness, validity, and value distribution |
| **Plain-Language Issues** | Every diagnostic finding is explained in plain English with a severity label (Critical / Warning / Note) and a recommended next step |
| **Field-by-Field Breakdown** | A sortable table showing null rate, distinct values, min/max/average, and outlier count for every column |
| **AI Summary** | Optional GPT-powered plain-English summary of dataset patterns (requires `OPENAI_API_KEY`) |
| **Multi-Tenant** | Each company (tenant) has its own isolated data and login |
| **File Retention** | Uploaded files are stored in Azure Blob Storage and can be re-downloaded at any time |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Next.js)                 │
│  - /login, /register                                │
│  - /dashboard          — welcome + upload sidebar   │
│  - /dashboard/file/[id]                             │
│      ├── File Overview tab (KPIs + charts)          │
│      └── Data Health tab (score + issues + detail)  │
└───────────────────────┬─────────────────────────────┘
                        │ REST / JSON
┌───────────────────────▼─────────────────────────────┐
│                   Backend (FastAPI)                  │
│  POST /auth/register, /auth/login, /auth/refresh    │
│  GET  /api/files/                                   │
│  POST /api/files/upload                             │
│  GET  /api/files/{id}/download                      │
│  POST /api/files/{id}/insights   — chart pipeline  │
│  POST /api/files/{id}/health     — health engine   │
│  POST /api/files/{id}/ai-summary — GPT summary     │
└───────────────────────┬─────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  Azure SQL Database            Azure Blob Storage
  (tenants, users, files)       (raw uploaded files)
```

### Key Backend Files

| File | Role |
|---|---|
| `backend/app/main.py` | FastAPI app entry point, CORS, router registration |
| `backend/app/routers/files.py` | File CRUD, insights, and **data health engine** |
| `backend/app/routers/auth_routes.py` | Registration, login, token refresh |
| `backend/app/routers/insights_routes.py` | POST insights with filter support |
| `backend/app/insights.py` | Chart generation and AI summary pipeline |
| `backend/app/auth.py` | JWT helpers, `get_current_user` dependency |
| `backend/app/models.py` | SQLAlchemy models: Tenant, User, File |
| `backend/app/config.py` | Environment-driven settings (Azure, JWT) |

### Key Frontend Files

| File | Role |
|---|---|
| `frontend/src/app/dashboard/file/[id]/page.tsx` | Tabbed file detail page (Overview + Health) |
| `frontend/src/app/dashboard/file/[id]/HealthDiagnosticView.tsx` | Full health diagnostic UI |
| `frontend/src/app/dashboard/file/[id]/AIWidget.tsx` | Floating AI summary panel |
| `frontend/src/app/dashboard/file/[id]/FilterPanel.tsx` | Category filter sidebar |
| `frontend/src/components/dashboard/SidebarContent.tsx` | Upload form + file list |
| `frontend/src/context/AuthContext.tsx` | JWT token management, login/logout |
| `frontend/src/lib/api.ts` | Typed API client functions |

---

## Data Health Scoring

The health score (0–100) is a weighted average of four dimensions:

| Dimension | Weight | What it measures |
|---|---|---|
| **Complete Information** | 35% | Percentage of cells with missing/empty data |
| **No Duplicate Records** | 30% | Rate of exact duplicate rows |
| **Correct Formatting** | 20% | Columns where values don't match their apparent type |
| **Realistic Values** | 15% | Numeric outliers detected via IQR method |

Each dimension score is 100 minus a proportional penalty for the issue rate found.

### Grade Scale

| Grade | Score | Meaning |
|---|---|---|
| A | 90–100 | Excellent |
| B | 80–89 | Good |
| C | 70–79 | Fair |
| D | 60–69 | Poor |
| F | < 60 | Critical |

---

## Multi-Tenant Isolation

Every user belongs to a tenant (company). The system enforces isolation at two levels:

1. **Database**: All file queries filter on `tenant_id` extracted from the JWT.
2. **Blob Storage**: All files are stored under `tenant_{tenant_id}/file_{file_id}/raw/{filename}`.

A user cannot access another tenant's files through any current endpoint.

---

## Local Development Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- An Azure SQL database (or a SQL Server instance)
- An Azure Blob Storage account

### Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Create a .env file with required variables
cat > .env << 'EOF'
AZURE_SQL_CONNSTRING="Server=...;Database=...;User ID=...;Password=...;"
AZURE_BLOB_CONNSTRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
BLOB_CONTAINER=tenant-files
JWT_SECRET_KEY=your-secret-key-here
OPENAI_API_KEY=sk-...   # optional — enables AI summaries
EOF

# Run the development server
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > .env.local

# Run the development server
npm run dev
```

The frontend will be available at `http://localhost:3000`.

---

## Deployment

The application is deployed to **Azure Container Apps** via GitHub Actions.

- Backend workflow: `.github/workflows/deploy-backend.yml`
- Container App workflow: `.github/workflows/deploy-containerapp.yml`

Required secrets: `AZURE_CREDENTIALS`, `AZURE_SQL_CONNSTRING`, `AZURE_BLOB_CONNSTRING`, `JWT_SECRET_KEY`, `OPENAI_API_KEY` (optional).

---

## Supported File Types

| Format | Extension | Notes |
|---|---|---|
| CSV | `.csv` | UTF-8 and Latin-1 encoding supported |
| Excel | `.xlsx` | All sheets merged; first sheet used |
| Excel (legacy) | `.xls` | Supported via `xlrd` |

Maximum file size: **50 MB**.

---

## Known Limitations / Roadmap

- No dataset caching — every request re-downloads and re-parses from Azure Blob
- No schema drift detection (comparing v1 vs v2 of the same dataset)
- No user-configurable validation rules (custom acceptable value ranges, required fields)
- No multi-file comparison or join capability
- AI summary requires an OpenAI API key and is not cached between requests
- Rate limiting is not yet implemented on auth endpoints
