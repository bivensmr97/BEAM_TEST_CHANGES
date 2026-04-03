# Business User Review v2 — BEAM Analytics

**Reviewer role:** Non-technical business owner, first-time user  
**Scenario:** I manage a 25-person insurance agency. I uploaded a client policy CSV and want to understand if my data is clean.  
**Date:** 2026-04-03 (v2 pass — after previous round of improvements)

---

## Progress Since Last Review

The previous round made meaningful improvements: the dashboard now has a welcome screen with clear steps, the health score is wired to real data, registration no longer says "Create your tenant," and the issues are written in plain English with recommended actions. These changes make the tool feel much more serious.

This review focuses on the remaining friction points that prevent it from feeling like a finished, trustworthy product.

---

## 1. The Page Header Shows a UUID

After clicking on my file, the page says **"File Analysis"** with a long string of letters and numbers below it labeled "ID:". I have no idea whose file this is or which file I'm looking at. If I have two files uploaded, I can't tell which one I'm analyzing without going back to the sidebar.

**What I want:** Show the file name at the top. Something like:
> **client_policy_data_2024.csv** · Uploaded March 15

That's all I need. The UUID is meaningless to me.

---

## 2. "Multi-tenant ingest & insights" in the Header

The top navigation bar says "BEAM Analytics" with a subtitle "Multi-tenant ingest & insights." The word "ingest" is a technical term I've never used in my life, and "multi-tenant" sounds like apartment buildings.

**What it should say:** "Data Quality Platform" or just remove the subtitle entirely.

---

## 3. Tab Navigation Works, But There's No Hint About What Each Tab Does

When I land on the file page, I see two tabs: "File Overview" and "Data Health." I don't naturally know which to click first. The File Overview tab loads automatically, but if I hadn't read the welcome screen, I wouldn't know that "Data Health" is the main point of the tool.

**What would help:** A small tagline under the active tab, or a subtle badge on the Data Health tab like "Recommended ✓" to guide me there.

---

## 4. The Data Health Tab Re-Runs the Analysis Every Time I Switch Back to It

I clicked Data Health, saw my score, then clicked File Overview to look at charts. When I switched back to Data Health, it showed the loading spinner again and re-ran the entire analysis. For a 15 MB file this took about 4 seconds.

This makes the tool feel slow and unpolished. Once I've seen my health score, it shouldn't change unless I upload a new file. The results should stay on screen.

---

## 5. The "What We Found" Section Doesn't Match the Urgency

I had a Critical issue (large amounts of missing data) and the section heading just says "What We Found." That doesn't feel urgent. When there's a critical problem, the section should feel like it requires action — something like "Issues Requiring Your Attention" or "Action Needed."

When there are no issues, the success state is great — "✓ No significant issues found" is a satisfying outcome.

---

## 6. The Column Breakdown Is Hidden and I Almost Missed It

The "Field-by-Field Breakdown" section at the bottom is collapsed by default. I almost didn't notice it. For a file with 10–15 fields, this is the most useful part — it tells me exactly which fields have problems. It should be open by default (or at least not hidden behind a button with no visual hint that useful information is there).

---

## 7. Filter Preset Buttons Do Nothing

On the File Overview tab, the left sidebar has preset filter buttons: "High-Value Records," "Missing Data Check," and "Outliers." I clicked all three. Nothing happened. The charts didn't change. 

If a button doesn't do anything, remove it. Having dead buttons destroys trust — I start wondering what else doesn't work.

---

## 8. I Can't Tell How Many KPI Cards Are Meaningful

The Key Metrics section shows multiple "Average [field name]" cards. For my 18-column dataset I got 9 KPI cards showing averages of fields I don't recognize. I scrolled past them. Less is more here — show me 3–5 numbers that matter, not every average the system can compute.

---

## 9. The "AI" Floating Button Has No Description

There's a cyan circle in the bottom right corner with "AI" written on it. I know AI is popular but this button gives me no context. What will happen when I click it? What am I getting?

**Fix:** Add a tooltip or label like "Get an AI summary of this file" or change the button text to "AI Summary."

---

## 10. Spelling Inconsistency: "Analysed" vs "Analyzed"

The health panel says "Analysed 2,000 records across 18 fields." The rest of the UI uses American English ("Analyze," "Recognize"). The British spelling stands out and looks like a mistake.

---

## 11. Error Messages Show Technical Status Codes

If something goes wrong with the health check, the error message shows: "Health check failed (422): The uploaded file contains no data rows."

The number 422 means nothing to me. The message after the colon is actually helpful — just show that part.

---

## 12. The Settings Menu Shows Only "Theme"

I clicked the gear icon expecting to see my account information or subscription status. I only saw a "Theme" toggle. That's fine, but the gear icon implies more. Either expand settings or use a more appropriate icon (like a moon/sun for theme toggle only).

---

## Overall Impression (v2)

The tool has levelled up significantly. The health score is real, the plain English explanations are genuinely helpful, and the welcome screen sets context. The main remaining friction is polish:

| Item | Status |
|---|---|
| Data is real (not fake/hardcoded) | ✓ Fixed |
| Plain English explanations | ✓ Good |
| Welcome screen / onboarding | ✓ Good |
| Health score visible | ✓ Fixed |
| File name shown on analysis page | ✗ Missing |
| Header subtitle jargon | ✗ Still there |
| Health tab caching | ✗ Re-runs every visit |
| Dead filter preset buttons | ✗ Still there |
| Column breakdown visible by default | ✗ Hidden |
| KPI card count | ✗ Too many |
| AI button description | ✗ Cryptic |
| Error messages clean | ✗ HTTP codes visible |
| Spelling consistency | ✗ Minor |

**Would I pay for this?** Not yet — but I'm much closer than before. Fix the header (file name), cache the health results, and remove the dead preset buttons, and this feels like a finished product.
