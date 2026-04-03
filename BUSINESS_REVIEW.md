# Business User Review — BEAM Analytics Data Health Tool

**Reviewer role:** Non-technical business owner of a 25-person regional insurance agency  
**Scenario:** I uploaded a CSV of our client policy records (about 2,000 rows, 18 columns) and am trying to understand whether our data is in good shape.  
**Date:** 2026-04-03

---

## 1. First Impressions

### What I see after logging in

The first screen after login says **"Tenant Dashboard"** with my Tenant ID displayed as a long string of letters and numbers. I have no idea what a "tenant" is. I'm a business owner. Is this a legal term? A software term? Why am I looking at it?

Below that it says: *"Select a file from the sidebar to view insights."*

That's the entire dashboard. Nothing tells me what this tool does, what I should upload, or what I'll get out of it.

**Verdict: I would not know what this tool is for from the first screen alone.** A non-technical user needs to see a brief description ("Upload your spreadsheet and we'll tell you how healthy your data is") and a clear first action ("Start here → Upload a file").

---

### The registration page

When I tried to create an account, it asked for a **"Tenant name"** — a piece of jargon I've never heard. I guessed it meant my company name and moved on. This should just say "Company name."

---

### Uploading a file

The file upload area in the sidebar is tiny and easy to miss. There is no drag-and-drop. After I upload, the file appears in a list below with its status shown as "uploaded" — but I don't know if I need to do anything else, or if it's automatically analyzing my data.

Clicking on the file name takes me to the insights page.

---

## 2. The Insights Page

### Key metrics

At the top I see cards labeled:
- **Total Rows** — I understand this. Good.
- **Average [column name]** — One card per numeric column. Some of these are things like "Average PassengerId" which means nothing to me. Why is the tool averaging my ID numbers?

The metric cards are generated automatically from every numeric column, regardless of whether the average is meaningful. For my policy data, I got "Average Policy Number" which is nonsensical.

---

### Charts

I see three charts:
1. A histogram labeled **"Distribution of [first column name]"** — this shows a bar chart of one of my columns. I don't know why this particular column was chosen. For my file it showed the distribution of a numeric ID field. Useless.
2. A bar chart labeled **"[column name] Counts"** — shows how many records have each value in one column. Might be useful if I knew which column to pick, but it defaulted to a column I don't care about.
3. A **"Correlation Matrix"** — I have no idea what this is. It looks like a colorful grid of numbers. There is no explanation.

**None of these charts answered a question I actually have.** My real questions are:
- Which of my columns have missing data, and how bad is it?
- Do I have duplicate client records?
- Are there any obviously wrong values?

---

## 3. Data Health Output

### Finding the health score

After clicking through a few things I eventually found that the file detail page shows **File Insights** — the KPIs and charts described above. But I could not find the **Data Health** section with a score. The sidebar navigation appeared to have a "Data Health" item, but clicking it showed me a page with hardcoded numbers (score of 86, checks that said "OK") that clearly weren't about my actual file. It was a demo screen, not my real data.

**This is a significant problem.** The one thing this tool is supposed to do — tell me how healthy my data is — is not clearly connected to my uploaded file.

---

### The health score (when I found it)

I eventually located health score information in the API response (by looking at the network tab in my browser — definitely not something a business owner would do). The tool returns a score and grade:

- Score: 74, Grade: C
- Issues: "Overall missingness is 8.3%" and "Duplicate row rate is 2.1%"

**What is "missingness"?** This is jargon. I don't know if 8.3% is bad or fine. What does it mean for my business?

**What should I do about it?** The recommendation says *"Consider imputing, filtering, or fixing upstream ingestion for the worst columns."* I don't know what "imputing" means. I don't have an "upstream ingestion" — I just have a spreadsheet.

---

## 4. Plain-Language Evaluation

### Things that are clear to me
- The score (a number out of 100 with a grade letter) — I understand grades
- "Duplicate rows" — I know what a duplicate is
- File name and upload date in the sidebar — clear

### Things that are confusing or meaningless
- "Tenant" / "Tenant ID" — jargon
- "Missingness" — should say "missing information" or "empty fields"
- "Imputing" — should say "filling in the blanks"
- "Upstream ingestion" — should say "the system or process that creates this file"
- "Outlier-like behavior detected" — should say something like "We found some values that look unusually high or low"
- "Winsorize" — should not appear at all
- "3σ rule" — should not appear at all
- Column names used as chart titles without formatting — "Sales_Amount_USD" as a chart title is not useful
- The correlation matrix — needs to either be explained or removed for non-technical users

---

## 5. Trust and Polish

### What would make me close the tab immediately
1. Landing on a dashboard with no explanation of what the tool does
2. Seeing a "Data Health" section with numbers that are clearly not my data (the hardcoded fake scores)
3. Getting jargon-heavy recommendations I can't act on
4. Uploading a file and having no visible indication that anything is happening with it

### What would make me trust it
1. A clear explanation of what I'm looking at within 10 seconds of logging in
2. A health score displayed immediately after uploading a file — no extra clicks
3. Plain English: "You have 8% empty fields — that means roughly 160 of your 2,000 records are incomplete. This can cause problems with reports and mailings."
4. Specific column names: "The 'Email Address' field is 23% empty — this is your most urgent data problem."
5. A recommended action I can actually do: "Review your data entry process for Email Address, or ask your software vendor why that field isn't being saved."

---

## 6. Visualization Wishlist (From a Business Perspective)

As a business owner, the charts I would actually find useful are:

| Chart I want | What it tells me |
|---|---|
| "Which fields have missing data?" | A bar chart ranking every column by its % of missing values |
| "Do I have duplicate records?" | A simple number: "X duplicate records found out of Y total" |
| "What does my key data look like?" | A histogram of a column I care about (revenue, dates, customer count) |
| "Are there any obviously wrong values?" | A table of values that look suspicious |

These don't exist yet. The charts that do exist answer questions I'm not asking.

---

## 7. Overall Verdict

| Dimension | Score | Notes |
|---|---|---|
| First impression | 2/5 | Empty dashboard, jargon-heavy language |
| Clarity of purpose | 2/5 | No onboarding or description |
| Diagnostic output clarity | 2/5 | Numbers exist but explanations are missing or jargon-filled |
| Visualization value | 1/5 | Charts don't answer any business question I have |
| Health score visibility | 1/5 | The core feature is buried and not wired to the UI |
| Recommendation quality | 2/5 | Technically correct but not actionable for a non-technical user |
| Trust and polish | 2/5 | Fake data visible on the health screen; no onboarding |

**Summary:** The infrastructure is solid — the upload flow, the login, the sidebar all work. But the output of the tool (the diagnostic results) is not surfaced clearly, not written in plain language, and the visualizations don't answer the questions a business owner actually has. An SMB user would get confused and leave before seeing the most important output.

---

## Assumptions

- Tested against a generic CSV dataset (as a proxy for a real business dataset)
- Evaluated as a user who has no data engineering background
- "Data Health View" in the sidebar components was identified as a stub/placeholder during review
