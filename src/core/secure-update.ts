import { createHash, randomUUID, verify } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { compareVersions, PROJECT_RELEASE_API_URL } from "./update-checker.js";

export const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlY+d5T/xOkKEeDxcp3tOXBU0Gh+gFOd0i+ObullNpLc=
-----END PUBLIC KEY-----`;

const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_METADATA_BYTES = 512_000;
const MAX_ARTIFACT_BYTES = 300 * 1024 * 1024;
const MANIFEST_FILE = "release-manifest.json";
const SIGNATURE_FILE = "release-manifest.sig";

interface ReleaseAssetMetadata {
  name: string;
  size: number;
  browser_download_url: string;
}

interface ManifestArtifact {
  file: string;
  bytes: number;
  sha256: string;
}

export interface UpdateArtifact extends ManifestArtifact {
  downloadUrl: string;
}

export interface SecureUpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  artifact?: UpdateArtifact;
}

export interface VerifiedReleaseManifest {
  application: "GoLiveBack";
  version: string;
  commit: string | null;
  artifacts: ManifestArtifact[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("A atualização não possui uma URL HTTPS válida.");
  return url.href;
}

function parseReleaseAsset(value: unknown): ReleaseAssetMetadata {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.browser_download_url !== "string" || !Number.isSafeInteger(value.size)) {
    throw new Error("O GitHub retornou um artefato de atualização inválido.");
  }
  return {
    name: value.name,
    size: value.size as number,
    browser_download_url: safeHttpsUrl(value.browser_download_url)
  };
}

function parseManifestArtifact(value: unknown): ManifestArtifact {
  if (!isRecord(value) || typeof value.file !== "string" || typeof value.sha256 !== "string" || !Number.isSafeInteger(value.bytes)) {
    throw new Error("O manifesto assinado contém um artefato inválido.");
  }
  if (path.basename(value.file) !== value.file || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value.file)) {
    throw new Error("O manifesto assinado contém um nome de arquivo inseguro.");
  }
  const bytes = value.bytes as number;
  if (bytes < 1 || bytes > MAX_ARTIFACT_BYTES) throw new Error("O tamanho do artefato de atualização é inválido.");
  if (!/^[0-9A-Fa-f]{64}$/.test(value.sha256)) throw new Error("O manifesto assinado contém um SHA-256 inválido.");
  return { file: value.file, bytes, sha256: value.sha256.toUpperCase() };
}

export function verifyReleaseManifest(
  manifestText: string,
  signatureText: string,
  publicKey = UPDATE_PUBLIC_KEY_PEM
): VerifiedReleaseManifest {
  const normalizedSignature = signatureText.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedSignature)) throw new Error("A assinatura do manifesto possui formato inválido.");
  const signature = Buffer.from(normalizedSignature, "base64");
  if (signature.length !== 64 || !verify(null, Buffer.from(manifestText, "utf8"), publicKey, signature)) {
    throw new Error("A assinatura do manifesto de atualização é inválida.");
  }

  let value: unknown;
  try {
    value = JSON.parse(manifestText);
  } catch {
    throw new Error("O manifesto assinado não contém JSON válido.");
  }
  if (!isRecord(value) || value.application !== "GoLiveBack" || typeof value.version !== "string" || !Array.isArray(value.artifacts)) {
    throw new Error("O manifesto assinado está incompleto.");
  }
  compareVersions(value.version, value.version);
  if (value.commit !== null && typeof value.commit !== "string") throw new Error("O manifesto assinado contém um commit inválido.");
  const artifacts = value.artifacts.map(parseManifestArtifact);
  if (artifacts.length === 0 || new Set(artifacts.map(item => item.file.toLowerCase())).size !== artifacts.length) {
    throw new Error("O manifesto assinado não contém uma lista única de artefatos.");
  }
  return { application: "GoLiveBack", version: value.version, commit: value.commit as string | null, artifacts };
}

async function fetchLimitedText(
  url: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  headers: Record<string, string>,
  redirect: RequestRedirect
) {
  const response = await fetchImplementation(url, { method: "GET", headers, redirect, signal });
  if (!response.ok) throw new Error(`O servidor de atualizações respondeu com o código ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) throw new Error("A resposta de atualização excedeu o tamanho permitido.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) throw new Error("A resposta de atualização excedeu o tamanho permitido.");
  return text;
}

