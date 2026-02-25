import { dbConnection } from "../services/db.js";
import * as s3Service from "../services/s3.js";

export default async function teardown() {
  await dbConnection.end();
  s3Service.end();
  return;
}
