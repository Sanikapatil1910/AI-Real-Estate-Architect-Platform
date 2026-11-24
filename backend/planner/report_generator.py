from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet


def create_project_report(project, plot, usable_plot, cost=None, energy=None, investment=None):
    buffer=BytesIO()
    doc=SimpleDocTemplate(buffer,pagesize=A4,rightMargin=36,leftMargin=36,topMargin=36,bottomMargin=36)
    styles=getSampleStyleSheet(); story=[]
    story.append(Paragraph("AI RealEstate Architect — Project Report", styles["Title"]))
    story.append(Spacer(1,10))
    story.append(Paragraph(f"Plot: {plot['width']} × {plot['length']} {plot.get('unit','ft')} | Road: {plot.get('road_side','North')}", styles["BodyText"]))
    story.append(Paragraph(f"Usable plot: {usable_plot['width']} × {usable_plot['length']} ft", styles["BodyText"]))
    story.append(Spacer(1,12))
    rows=[["Plan","Topology","Occupied","Distribution"]]
    for p in project.get("plans",[]): rows.append([p.get("name",""),p.get("topology",""),f"{p.get('occupied_ratio',0)*100:.1f}%",f"{p.get('distribution_score',0):.1f}"])
    table=Table(rows,colWidths=[150,130,80,90]); table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#1f2937")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("GRID",(0,0),(-1,-1),.5,colors.grey),("PADDING",(0,0),(-1,-1),6)])); story.append(table)
    if cost: story += [Spacer(1,12),Paragraph(f"Cost estimate: ₹{cost['range_low']:,.0f} – ₹{cost['range_high']:,.0f} ({cost['finish']})",styles["Heading2"])]
    if energy: story += [Paragraph(f"Energy score: {energy['score']}/100 | {energy['solar_recommendation']}",styles["BodyText"])]
    if investment: story += [Paragraph(f"Planning/investment snapshot: {investment['score']}/100 | Recommended: {investment['recommended_plan']}",styles["BodyText"])]
    story += [Spacer(1,16),Paragraph("Conceptual AI-generated planning output. Final architectural, structural, electrical and approval decisions must be verified by qualified professionals.",styles["BodyText"])]
    doc.build(story)
    buffer.seek(0); return buffer.getvalue()
