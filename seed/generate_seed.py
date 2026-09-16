"""
Generates seed/seed.sql from:
  - the 24-stage Part B master framework (Sep-11 v1 docx, table 3) — hardcoded
    below, since it's static reference data already extracted this session.
  - the 42-activity template + 16 real projects (Sep-16 QC workbook) — read
    live from the source workbook.

Run once during development: `python3 seed/generate_seed.py`. Not needed at
deploy time — seed.sql is the checked-in artifact.
"""
import openpyxl
import re
import json

SRC = "/tmp/claude-0/-home-claude/bff7e33a-7912-5725-a499-63f2850aed45/scratchpad/strucrite/source.xlsx"
OUT = "seed/seed.sql"

# ---------------------------------------------------------------------------
# Departments (org-wide). Order matters only for readability of the seed file.
# ---------------------------------------------------------------------------
DEPARTMENTS = [
    "Marketing", "Planning", "Purchase", "Quality", "Production",
    "Commercial", "Logistics", "Projects", "Accounts", "HR",
]

# Multi-department owner strings from the workbook -> primary department for
# task_template.owner_department_id (first-named department is treated as
# primary/accountable; the rest are collaborators, noted in the task name).
DEPT_ALIASES = {
    "PROJECTS": "Projects",
    "PROJECTS ": "Projects",
    "MARKETING": "Marketing",
    "MARKETING  ": "Marketing",
    "PLANNING": "Planning",
    "PURCHASE": "Purchase",
    "QUALITY": "Quality",
    "PRODUCTION": "Production",
    "PRODUCTION ": "Production",
    "PRODUCTION   ": "Production",
    "COMMERCIAL": "Commercial",
    "LOGISTICS": "Logistics",
    "LOGISTICS   ": "Logistics",
}


def primary_department(owner_raw):
    if not owner_raw:
        return "Projects"
    first = re.split(r"\+|\n", owner_raw)[0].strip().upper()
    first = re.sub(r"\s+", " ", first)
    return DEPT_ALIASES.get(first, DEPT_ALIASES.get(first + " ", "Projects"))


# ---------------------------------------------------------------------------
# Part B — 24-stage master framework (Sep-11 v1 docx, table index 3)
# (phase, code, name, owner_department_primary, key_activities, deliverable)
# ---------------------------------------------------------------------------
STAGE_TEMPLATE = [
    ("Document Control", "1", "PO Received & Contract Review", "Marketing",
     "Scope, quantity, delivery date, commercial terms confirmed", "PO copy + contract review sheet"),
    ("Document Control", "2", "Technical Document Review / RDSO Spec Check", "Planning",
     "Drawings, specs, standards, RDSO requirements checked", "Reviewed drawing register"),
    ("Document Control", "3", "Kick-off Meeting & Production Planning", "Planning",
     "Team alignment, resources, timeline, milestones set", "Minutes of meeting + production plan"),
    ("Document Control", "4", "Approved Drawings / BOM / Cutting Plan", "Planning",
     "Final release from client / design", "Approved GA drawing, BOM, cutting plan"),
    ("Production", "5", "Raw Material Procurement (Approved Sources)", "Purchase",
     "TMT / IS sections, plates, angles, channels, etc.", "Purchase order + supplier MTC"),
    ("Production", "6", "Incoming Material Inspection", "Quality",
     "MTC, grade, dimensions, traceability verified", "Incoming inspection report"),
    ("Quality Gate", "QC GATE 1", "Incoming Inspection Gate", "Quality",
     "Pass / Rework-Reject (replace or rectify material)", "QC Gate 1 clearance note"),
    ("Production", "7", "Material Identification & Marking", "Production",
     "Heat no., batch no., traceability marking", "Marking / traceability record"),
    ("Production", "8", "Cutting / CNC / Shearing", "Production",
     "Plates, angles, sections cut to size", "Cutting log"),
    ("Production", "9", "Drilling / Punching / Edge Preparation", "Production",
     "Hole drilling, beveling, edge prep", "Edge-prep checklist"),
    ("Production", "10", "Fit-up & Sub-Assembly", "Production",
     "Jigs & fixtures as required", "Fit-up inspection record"),
    ("Production", "11", "Welding (Approved WPS / PQR)", "Production",
     "Qualified welders & approved procedures", "Welder qualification + weld log"),
    ("Quality Gate", "QC GATE 2", "In-process Inspection Gate", "Quality",
     "Pass / Rework (repair or re-fabricate)", "QC Gate 2 clearance note"),
    ("Production", "12", "NDT as Applicable (UT / MT / PT / RT)", "Quality",
     "As per approved procedure", "NDT report"),
    ("Quality Gate", "QC GATE 3", "NDT Inspection Gate", "Quality",
     "Pass / Rework (repair or re-fabricate)", "QC Gate 3 clearance note"),
    ("Production", "13", "Straightening / Correction", "Production",
     "As required", "Straightening record"),
    ("Production", "14", "Full Assembly & Trial Fit-up", "Production",
     "Complete structure trial-assembled", "Trial fit-up sign-off"),
    ("Production", "15", "Surface Preparation / Shot Blasting", "Production",
     "Cleanliness as per spec", "Surface-prep record"),
    ("Production", "16", "Painting / Galvanizing", "Production",
     "As per specification", "Paint / galvanizing inspection report"),
    ("Production", "17", "Final Dimensional & Visual Inspection", "Quality",
     "Dimensions, welds, coating, finish, marking", "Final inspection report"),
    ("Quality Gate", "QC GATE 4", "Final Inspection Gate", "Quality",
     "Pass / Rework (repair / touch-up)", "QC Gate 4 clearance note"),
    ("External / Client", "18", "QA Dossier / Inspection Release", "Quality",
     "MTC, test reports, inspection certificates, RDSO / Client approval", "QA dossier + RDSO/Client approval"),
    ("Dispatch", "19", "Packing, Identification & Dispatch", "Logistics",
     "Secure packing, ID tags, load plan", "Packing list + dispatch advice"),
    ("Dispatch", "20", "Delivery & Documentation", "Marketing",
     "Challan, invoice, test certificates, transport docs", "Delivery challan + invoice + test certificates"),
]

