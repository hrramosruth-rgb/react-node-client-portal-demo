import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "portal-api-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "db.json");
  return { app: createApp({ path }), path };
}
async function login(app, email = "north@demo.test") {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/login")
    .send({ email, password: "demo-portal" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, email);
  assert.doesNotMatch(JSON.stringify(res.body), /password|demo-portal/);
  return agent;
}
test("requires real login; arbitrary identity headers do not authenticate", async (t) => {
  const { app } = fixture(t);
  const res = await request(app)
    .get("/api/projects")
    .set("x-client-id", "north")
    .set("x-role", "agency");
  assert.equal(res.status, 401);
  assert.equal(
    (
      await request(app)
        .post("/api/login")
        .send({ email: "north@demo.test", password: "wrong" })
    ).status,
    401,
  );
});
test("session restricts client reads and writes; logout revokes session", async (t) => {
  const { app } = fixture(t);
  const north = await login(app);
  const south = await login(app, "south@demo.test");
  assert.equal((await north.get("/api/projects")).body.projects.length, 1);
  assert.equal(
    (
      await south
        .post("/api/projects/website/tasks")
        .send({ title: "Cross client" })
    ).status,
    404,
  );
  assert.equal(
    (await south.patch("/api/tasks/brief").send({ status: "in_progress" }))
      .status,
    404,
  );
  assert.equal((await north.get("/api/clients")).body.clients.length, 1);
  await north.post("/api/logout").expect(204);
  await north.get("/api/projects").expect(401);
});
test("API persists tasks and rejects bad input, transitions and missing records", async (t) => {
  const { app, path } = fixture(t);
  const north = await login(app);
  await north
    .post("/api/projects/website/tasks")
    .send({ title: "" })
    .expect(400);
  await north
    .post("/api/projects/absent/tasks")
    .send({ title: "Test" })
    .expect(404);
  const created = await north
    .post("/api/projects/website/tasks")
    .send({ title: "Review copy" })
    .expect(201);
  await north
    .patch(`/api/tasks/${created.body.task.id}`)
    .send({ status: "done" })
    .expect(409);
  await north
    .patch(`/api/tasks/${created.body.task.id}`)
    .send({ status: "in_progress" })
    .expect(200);
  const restarted = await login(createApp({ path }));
  const projects = await restarted.get("/api/projects").expect(200);
  assert.equal(projects.body.projects[0].tasks.at(-1).status, "in_progress");
});
test("agency account creates a project for a client but client cannot", async (t) => {
  const { app } = fixture(t);
  const agency = await login(app, "agency@demo.test");
  await agency
    .post("/api/projects")
    .send({ name: "New deliverable", clientId: "north" })
    .expect(201);
  assert.equal((await agency.get("/api/projects")).body.projects.length, 3);
  const north = await login(app);
  await north
    .post("/api/projects")
    .send({ name: "New", clientId: "south" })
    .expect(403);
});
test("rejects malformed and oversized JSON with safe errors", async (t) => {
  const { app } = fixture(t);
  await request(app)
    .post("/api/login")
    .set("Content-Type", "application/json")
    .send("{")
    .expect(400);
  const res = await request(app)
    .post("/api/login")
    .send({ email: "x".repeat(20000) })
    .expect(413);
  assert.equal(typeof res.body.error, "string");
  assert.doesNotMatch(JSON.stringify(res.body), /stack|node_modules/);
});
test("concurrent retry keys create one durable task and reject key reuse with changed input", async (t) => {
  const { app, path } = fixture(t);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const signed = await request(server)
    .post("/api/login")
    .send({ email: "north@demo.test", password: "demo-portal" })
    .expect(200);
  const cookie = signed.headers["set-cookie"][0].split(";")[0];
  const agent = request.agent(server);
  agent.jar.setCookie(cookie);
  const key = "task-retry-12345";
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(server)
        .post("/api/projects/website/tasks")
        .set("Cookie", cookie)
        .set("Idempotency-Key", key)
        .send({ title: "Only once" }),
    ),
  );
  assert.equal(new Set(results.map((r) => r.body.task.id)).size, 1);
  const tasks = (await agent.get("/api/projects")).body.projects[0].tasks;
  assert.equal(tasks.filter((t) => t.title === "Only once").length, 1);
  await agent
    .post("/api/projects/website/tasks")
    .set("Idempotency-Key", key)
    .send({ title: "Changed" })
    .expect(409);
  const restarted = await login(createApp({ path }));
  const retry = await restarted
    .post("/api/projects/website/tasks")
    .set("Idempotency-Key", key)
    .send({ title: "Only once" })
    .expect(201);
  assert.equal(retry.body.task.id, results[0].body.task.id);
});
test("sessions expire and requests from an unrelated origin cannot write", async (t) => {
  const { path } = fixture(t);
  let now = 1000;
  const app = createApp({ path, clock: () => now });
  const agent = await login(app);
  await agent
    .post("/api/projects/website/tasks")
    .set("Origin", "https://unrelated.example")
    .send({ title: "Unsafe" })
    .expect(403);
  now += 9 * 60 * 60 * 1000;
  await agent.get("/api/projects").expect(401);
});
