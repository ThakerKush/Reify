import * as dockerService from "../services/docker.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/log.js";
import * as dbService from "../services/db.js";
import * as workspaceManager from "../services/workspaceManager.js";
import * as s3Service from "../services/s3.js";
import { Err } from "../errors/result.js";
import { error } from "console";
import { createGunzip } from "zlib";
const log = logger.child({ service: "testWorkspaceLifecycle" });

export async function executeWorkspaceLifecycle() {
  const uuid = uuidv4();
  const imageName = `code-workspace:latestV2`;

  const result = await dockerService.createBaseWorkspace(uuid, imageName);
  log.info(imageName, uuid);
  if (!result.ok) {
    log.error(result.error, "something went wrong");
    throw result.error;
  }
  const dbResult = await dbService.insertProject(uuid, 1, "active");
  if (!dbResult.ok) {
    log.error({ error: dbResult.error }, "something went wrong ");
  }

  log.info(`workspace with name:${uuid} created successfully`);
  await dockerService.executeCommand(uuid, [
    "bash",
    "-c",
    "npm create vite my-app -- --template react-ts && cd my-app && npm install",
  ]);
  log.info("vite created in container");
  const archiveResult = await dockerService.getCompressedArchive(uuid);
  if (!archiveResult.ok) {
    log.error(archiveResult.error, "something went wrong");
    throw archiveResult.error;
  }

  const s3Key = `/workspace/${uuid}/${Date.now()}.tar.gz`;
  const s3Result = await s3Service.uploadFile(
    s3Key,
    archiveResult.value,
    "application/gzip"
  );
  if (!s3Result.ok) {
    log.error(s3Result.error, "something went wrong");
    throw s3Result.error;
  }
  await dockerService.stopAndRemoveContainer(uuid);
  await dbService.updateStorageLink(uuid, s3Key);

  log.info(
    `workspace with name:${uuid} archived successfully, waiting 30 seconds before restore `
  );
}

async function restoreWorkspace(projectId: string) {
  const project = await dbService.getProject(projectId);
  if (!project.ok) {
    log.error(project.error, "something went wrong");
    throw project.error;
  }
  log.info(`restoring workspace with projectId:${projectId}`);
  const streamResult = await s3Service.getFileStream(
    project.value.storageLink!
  );
  if (!streamResult.ok) {
    log.error(streamResult.error, "something went wrong");
    throw streamResult.error;
  }
  const gunzip = createGunzip();
  const decompressedStream = streamResult.value.pipe(gunzip);
  log.info("decompressing files");

  const container = await dockerService.createBaseWorkspace(
    projectId,
    "code-workspace:latestV2"
  );
  if (!container.ok) {
    log.error(container.error, "something went wrong");
    throw container.error;
  }

  const loadResult = await dockerService.extractArchive(
    projectId,
    decompressedStream
  );
  if (!loadResult.ok) {
    log.error(loadResult.error, "something went wrong");
    throw loadResult.error;
  }
  await dbService.updateWorkspaceActivity(projectId, "active");
  log.info(`workspace with name:${projectId} restored successfully`);
}