# Keyword -> stage code, used to tag each of the 42 QC-workbook activities to
# the closest Part-B stage above (best-effort; refine once the team reviews).
STAGE_KEYWORDS = [
    (["PO RECEIVED"], "1"),
    (["PROJECT DOCUMENTS REVIEW"], "2"),
    (["QAP", "WPSS"], "2"),
    (["SHOP DRAWING", "DETAILING"], "3"),
    (["BOM & BOQ"], "4"),
    (["STRUCTURAL DRAWINGS", "FABRICATION DRAWINGS"], "4"),
    (["PROCURMENT OF RAW MATERIAL", "PROCURMENT OF CONSUMABLES"], "5"),
    (["RECEIVING OF RAW MATERIAL", "RECEIVING OF CONSUMABLES"], "5"),
    (["COORDINATION WITH RAILWAY FOR RAW MATERIAL"], "6"),
    (["INSPECTION FORMALITIES"], "QC GATE 1"),
    (["SAMPLES OF RAW MATERIAL", "DISPATCH TO LAB"], "6"),
    (["LAB REPORTS"], "6"),
    (["WPQR", "LAYOUT APPROVAL"], "QC GATE 1"),
    (["RELEASING OF DRAWINGS"], "4"),
    (["PRODUCTION PLAN"], "3"),
    (["CUTTING PLAN"], "4"),
    (["MATERIAL IDENTIFICATION"], "7"),
    (["CUTTING"], "8"),
    (["CUTTING INSPECTION"], "QC GATE 1"),
    (["DRILLING"], "9"),
    (["FIT - UP", "FIT-UP"], "10"),
    (["WELDING"], "11"),
    (["NDT"], "12"),
    (["STRAIGHTENING"], "13"),
    (["TRIAL ASSEMBLY"], "14"),
    (["INTERNAL INSPECTION"], "QC GATE 3"),
    (["COORDINATION WITH RAILWAY & INSPECTION"], "QC GATE 4"),
    (["INSPECTION FROM RAILWAY"], "QC GATE 4"),
    (["BLASTING", "METALIZING", "PAINTING"], "16"),
    (["STAGE INSPECTION OF PAINTING"], "17"),
    (["QUALITY RELEATED DOCUMENTS", "QUALITY RELATED DOCUMENTS"], "18"),
    (["PAYMENT REQUEST"], "20"),
    (["CLEARANCE FROM COMMERCIAL"], "20"),
    (["PACKING"], "19"),
    (["DELIVERY & DOCUMENTATION"], "20"),
]


def tag_stage_code(name):
    upper = name.upper()
    for keys, code in STAGE_KEYWORDS:
        if any(k in upper for k in keys):
            return code
    return None  # left untagged -> NULL stage_template_id, fine for MVP


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''").strip() + "'"


def sql_num(v):
    return "NULL" if v is None else str(v)


