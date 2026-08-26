import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSecureUpdate, downloadVerifiedUpdate, verifyReleaseManifest } from "../../../src/core/secure-update.js";
import { PROJECT_RELEASE_API_URL } from "../../../src/core/update-checker.js";

function signingFixture(version = "1.1.0", artifactContents = Buffer.from("verified installer")) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const file = `GoLiveBack-Setup-${version}-x64.exe`;
  const manifest = JSON.stringify({
    application: "GoLiveBack",
    version,
    commit: null,
    artifacts: [{
      file,
      bytes: artifactContents.length,
      sha256: createHash("sha256").update(artifactContents).digest("hex").toUpperCase()
    }]
  });
  const signature = sign(null, Buffer.from(manifest), privateKey).toString("base64");
  return {
    artifactContents,
    file,
    manifest,
    signature,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

test("accepts only an authentic Ed25519 release manifest", () => {
  const fixture = signingFixture();
  const verified = verifyReleaseManifest(fixture.manifest, fixture.signature, fixture.publicKey);
  assert.equal(verified.version, "1.1.0");
  assert.equal(verified.artifacts[0]?.file, fixture.file);
  assert.throws(
    () => verifyReleaseManifest(`${fixture.manifest} `, fixture.signature, fixture.publicKey),
    /assinatura.*inválida/i
  );
});

test("discovers an installer only after verifying its signed manifest", async () => {
  const fixture = signingFixture();
  const urls = {
    manifest: "https://downloads.example/release-manifest.json",
    signature: "https://downloads.example/release-manifest.sig",
    installer: `https://downloads.example/${fixture.file}`
  };
  const metadata = JSON.stringify({
    tag_name: "v1.1.0",
    assets: [
      { name: "release-manifest.json", size: Buffer.byteLength(fixture.manifest), browser_download_url: urls.manifest },
      { name: "release-manifest.sig", size: Buffer.byteLength(fixture.signature), browser_download_url: urls.signature },
      { name: fixture.file, size: fixture.artifactContents.length, browser_download_url: urls.installer }
    ]
  });
  const fetchImplementation: typeof fetch = async input => {
    const url = String(input);
    if (url === PROJECT_RELEASE_API_URL) return new Response(metadata);
    if (url === urls.manifest) return new Response(fixture.manifest);
    if (url === urls.signature) return new Response(fixture.signature);
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await checkSecureUpdate("1.0.0", fetchImplementation, "setup", fixture.publicKey);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.artifact?.file, fixture.file);
  assert.equal(result.artifact?.downloadUrl, urls.installer);
});

test("downloads atomically and rejects contents outside the signed SHA-256", async () => {
  const fixture = signingFixture();
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-update-"));
  const artifact = {
    file: fixture.file,
    bytes: fixture.artifactContents.length,
    sha256: createHash("sha256").update(fixture.artifactContents).digest("hex"),
    downloadUrl: "https://downloads.example/update.exe"
  };
  try {
    const progress: number[] = [];
    const downloaded = await downloadVerifiedUpdate(
      artifact,
      directory,
      async () => new Response(fixture.artifactContents, { headers: { "content-length": String(fixture.artifactContents.length) } }),
      value => progress.push(value.percent)
    );
    assert.deepEqual(await readFile(downloaded), fixture.artifactContents);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 100);

    await assert.rejects(
      downloadVerifiedUpdate(
        { ...artifact, file: "tampered.exe" },
        directory,
        async () => new Response(Buffer.from("tampered payload"))
      ),
      /tamanho|SHA-256/i
    );
    assert.deepEqual((await readdir(directory)).sort(), [fixture.file]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