export async function checkSecureUpdate(
  currentVersion: string,
  fetchImplementation: typeof fetch = fetch,
  artifactKind: "setup" | "portable" = "setup",
  publicKey = UPDATE_PUBLIC_KEY_PEM
): Promise<SecureUpdateCheckResult> {
  compareVersions(currentVersion, currentVersion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const apiHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": `GoLiveBack/${currentVersion}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  try {
    const responseText = await fetchLimitedText(PROJECT_RELEASE_API_URL, fetchImplementation, controller.signal, apiHeaders, "error");
    const metadata: unknown = JSON.parse(responseText);
    if (!isRecord(metadata) || typeof metadata.tag_name !== "string" || !Array.isArray(metadata.assets)) {
      throw new Error("O GitHub retornou dados de release incompletos.");
    }
    const latestVersion = metadata.tag_name.replace(/^v/i, "");
    compareVersions(latestVersion, latestVersion);
    if (compareVersions(currentVersion, latestVersion) >= 0) return { currentVersion, latestVersion, updateAvailable: false };

    const releaseAssets = metadata.assets.map(parseReleaseAsset);
    const manifestAsset = releaseAssets.find(asset => asset.name === MANIFEST_FILE);
    const signatureAsset = releaseAssets.find(asset => asset.name === SIGNATURE_FILE);
    if (!manifestAsset || !signatureAsset) throw new Error("A release não contém um manifesto de atualização assinado.");
    const assetHeaders = { "User-Agent": `GoLiveBack/${currentVersion}` };
    const [manifestText, signatureText] = await Promise.all([
      fetchLimitedText(manifestAsset.browser_download_url, fetchImplementation, controller.signal, assetHeaders, "follow"),
      fetchLimitedText(signatureAsset.browser_download_url, fetchImplementation, controller.signal, assetHeaders, "follow")
    ]);
    const manifest = verifyReleaseManifest(manifestText, signatureText, publicKey);
    if (compareVersions(manifest.version, latestVersion) !== 0) throw new Error("A versão do manifesto assinado diverge da release publicada.");

    const expectedInstallerName = artifactKind === "portable"
      ? `GoLiveBack-Portable-${latestVersion}-x64.exe`
      : `GoLiveBack-Setup-${latestVersion}-x64.exe`;
    const manifestInstaller = manifest.artifacts.find(artifact => artifact.file === expectedInstallerName);
    const releaseInstaller = releaseAssets.find(asset => asset.name === expectedInstallerName);
    if (!manifestInstaller || !releaseInstaller || releaseInstaller.size !== manifestInstaller.bytes) {
      throw new Error("A release não contém o instalador esperado pelo manifesto assinado.");
    }
    return {
      currentVersion,
      latestVersion,
      updateAvailable: true,
      artifact: { ...manifestInstaller, downloadUrl: releaseInstaller.browser_download_url }
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("A consulta de atualização demorou mais de 15 segundos.");
    if (error instanceof SyntaxError) throw new Error("O servidor retornou uma resposta de atualização inválida.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadVerifiedUpdate(
  artifact: UpdateArtifact,
  destinationDirectory: string,
  fetchImplementation: typeof fetch = fetch
) {
  safeHttpsUrl(artifact.downloadUrl);
  if (path.basename(artifact.file) !== artifact.file) throw new Error("O nome do instalador de atualização é inseguro.");

  await mkdir(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, artifact.file);
  const temporary = `${destination}.${randomUUID()}.partial`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const response = await fetchImplementation(artifact.downloadUrl, {
      method: "GET",
      headers: { "User-Agent": "GoLiveBack-Updater" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error(`O download da atualização falhou com o código ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 0 && declaredLength !== artifact.bytes) throw new Error("O tamanho anunciado para a atualização é inesperado.");

    handle = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > artifact.bytes) throw new Error("O download excedeu o tamanho assinado no manifesto.");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset, received - chunk.length + offset);
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (received !== artifact.bytes) throw new Error("O download terminou antes do tamanho assinado no manifesto.");
    if (hash.digest("hex").toUpperCase() !== artifact.sha256.toUpperCase()) {
      throw new Error("O SHA-256 da atualização não corresponde ao manifesto assinado.");
    }
    await unlink(destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("O download da atualização excedeu dez minutos.");
    throw error;
  } finally {
    clearTimeout(timeout);
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