# ---------------------------------------------------------------------------
# 16 real projects, from the 16-Sep-2026 portfolio analysis
# (name, client_short, contract_value_cr, balance_cr, po_date ISO)
# ---------------------------------------------------------------------------
PROJECTS = [
    ("KNR", "KNR Infraprojects", 9.53, 8.32, "2025-10-23"),
    ("PILCON - KHURDA", "Pilcon Engineering (Khurda Road)", 8.02, 7.12, "2024-10-15"),
    ("V NARSIMHA", "V Narsimha", 14.73, 4.48, "2024-09-30"),
    ("JSPL", "JSPL", 2.34, 2.34, "2026-06-17"),
    ("DILRAJ", "Dilraj Construction", 3.84, 2.07, "2026-06-04"),
    ("THERMOSYSTEMS", "Thermosystems", 2.12, 2.02, "2026-07-02"),
    ("NR WIRE", "NR Wire", 2.33, 1.33, "2025-12-20"),
    ("J KUMAR", "J Kumar", 4.72, 0.90, "2025-09-29"),
    ("PATIL", "Patil Engineering", 0.87, 0.77, "2026-06-30"),
    ("AB LODHA", "AB Lodha", 2.27, 0.52, "2025-09-30"),
    ("DARSH", "Darsh Earthcon", 25.53, 21.21, "2026-02-26"),
    ("KSR", "KSR Infracon", 10.41, 4.86, "2023-12-18"),
    ("RKSCPL JALPAIGURI", "RKSCPL - Jalpaiguri Flyover", 2.49, 0.61, "2025-05-19"),
    ("ALOK", "Alok Buildtech", 11.01, 9.91, "2026-06-26"),
    ("PILCON 30.5", "Pilcon - 30.5", 4.07, 0.97, "2024-09-27"),
    ("SHANTI", "Shanti Engicon", 1.41, 0.17, "2024-09-20"),
]


def load_activities():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["KNR"]  # any sheet works; all 16 share the identical 42-row template
    merged_starts = set()
    wbf = openpyxl.load_workbook(SRC, data_only=False)
    for mr in wbf["KNR"].merged_cells.ranges:
        merged_starts.add((mr.min_row, mr.min_col))

    activities = []
    seq = 1
    for r in range(4, ws.max_row + 1):
        b = ws.cell(row=r, column=2).value
        if b is None:
            continue
        a = ws.cell(row=r, column=1).value
        c = ws.cell(row=r, column=3).value
        code = str(a).strip() if a is not None else str(seq)
        is_conditional = "(IF REQ" in b.upper() or (r, 4) in merged_starts
        activities.append({
            "seq": seq,
            "code": code,
            "name": " ".join(b.split()),
            "owner_raw": c,
            "is_conditional": is_conditional,
        })
        seq += 1
    return activities


def load_project_dates():
    """Returns {project_sheet_name: {task_seq: {plan, actual}}}"""
    wb = openpyxl.load_workbook(SRC, data_only=True)
    result = {}
    for sn in wb.sheetnames:
        ws = wb[sn]
        seq = 1
        rows = {}
        for r in range(4, ws.max_row + 1):
            b = ws.cell(row=r, column=2).value
            if b is None:
                continue
            d = ws.cell(row=r, column=4).value
            e = ws.cell(row=r, column=5).value
            plan = d.date().isoformat() if hasattr(d, "date") else None
            actual = e.date().isoformat() if hasattr(e, "date") else None
            rows[seq] = {"plan": plan, "actual": actual}
            seq += 1
        result[sn] = rows
    return result


