import { setupDb } from "../services/db.js";
import { setupS3 } from "../services/s3.js";
import sleep from "../utils/sleep.js";

export default async function loaders() {
  let retries = 1;
  while (retries <= 5) {
    try {
      await setupDb();
      await setupS3();

      break;
    } catch (error) {
      await sleep(5000);
      retries++;
      if (retries >= 5) {
        throw error;
      }
    }
  }
}
