from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers.auth_routes import router as auth_router
from app.routers.files import router as files_router
from app.routers.insights_routes import router as insights_router
from app.routers.reports import router as reports_router
from app.routers.admin import router as admin_router


app = FastAPI(
    title="BEAM Analytics Backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(auth_router)
app.include_router(files_router, prefix="/api/files", tags=["files"])
app.include_router(insights_router)
app.include_router(reports_router)
app.include_router(admin_router)