def main():
    activities = load_activities()
    project_dates = load_project_dates()

    lines = []
    lines.append("-- Auto-generated by seed/generate_seed.py — DO NOT hand-edit; regenerate instead.")
    lines.append("")
    lines.append("INSERT INTO organization (id, name) VALUES (1, 'StrucRite Metal Building Systems');")
    lines.append("")

    lines.append("-- Departments")
    for i, d in enumerate(DEPARTMENTS, start=1):
        lines.append(f"INSERT INTO department (id, org_id, name) VALUES ({i}, 1, {sql_str(d)});")
    dept_id = {d: i for i, d in enumerate(DEPARTMENTS, start=1)}
    lines.append("")

    lines.append("-- Sample Superadmin user (update email to the real one after first login)")
    lines.append(
        "INSERT INTO user (id, org_id, email, name, department_id, role) VALUES "
        f"(1, 1, 'murali@valueenablers.com', 'Dr. Lean Murali', NULL, 'superadmin');"
    )
    lines.append("")

    lines.append("-- Part B: 24-stage master framework")
    stage_id = {}
    for i, (phase, code, name, owner, activities_desc, deliverable) in enumerate(STAGE_TEMPLATE, start=1):
        stage_id[code] = i
        lines.append(
            "INSERT INTO stage_template (id, org_id, phase, seq, code, name, key_activities, "
            "owner_department_id, deliverable_evidence) VALUES "
            f"({i}, 1, {sql_str(phase)}, {i}, {sql_str(code)}, {sql_str(name)}, "
            f"{sql_str(activities_desc)}, {dept_id[owner]}, {sql_str(deliverable)});"
        )
    lines.append("")

    lines.append("-- Task template: the 42 QC-workbook activities, tagged to a Part-B stage where possible")
    for act in activities:
        primary_dept = primary_department(act["owner_raw"])
        code_tag = tag_stage_code(act["name"])
        st_id = stage_id.get(code_tag, "NULL")
        lines.append(
            "INSERT INTO task_template (id, org_id, stage_template_id, seq, code, name, "
            "owner_department_id, is_conditional) VALUES "
            f"({act['seq']}, 1, {st_id}, {act['seq']}, {sql_str(act['code'])}, {sql_str(act['name'])}, "
            f"{dept_id[primary_dept]}, {1 if act['is_conditional'] else 0});"
        )
    lines.append("")

    lines.append("-- Part A: 16 projects with real Sep-16-2026 portfolio data")
    for i, (sheet_name, client, value_cr, balance_cr, po_date) in enumerate(PROJECTS, start=1):
        lines.append(
            "INSERT INTO project (id, org_id, name, client, contract_value, balance_value, po_date, status) VALUES "
            f"({i}, 1, {sql_str(sheet_name)}, {sql_str(client)}, {value_cr * 1e7}, {balance_cr * 1e7}, "
            f"{sql_str(po_date)}, 'active');"
        )
    lines.append("")

    lines.append("-- Part D: 5 standard payment milestones per project (blank until real splits are confirmed)")
    payment_points = [
        ("Advance / Mobilisation", "1"),
        ("Progress Payment", "QC GATE 2"),
        ("Pre-Dispatch / Major Progress Payment", "QC GATE 4"),
        ("Final Payment", "20"),
        ("Retention Release", None),
    ]
    pm_id = 1
    for pi in range(1, len(PROJECTS) + 1):
        for seq, (point, stage_code) in enumerate(payment_points, start=1):
            st_ref = stage_id.get(stage_code, "NULL") if stage_code else "NULL"
            lines.append(
                "INSERT INTO payment_milestone (id, project_id, payment_point, seq, "
                "triggered_by_stage_id, status) VALUES "
                f"({pm_id}, {pi}, {sql_str(point)}, {seq}, {st_ref}, 'pending');"
            )
            pm_id += 1
    lines.append("")

    lines.append("-- Part C: project_task rows for the 16 already-tracked projects, seeded from the Sep-16 QC workbook")
    pt_id = 1
    log_id = 1
    pt_rows = []
    log_rows = []
    for pi, (sheet_name, client, value_cr, balance_cr, po_date) in enumerate(PROJECTS, start=1):
        dates = project_dates.get(sheet_name, {})
        for act in activities:
            dd = dates.get(act["seq"], {})
            plan = dd.get("plan")
            actual = dd.get("actual")
            not_applicable = 1 if (plan is None and actual is None and act["is_conditional"]) else 0
            pt_rows.append(
                "INSERT INTO project_task (id, project_id, task_template_id, owner_user_id, "
                "plan_date, actual_date, not_applicable) VALUES "
                f"({pt_id}, {pi}, {act['seq']}, NULL, {sql_str(plan)}, {sql_str(actual)}, {not_applicable});"
            )
            if plan or actual:
                log_rows.append(
                    "INSERT INTO task_update_log (project_task_id, user_id, channel, field, old_value, new_value) VALUES "
                    f"({pt_id}, 1, 'import', 'plan_date/actual_date', NULL, "
                    f"{sql_str((plan or '') + '/' + (actual or ''))});"
                )
            pt_id += 1
    lines.extend(pt_rows)
    lines.append("")
    lines.append("-- Import audit trail (one row per seeded task that had a date)")
    lines.extend(log_rows)
    lines.append("")

    with open(OUT, "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Wrote {OUT}")
    print(f"  {len(DEPARTMENTS)} departments, {len(STAGE_TEMPLATE)} stages, {len(activities)} task templates")
    print(f"  {len(PROJECTS)} projects, {len(pt_rows)} project_task rows, {len(log_rows)} import log rows")


if __name__ == "__main__":
    main()
