import PDFDocument from "pdfkit";
import { writeFileSync } from "node:fs";
const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, bufferPages: true });
doc.on("data", (c) => {
});
const chunks: Buffer[] = [];
doc.on("data", (c) => chunks.push(c));
doc.on("end", () => {
  const out = Buffer.concat(chunks);
  writeFileSync("/tmp/opencode/pdf-test/out.pdf", out);
  console.log("PDF OK", out.length, "bytes");
});
doc.addPage(); doc.font("Helvetica-Bold").fontSize(16).text("Hello PaletteD&co");
doc.font("Helvetica").fontSize(8.5).text("Test du bundle avec polices standard");
doc.font("Helvetica-Oblique").fontSize(10).text("Times-Roman?").font("Times-Roman").text("Times check");
doc.end();
