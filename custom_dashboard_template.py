
from dash import Dash, dcc, html, Input, Output, State, callback, MATCH, ALL
import dash
import pandas as pd
import numpy as np
import plotly.express as px
import uuid

# ========================================
# 1. Load data (do not change)
# ========================================
df = pd.read_csv("final_data.csv")
if "BMI" not in df.columns and {"Weight (kg)", "Height (m)"}.issubset(df.columns):
    df["BMI"] = df["Weight (kg)"] / (df["Height (m)"] ** 2)

ALL_COLS = df.columns.tolist()
NUM_COLS = df.select_dtypes(include=[np.number]).columns.tolist()
CAT_COLS = df.select_dtypes(include=["object", "category", "bool"]).columns.tolist()

# ========================================
# 2. App + Theme
# ========================================
app = Dash(__name__, suppress_callback_exceptions=True)

NAVY = "#002B5B"
TEAL = "#00A3E0"
WHITE = "#FFFFFF"
LIGHT = "#F5F7FA"
PLOT_BG = "#F8FAFC"
DARK_TEXT = "#1F2A44"
PASTEL = px.colors.qualitative.Pastel

custom_css = f"""
html, body {{ margin:0; padding:0; width:100%; height:100%; background:{LIGHT}; }}
* {{ box-sizing:border-box; font-family: 'Segoe UI', sans-serif; }}
a {{ color:{TEAL}; }}
.app-card {{ background:{WHITE}; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08); }}
.app-pill {{ padding:6px 10px; border-radius:999px; font-size:12px; font-weight:600; }}
.pill-low {{ background:#E7F6EF; color:#0B6E4F; }}
.pill-med {{ background:#FFF2D6; color:#8A5B00; }}
.pill-high {{ background:#FFE1E1; color:#9B1C1C; }}
.button-primary {{
  background:{TEAL}; color:white; border:none; padding:12px 18px; border-radius:10px;
  font-weight:600; cursor:pointer; box-shadow:0 8px 20px rgba(0,163,224,0.25);
}}
.button-secondary {{
  background:{NAVY}; color:white; border:none; padding:10px 16px; border-radius:10px;
  font-weight:600; cursor:pointer;
}}
.button-danger {{
  background:#E74C3C; color:white; border:none; padding:8px 12px; border-radius:8px;
  font-weight:600; cursor:pointer;
}}
.section-title {{ color:{NAVY}; font-weight:700; font-size:20px; }}
.subtle {{ color:#6B7280; font-size:13px; }}
.focusable:focus {{ outline:3px solid rgba(0,163,224,0.35); outline-offset:2px; }}
"""

app.index_string = f"""
<!DOCTYPE html>
<html>
<head>
  {{%metas%}}
  <title>BEAM Analytics</title>
  {{%favicon%}}
  {{%css%}}
  <style>{custom_css}</style>
</head>
<body>
  {{%app_entry%}}
  <footer>{{%config%}}{{%scripts%}}{{%renderer%}}</footer>
</body>
</html>
"""

# ========================================
# 3. Helpers
# ========================================

def make_empty_figure(message: str):
    fig = px.scatter()
    fig.update_layout(
        title=message,
        xaxis={"visible": False},
        yaxis={"visible": False},
        annotations=[
            dict(
                text=message,
                x=0.5,
                y=0.5,
                xref="paper",
                yref="paper",
                showarrow=False,
                font={"size": 14, "color": "#6B7280"},
            )
        ],
        paper_bgcolor=WHITE,
        plot_bgcolor=PLOT_BG,
        height=380,
        margin=dict(l=40, r=40, t=60, b=40),
    )
    return fig


def apply_global_filters(frame: pd.DataFrame, values, ids):
    filtered = frame
    if not values or not ids:
        return filtered
    for val, meta in zip(values, ids):
        col = meta.get("col")
        if not col or col not in filtered.columns:
            continue
        if val is None or val == [] or val == "":
            continue
        if isinstance(val, list):
            filtered = filtered[filtered[col].isin(val)]
        else:
            filtered = filtered[filtered[col] == val]
    return filtered


def chart_requires_y(chart_type: str) -> bool:
    return chart_type in {"line", "scatter", "box"}


