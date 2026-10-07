import app from "../src/index.js";

const handle = (request: Request) => app.fetch(request);

export function GET(request: Request) {
  return handle(request);
}
export function POST(request: Request) {
  return handle(request);
}
export function PUT(request: Request) {
  return handle(request);
}
export function PATCH(request: Request) {
  return handle(request);
}
export function DELETE(request: Request) {
  return handle(request);
}
export function OPTIONS(request: Request) {
  return handle(request);
}
export function HEAD(request: Request) {
  return handle(request);
}
