import PDFDocument from "pdfkit";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const cwd = process.env.TEST_DIR!;
const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: false, bufferPages: true });
const chunks: Buffer[] = [];
doc.on("data", (c: any) => chunks.push(c));
doc.on("end", () => {
  const out = Buffer.concat(chunks);
  writeFileSync(resolve(cwd, "out.pdf"), out);
  console.log("PDF OK", out.length, "bytes");
});
doc.addPage();
const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Symbol", "ZapfDingbats"];
for (const f of fonts) doc.font(f).fontSize(11).text(`Police ${f}: ABC abc 0123 © € — test`);
doc.end();