def build_figure(frame: pd.DataFrame, chart_type: str, x, y, color, agg, title):
    if not x:
        return make_empty_figure("Select an X axis."), "Select an X axis to render the chart."
    if x not in frame.columns:
        return make_empty_figure("Selected X does not exist."), "The selected X column is missing."
    if chart_requires_y(chart_type) and not y:
        return make_empty_figure("Select a Y axis."), "This chart requires a Y axis."
    if y and y not in frame.columns:
        return make_empty_figure("Selected Y does not exist."), "The selected Y column is missing."
    if y and y not in NUM_COLS:
        return make_empty_figure("Y must be numeric."), "Select a numeric Y column for this chart."
    if color and color not in frame.columns:
        return make_empty_figure("Selected color does not exist."), "The selected color column is missing."

    color = color or None
    safe_title = title or "Untitled Chart"

    try:
        if chart_type == "bar":
            if y:
                group_cols = [x] + ([color] if color and color != x else [])
                grouped = frame.groupby(group_cols, dropna=False)[y]
                if agg == "median":
                    data = grouped.median().reset_index()
                elif agg == "sum":
                    data = grouped.sum().reset_index()
                elif agg == "count":
                    data = grouped.count().reset_index()
                else:
                    data = grouped.mean().reset_index()
                fig = px.bar(
                    data,
                    x=x,
                    y=y,
                    color=color,
                    color_discrete_sequence=PASTEL,
                )
            else:
                counts = frame[x].value_counts(dropna=False).reset_index()
                counts.columns = [x, "count"]
                fig = px.bar(counts, x=x, y="count", color_discrete_sequence=PASTEL)
        elif chart_type == "line":
            group_cols = [x] + ([color] if color and color != x else [])
            grouped = frame.groupby(group_cols, dropna=False)[y].mean().reset_index()
            fig = px.line(
                grouped,
                x=x,
                y=y,
                color=color,
                markers=True,
                color_discrete_sequence=PASTEL,
            )
        elif chart_type == "scatter":
            fig = px.scatter(
                frame,
                x=x,
                y=y,
                color=color,
                color_discrete_sequence=PASTEL,
            )
        elif chart_type == "box":
            fig = px.box(
                frame,
                x=x,
                y=y,
                color=color,
                color_discrete_sequence=PASTEL,
            )
        elif chart_type == "histogram":
            fig = px.histogram(
                frame,
                x=x,
                color=color,
                nbins=40,
                color_discrete_sequence=PASTEL,
            )
        elif chart_type == "pie":
            counts = frame[x].value_counts(dropna=False).reset_index()
            counts.columns = [x, "count"]
            fig = px.pie(counts, names=x, values="count", color_discrete_sequence=PASTEL)
        elif chart_type == "sunburst":
            path = [x] + ([color] if color else [])
            fig = px.sunburst(frame, path=path, color_discrete_sequence=PASTEL)
        else:
            fig = make_empty_figure("Unsupported chart type.")

        fig.update_layout(
            title=safe_title,
            paper_bgcolor=WHITE,
            plot_bgcolor=PLOT_BG,
            font_color=DARK_TEXT,
            title_font_color=TEAL,
            margin=dict(l=40, r=40, t=60, b=40),
            height=420,
        )
        return fig, ""
    except (ValueError, TypeError, KeyError) as exc:
        return make_empty_figure("Unable to render chart."), f"Chart error: {exc}"

def make_filter_controls(prefix: str):
    if not CAT_COLS:
        return html.Div("No categorical columns available for filters.", className="subtle")
    cols = CAT_COLS[:3]
    controls = []
    for col in cols:
        controls.append(
            html.Div(
                [
                    html.Div(col, className="subtle"),
                    dcc.Dropdown(
                        id={"type": f"{prefix}-filter", "col": col},
                        options=[{"label": v, "value": v} for v in sorted(df[col].dropna().unique().tolist())],
                        multi=True,
                        placeholder=f"Filter {col}",
                        className="focusable",
                    ),
                ],
                style={"minWidth": "220px"},
            )
        )
    return html.Div(controls, style={"display": "flex", "gap": "16px", "flexWrap": "wrap"})


