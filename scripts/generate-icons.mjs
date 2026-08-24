import { app, BrowserWindow, nativeImage } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const assetsDirectory = path.join(projectRoot, "assets");
const appSourcePath = path.join(assetsDirectory, "app-icon.svg");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function createIco(images) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = directorySize;

  images.forEach(({ size, png }, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");
console.log("Inicializando o renderizador de ícones…");

async function rasterizeSvg(window, sourcePath) {
  await window.loadURL(pathToFileURL(sourcePath).href);
  const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const serialized = new XMLSerializer().serializeToString(document.documentElement);
    const blobUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Não foi possível carregar o SVG no canvas"));
      });
      image.src = blobUrl;
      await loaded;
      const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d", { alpha: true });
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })()`);
  const source = nativeImage.createFromDataURL(dataUrl);
  const sourceSize = source.getSize();

  if (sourceSize.width !== 1024 || sourceSize.height !== 1024 || source.isEmpty()) {
    throw new Error(`Renderização inesperada de ${path.basename(sourcePath)}: ${sourceSize.width}x${sourceSize.height}`);
  }
  return source;
}

function resizeForIco(source) {
  return icoSizes.map((size) => ({
    size,
    png: source.resize({ width: size, height: size, quality: "best" }).toPNG()
  }));
}

async function generateIcons() {
  console.log("Electron pronto; carregando os SVGs…");
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { sandbox: true }
  });

  try {
    await mkdir(assetsDirectory, { recursive: true });
    const appSource = await rasterizeSvg(window, appSourcePath);
    const appIcoImages = resizeForIco(appSource);
    await writeFile(path.join(assetsDirectory, "app-icon.png"), appSource.toPNG());
    await writeFile(path.join(assetsDirectory, "tray-icon.png"), appIcoImages.find(({ size }) => size === 32).png);
    await writeFile(path.join(assetsDirectory, "app-icon.ico"), createIco(appIcoImages));

    console.log(`Ícone do aplicativo: ${path.relative(projectRoot, appSourcePath)}.`);
    console.log("O instalador e o portátil usam o mesmo ícone do aplicativo.");
    console.log(`PNG: 1024x1024; bandeja: 32x32; ICO: ${icoSizes.join(", ")} px.`);
  } finally {
    window.destroy();
  }
}

app.whenReady()
  .then(generateIcons)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
