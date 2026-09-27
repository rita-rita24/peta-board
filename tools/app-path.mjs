import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const appPath = process.env.PETA_BOARD_HTML
  ? path.resolve(process.env.PETA_BOARD_HTML)
  : fileURLToPath(new URL('../PetaBoard.html', import.meta.url));

export const appUrl = pathToFileURL(appPath).href;