def make_chart_card(uid: str, tool: str, defaults: dict | None = None):
    defaults = defaults or {}
    return html.Div(
        [
            html.Div(
                [
                    html.Div(
                        [
                            html.Div("Chart Title", className="subtle"),
                            dcc.Input(
                                id={"type": f"{tool}-title", "id": uid},
                                value=defaults.get("title", "Untitled Chart"),
                                className="focusable",
                                style={"width": "100%", "padding": "8px", "borderRadius": "8px"},
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div("Chart Type", className="subtle"),
                            dcc.Dropdown(
                                id={"type": f"{tool}-type", "id": uid},
                                value=defaults.get("type", "bar"),
                                clearable=False,
                                options=[
                                    {"label": t, "value": t}
                                    for t in ["bar", "line", "scatter", "box", "histogram", "pie", "sunburst"]
                                ],
                                className="focusable",
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div("X Axis", className="subtle"),
                            dcc.Dropdown(
                                id={"type": f"{tool}-x", "id": uid},
                                placeholder="Select X",
                                options=[{"label": c, "value": c} for c in ALL_COLS],
                                value=defaults.get("x"),
                                className="focusable",
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div("Y Axis (numeric)", className="subtle"),
                            dcc.Dropdown(
                                id={"type": f"{tool}-y", "id": uid},
                                placeholder="Select Y",
                                options=[{"label": c, "value": c} for c in NUM_COLS],
                                value=defaults.get("y"),
                                disabled=not bool(NUM_COLS),
                                className="focusable",
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div("Aggregation", className="subtle"),
                            dcc.Dropdown(
                                id={"type": f"{tool}-agg", "id": uid},
                                value=defaults.get("agg", "mean"),
                                clearable=False,
                                options=[
                                    {"label": "Mean", "value": "mean"},
                                    {"label": "Median", "value": "median"},
                                    {"label": "Sum", "value": "sum"},
                                    {"label": "Count", "value": "count"},
                                ],
                                className="focusable",
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Div(
                        [
                            html.Div("Color / Group", className="subtle"),
                            dcc.Dropdown(
                                id={"type": f"{tool}-color", "id": uid},
                                placeholder="Optional",
                                options=[{"label": "None", "value": ""}]
                                + [{"label": c, "value": c} for c in ALL_COLS],
                                value=defaults.get("color", ""),
                                className="focusable",
                                persistence=True,
                            ),
                        ],
                        style={"marginBottom": "10px"},
                    ),
                    html.Button(
                        "Remove",
                        id={"type": f"{tool}-remove", "id": uid},
                        className="button-danger focusable",
                    ),
                ],
                style={"width": "300px", "padding": "18px"},
            ),
            html.Div(
                [
                    html.Div(
                        id={"type": f"{tool}-message", "id": uid},
                        className="subtle",
                        style={"minHeight": "20px", "marginBottom": "6px"},
                    ),
                    dcc.Graph(id={"type": f"{tool}-graph", "id": uid}),
                ],
                style={"flex": "1", "padding": "12px"},
            ),
        ],
        className="app-card",
        style={"display": "flex", "gap": "20px", "marginBottom": "20px"},
    )

def health_findings(df_in: pd.DataFrame):
    if df_in is None or df_in.empty:
        return {
            "error": "No data loaded. Ensure final_data.csv is present and non-empty.",
        }

    rows = int(df_in.shape[0])
    cols = int(df_in.shape[1])
    missing_rate = float(df_in.isna().mean().mean()) if cols else 0.0
    dup_rate = float(df_in.duplicated().mean()) if rows else 0.0

    parse_issues = 0
    for c in df_in.columns:
        s = df_in[c]
        if s.dtype == "object":
            sample = s.dropna().astype(str).head(200)
            if sample.empty:
                continue
            looks_numeric = sample.str.match(r"^[\d,.\-]+$").mean()
            coerced = pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce")
            fail_rate = float(coerced.isna().mean())
            if looks_numeric > 0.6 and fail_rate > 0.2:
                parse_issues += 1

    numeric_cols = df_in.select_dtypes(include=[np.number]).columns.tolist()
    outlier_rate = 0.0
    if numeric_cols:
        sample = df_in[numeric_cols].dropna()
        if len(sample) > 50000:
            sample = sample.sample(n=50000, random_state=42)
        if len(sample) > 20:
            z = (sample - sample.mean()) / sample.std(ddof=0).replace(0, np.nan)
            outlier_rate = float(np.nanmean((np.abs(z) > 3).mean()))

    score = 100
    score -= int(min(40, missing_rate * 100))
    score -= int(min(30, dup_rate * 100))
    score -= int(min(20, parse_issues * 8))
    score -= int(min(10, outlier_rate * 100))
    score = max(0, score)

    grade = "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 70 else "D" if score >= 60 else "F"

    issues = []
    if missing_rate > 0.05:
        issues.append(
            {
                "category": "Completeness",
                "severity": "med" if missing_rate < 0.2 else "high",
                "title": "Missing values detected",
                "detail": f"Average missing rate is {missing_rate:.1%}.",
                "rec": "Prioritize columns with the highest null rate and decide on imputation or filtering.",
            }
        )
    if dup_rate > 0.01:
        issues.append(
            {
                "category": "Uniqueness",
                "severity": "med" if dup_rate < 0.1 else "high",
                "title": "Duplicate rows detected",
                "detail": f"Duplicate rate is {dup_rate:.1%}.",
                "rec": "Define a primary key and deduplicate based on business rules.",
            }
        )
    if parse_issues > 0:
        issues.append(
            {
                "category": "Validity",
                "severity": "low",
                "title": "Possible numeric parsing issues",
                "detail": f"{parse_issues} columns appear numeric but contain non-numeric values.",
                "rec": "Normalize numeric formats (commas, symbols) before ingestion.",
            }
        )
    if outlier_rate > 0.02:
        issues.append(
            {
                "category": "Outliers",
                "severity": "low",
                "title": "Outlier rate above threshold",
                "detail": f"Approximate outlier rate is {outlier_rate:.1%}.",
                "rec": "Review distributions for heavy tails and consider caps or winsorization.",
            }
        )

    expected_cols = ["Calories_Burned", "Workout_Type", "Gender", "Experience_Level"]
    missing_expected = [c for c in expected_cols if c not in df_in.columns]
    if missing_expected:
        issues.append(
            {
                "category": "Schema",
                "severity": "low",
                "title": "Expected columns missing",
                "detail": "Missing: " + ", ".join(missing_expected),
                "rec": "Confirm the dataset schema or adjust templates to available columns.",
            }
        )

    return {
        "rows": rows,
        "cols": cols,
        "score": score,
        "grade": grade,
        "missing_rate": missing_rate,
        "dup_rate": dup_rate,
        "parse_issues": parse_issues,
        "outlier_rate": outlier_rate,
        "issues": issues,
    }


def build_template_defaults():
    def pick(preferred, fallback):
        for name in preferred:
            if name in df.columns:
                return name
        return fallback[0] if fallback else None

    primary_num = pick(
        ["Calories_Burned", "Weekly_Sales", "Sales", "Revenue", "Amount", "Total"],
        NUM_COLS,
    )
    secondary_num = None
    for c in NUM_COLS:
        if c != primary_num:
            secondary_num = c
            break

    primary_cat = pick(
        ["Workout_Type", "Gender", "Experience_Level", "Store", "Department", "Category"],
        CAT_COLS,
    )
    secondary_cat = None
    for c in CAT_COLS:
        if c != primary_cat:
            secondary_cat = c
            break

    configs = []
    if primary_num:
        configs.append(
            {"id": str(uuid.uuid4()), "title": "Distribution of " + primary_num, "type": "histogram", "x": primary_num}
        )
    if primary_cat:
        configs.append(
            {"id": str(uuid.uuid4()), "title": "Count by " + primary_cat, "type": "bar", "x": primary_cat}
        )
    if primary_cat and primary_num:
        configs.append(
            {
                "id": str(uuid.uuid4()),
                "title": f"Average {primary_num} by {primary_cat}",
                "type": "bar",
                "x": primary_cat,
                "y": primary_num,
                "agg": "mean",
            }
        )
    if secondary_cat and primary_num:
        configs.append(
            {
                "id": str(uuid.uuid4()),
                "title": f"{primary_num} spread by {secondary_cat}",
                "type": "box",
                "x": secondary_cat,
                "y": primary_num,
            }
        )
    if secondary_num and primary_num:
        configs.append(
            {
                "id": str(uuid.uuid4()),
                "title": f"{primary_num} vs {secondary_num}",
                "type": "scatter",
                "x": secondary_num,
                "y": primary_num,
            }
        )
    if primary_cat:
        configs.append(
            {
                "id": str(uuid.uuid4()),
                "title": "Composition by " + primary_cat,
                "type": "pie",
                "x": primary_cat,
            }
        )
    if primary_cat and secondary_cat:
        configs.append(
            {
                "id": str(uuid.uuid4()),
                "title": f"{primary_cat} -> {secondary_cat}",
                "type": "sunburst",
                "x": primary_cat,
                "color": secondary_cat,
            }
        )
    return configs[:8]


TEMPLATE_DEFAULTS = build_template_defaults()

# ========================================
# 4. Layouts
# ========================================
health_layout = html.Div(
    [
        html.Div(
            [
                html.Div("Health Diagnostic", className="section-title"),
                html.Div("Run a fast data quality assessment with clear next steps.", className="subtle"),
            ]
        ),
        html.Div(
            [
                html.Button("Run Diagnostics", id="health-run", className="button-primary focusable"),
                html.Div(id="health-status", className="subtle", style={"marginLeft": "12px"}),
            ],
            style={"marginTop": "18px", "display": "flex", "alignItems": "center", "gap": "10px"},
        ),
        dcc.Store(id="health-store"),
        html.Div(id="health-results", style={"marginTop": "20px"}),
    ]
)

byod_layout = html.Div(
    [
        html.Div(
            [
                html.Div("Build Your Own Dashboard", className="section-title"),
                html.Div("Compose multiple charts with reliable add/remove behavior.", className="subtle"),
            ]
        ),
        html.Div(
            [
                html.Div("Global Filters", className="subtle"),
                make_filter_controls("byod"),
            ],
            className="app-card",
            style={"padding": "16px", "marginTop": "16px"},
        ),
        html.Div(
            [
                html.Button("Add New Chart", id="byod-add", className="button-primary focusable"),
            ],
            style={"marginTop": "16px"},
        ),
        dcc.Store(id="byod-ids", data=[]),
        html.Div(id="byod-container", style={"marginTop": "20px"}),
    ]
)

template_layout = html.Div(
    [
        html.Div(
            [
                html.Div("Template Dashboard", className="section-title"),
                html.Div("Curated, editable layout with smart fallbacks.", className="subtle"),
            ]
        ),
        html.Div(
            [
                html.Div("Global Filters", className="subtle"),
                make_filter_controls("template"),
            ],
            className="app-card",
            style={"padding": "16px", "marginTop": "16px"},
        ),
        html.Div(
            [
                html.Button("Reset to Template", id="template-reset", className="button-secondary focusable"),
            ],
            style={"marginTop": "16px"},
        ),
        dcc.Store(id="template-configs", data=TEMPLATE_DEFAULTS),
        html.Div(id="template-container", style={"marginTop": "20px"}),
    ]
)

app.layout = html.Div(
    [
        html.Div(
            [
                html.Div("BEAM Analytics", style={"color": WHITE, "fontSize": "28px", "fontWeight": "700"}),
                html.Div("Executive-ready insights from uploaded data", style={"color": "#DCE7F2"}),
            ],
            style={
                "background": NAVY,
                "padding": "22px 28px",
                "borderBottom": f"5px solid {TEAL}",
            },
        ),
        html.Div(
            [
                dcc.Tabs(
                    id="tool-tabs",
                    value="health",
                    children=[
                        dcc.Tab(label="Health Diagnostic", value="health"),
                        dcc.Tab(label="Build Your Own Dashboard", value="byod"),
                        dcc.Tab(label="Template Dashboard", value="template"),
                    ],
                ),
                html.Div(id="tool-content", style={"padding": "24px"}),
            ],
            style={"background": LIGHT, "minHeight": "100vh"},
        ),
    ]
)

# ========================================
# 5. Tool Navigation
# ========================================
@callback(Output("tool-content", "children"), Input("tool-tabs", "value"))
def render_tool(tab):
    if tab == "byod":
        return byod_layout
    if tab == "template":
        return template_layout
    return health_layout

# ========================================
# 6. Health Diagnostics
# ========================================
@callback(
    Output("health-store", "data"),
    Output("health-status", "children"),
    Input("health-run", "n_clicks"),
    prevent_initial_call=True,
)
def run_health(n_clicks):
    if not n_clicks:
        return dash.no_update, ""
    data = health_findings(df)
    if "error" in data:
        return data, data["error"]
    return data, f"Diagnostics complete. Score {data['score']} ({data['grade']})."


@callback(Output("health-results", "children"), Input("health-store", "data"))
def render_health(data):
    if not data:
        return html.Div(
            "Run diagnostics to see health signals, severity, and recommendations.",
            className="subtle",
        )
    if "error" in data:
        return html.Div(data["error"], className="app-card", style={"padding": "16px"})

    cards = html.Div(
        [
            html.Div(
                [
                    html.Div("Overall Score", className="subtle"),
                    html.Div(str(data["score"]), style={"fontSize": "30px", "fontWeight": "700", "color": TEAL}),
                    html.Div(f"Grade {data['grade']}", className="subtle"),
                ],
                className="app-card",
                style={"padding": "14px", "minWidth": "180px"},
            ),
            html.Div(
                [
                    html.Div("Missing Rate", className="subtle"),
                    html.Div(f"{data['missing_rate']:.1%}", style={"fontSize": "22px", "fontWeight": "700"}),
                    html.Div("Completeness", className="subtle"),
                ],
                className="app-card",
                style={"padding": "14px", "minWidth": "180px"},
            ),
            html.Div(
                [
                    html.Div("Duplicate Rate", className="subtle"),
                    html.Div(f"{data['dup_rate']:.1%}", style={"fontSize": "22px", "fontWeight": "700"}),
                    html.Div("Uniqueness", className="subtle"),
                ],
                className="app-card",
                style={"padding": "14px", "minWidth": "180px"},
            ),
            html.Div(
                [
                    html.Div("Rows / Columns", className="subtle"),
                    html.Div(f"{data['rows']} / {data['cols']}", style={"fontSize": "22px", "fontWeight": "700"}),
                    html.Div("Shape", className="subtle"),
                ],
                className="app-card",
                style={"padding": "14px", "minWidth": "180px"},
            ),
        ],
        style={"display": "flex", "gap": "16px", "flexWrap": "wrap"},
    )

    if not data["issues"]:
        issues_block = html.Div(
            "No major issues detected. Data health looks strong.",
            className="app-card",
            style={"padding": "16px", "marginTop": "16px"},
        )
    else:
        groups = {}
        for issue in data["issues"]:
            groups.setdefault(issue["category"], []).append(issue)
        blocks = []
        for category, items in groups.items():
            blocks.append(
                html.Div(
                    [
                        html.Div(f"{category} ({len(items)})", style={"fontWeight": "700", "color": NAVY}),
                        html.Div(
                            [
                                html.Div(
                                    [
                                        html.Div(
                                            issue["title"],
                                            style={"fontWeight": "600", "marginBottom": "4px"},
                                        ),
                                        html.Div(issue["detail"], className="subtle"),
                                        html.Div(issue["rec"], className="subtle"),
                                    ],
                                    style={
                                        "border": "1px solid #E5E7EB",
                                        "borderRadius": "12px",
                                        "padding": "10px",
                                        "marginTop": "8px",
                                    },
                                )
                                for issue in items
                            ]
                        ),
                    ],
                    className="app-card",
                    style={"padding": "16px", "marginTop": "16px"},
                )
            )
        issues_block = html.Div(blocks)

    return html.Div([cards, issues_block])

# ========================================
# 7. BYOD - Add / Remove and Render
# ========================================
@callback(
    Output("byod-ids", "data"),
    Input("byod-add", "n_clicks"),
    Input({"type": "byod-remove", "id": ALL}, "n_clicks"),
    State("byod-ids", "data"),
)
def update_byod_ids(add_clicks, remove_clicks, ids):
    ids = ids or []
    triggered = dash.ctx.triggered_id
    if not triggered:
        return ids
    if triggered == "byod-add":
        ids.append(str(uuid.uuid4()))
        return ids
    if isinstance(triggered, dict) and triggered.get("type") == "byod-remove":
        uid = triggered.get("id")
        return [item for item in ids if item != uid]
    return ids


@callback(Output("byod-container", "children"), Input("byod-ids", "data"))
def render_byod(ids):
    if not ids:
        return html.Div("Add a chart to start building your dashboard.", className="subtle")
    return [make_chart_card(uid, "byod") for uid in ids]


@callback(
    Output({"type": "byod-graph", "id": MATCH}, "figure"),
    Output({"type": "byod-message", "id": MATCH}, "children"),
    Input({"type": "byod-type", "id": MATCH}, "value"),
    Input({"type": "byod-x", "id": MATCH}, "value"),
    Input({"type": "byod-y", "id": MATCH}, "value"),
    Input({"type": "byod-color", "id": MATCH}, "value"),
    Input({"type": "byod-agg", "id": MATCH}, "value"),
    Input({"type": "byod-title", "id": MATCH}, "value"),
    Input({"type": "byod-filter", "col": ALL}, "value"),
    State({"type": "byod-filter", "col": ALL}, "id"),
)
def update_byod_chart(chart_type, x, y, color, agg, title, filter_values, filter_ids):
    filtered = apply_global_filters(df, filter_values, filter_ids)
    fig, msg = build_figure(filtered, chart_type, x, y, color, agg, title)
    return fig, msg


@callback(
    Output({"type": "byod-y", "id": MATCH}, "disabled"),
    Output({"type": "byod-agg", "id": MATCH}, "disabled"),
    Input({"type": "byod-type", "id": MATCH}, "value"),
)
def byod_disable_y(chart_type):
    needs_y = chart_requires_y(chart_type)
    return (not needs_y) and not bool(NUM_COLS), not needs_y

# ========================================
# 8. Template Dashboard
# ========================================
@callback(
    Output("template-configs", "data"),
    Input("template-reset", "n_clicks"),
    prevent_initial_call=True,
)
def reset_template(n_clicks):
    if not n_clicks:
        return dash.no_update
    return build_template_defaults()


@callback(Output("template-container", "children"), Input("template-configs", "data"))
def render_template(configs):
    if not configs:
        return html.Div("Template unavailable for this dataset.", className="subtle")
    return [make_chart_card(cfg["id"], "template", cfg) for cfg in configs]


@callback(
    Output({"type": "template-graph", "id": MATCH}, "figure"),
    Output({"type": "template-message", "id": MATCH}, "children"),
    Input({"type": "template-type", "id": MATCH}, "value"),
    Input({"type": "template-x", "id": MATCH}, "value"),
    Input({"type": "template-y", "id": MATCH}, "value"),
    Input({"type": "template-color", "id": MATCH}, "value"),
    Input({"type": "template-agg", "id": MATCH}, "value"),
    Input({"type": "template-title", "id": MATCH}, "value"),
    Input({"type": "template-filter", "col": ALL}, "value"),
    State({"type": "template-filter", "col": ALL}, "id"),
)
def update_template_chart(chart_type, x, y, color, agg, title, filter_values, filter_ids):
    filtered = apply_global_filters(df, filter_values, filter_ids)
    fig, msg = build_figure(filtered, chart_type, x, y, color, agg, title)
    return fig, msg


@callback(
    Output({"type": "template-y", "id": MATCH}, "disabled"),
    Output({"type": "template-agg", "id": MATCH}, "disabled"),
    Input({"type": "template-type", "id": MATCH}, "value"),
)
def template_disable_y(chart_type):
    needs_y = chart_requires_y(chart_type)
    return (not needs_y) and not bool(NUM_COLS), not needs_y

# ========================================
# 9. Run
# ========================================
if __name__ == "__main__":
    print("BEAM Lifestyle Power Dashboard -> http://127.0.0.1:8050")
    app.run_server(debug=True, port=8050)
