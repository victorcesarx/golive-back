export const PROJECT_RELEASE_API_URL = "https://api.github.com/repos/victorcesarx/golive-back/releases/latest";
export const PROJECT_LATEST_RELEASE_URL = "https://github.com/victorcesarx/golive-back/releases/latest";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_LENGTH = 256_000;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

type FetchImplementation = typeof fetch;

function parseVersion(value: string): ParsedVersion {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error("A release mais recente possui um número de versão inválido.");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error("A release mais recente possui um número de versão inválido.");
  return { core: [major, minor, patch], prerelease: match[4]?.split(".") ?? [] };
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function compareVersions(leftValue: string, rightValue: string) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export async function checkProjectUpdate(currentVersion: string, fetchImplementation: FetchImplementation = fetch): Promise<UpdateCheckResult> {
  parseVersion(currentVersion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(PROJECT_RELEASE_API_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `GoLiveBack/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      redirect: "error",
      signal: controller.signal
    });
    if (response.status === 404) {
      throw new Error("O repositório ou suas releases ainda não estão públicos. Nenhum token de acesso é armazenado pelo aplicativo.");
    }
    if (response.status === 403 || response.status === 429) {
      throw new Error("O limite temporário de consultas do GitHub foi atingido. Tente novamente mais tarde.");
    }
    if (!response.ok) throw new Error(`O GitHub respondeu com o código ${response.status}. Tente novamente mais tarde.`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_LENGTH) throw new Error("A resposta do GitHub excedeu o tamanho permitido.");
    const responseText = await response.text();
    if (responseText.length > MAX_RESPONSE_LENGTH) throw new Error("A resposta do GitHub excedeu o tamanho permitido.");
    const metadata: unknown = JSON.parse(responseText);
    if (!metadata || typeof metadata !== "object" || !("tag_name" in metadata) || typeof metadata.tag_name !== "string") {
      throw new Error("O GitHub retornou dados de release incompletos.");
    }
    const latestVersion = metadata.tag_name.replace(/^v/i, "");
    parseVersion(latestVersion);
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("A consulta ao GitHub demorou mais de 10 segundos.");
    if (error instanceof SyntaxError) throw new Error("O GitHub retornou uma resposta inválida.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
