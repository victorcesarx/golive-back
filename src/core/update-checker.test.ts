import assert from "node:assert/strict";
import test from "node:test";
import { checkProjectUpdate, compareVersions, PROJECT_RELEASE_API_URL } from "./update-checker.js";

test("compares stable and prerelease semantic versions", () => {
  assert.equal(compareVersions("1.16.0", "v1.17.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
});

test("reports when the installed version is current", async () => {
  const result = await checkProjectUpdate("1.16.0", async input => {
    assert.equal(String(input), PROJECT_RELEASE_API_URL);
    return new Response(JSON.stringify({ tag_name: "v1.16.0" }), { status: 200 });
  });
  assert.deepEqual(result, { currentVersion: "1.16.0", latestVersion: "1.16.0", updateAvailable: false });
});

test("reports a newer GitHub release", async () => {
  const result = await checkProjectUpdate("1.16.0", async () => new Response(JSON.stringify({ tag_name: "v1.17.1" }), { status: 200 }));
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, "1.17.1");
});

test("explains why a private repository cannot be queried without a token", async () => {
  await assert.rejects(
    checkProjectUpdate("1.16.0", async () => new Response("Not found", { status: 404 })),
    /releases ainda não estão públicos.*Nenhum token de acesso/i
  );
});

test("rejects malformed release metadata", async () => {
  await assert.rejects(
    checkProjectUpdate("1.16.0", async () => new Response(JSON.stringify({ name: "latest" }), { status: 200 })),
    /dados de release incompletos/i
  );
});
