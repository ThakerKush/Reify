import Docker from "dockerode";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Err, Ok, type Result } from "../errors/result.js";
import { DockerError } from "../errors/dockerError.js";
import { handleStream } from "../utils/handleStream.js";
import { logger } from "../utils/log.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Readable } from "stream";
import { createGzip } from "zlib";

export type WorkspaceInfo = {
  containerId: string;
  projectId: string;
  // cwd: string;
  todo?: Array<{
    description: string;
    status: "pending" | "in_progress" | "completed";
    priority: "low" | "medium" | "high";
  }>;
  shellSession: ShellSession;
  imageName: string;
  createdAt: Date;
  updatedAt: Date;
  status: string;
};

export type ShellSession = {
  stream: NodeJS.ReadWriteStream;
};

const log = logger.child({ service: "docker" });
export let docker: Docker;

export const setupDocker = async () => {
  docker = new Docker();
};

export const ping = async (): Promise<boolean> => {
  try {
    await docker.ping();
    return true;
  } catch (error) {
    log.error(error, "Docker ping failed");
    return false;
  }
};

export const buildImage = async (
  contextPath: string,
  imageName: string
): Promise<Result<string[], DockerError>> => {
  const logs: string[] = [];

  try {
    let stream = await docker.buildImage(
      { context: contextPath, src: ["dockerfile"] },
      { t: imageName, nocache: true }
    );

    await new Promise((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (error, result) => {
          if (error) {
            logs.push(`Build Error: ${error}`);
            reject(error);
          } else {
            resolve(result);
          }
        },
        (progress) => {
          if (progress.stream) {
            logs.push(progress.stream.trim());
          }
        }
      );
    });

    return Ok(logs);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.buildFailed("unknownError", logs));
  }
};

export const makeContaier = async (
  imageName: string,
  projectId: string
): Promise<Result<WorkspaceInfo, DockerError>> => {
  try {
    log.info("Making container");

    try {
      const image = docker.getImage(imageName);
      await image.inspect();
      log.info("image found, proceeding to create container");
    } catch (error) {
      log.info("image not found, building");
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const buildResult = await buildImage(
        join(__dirname, "..", ".."),
        imageName
      );
      if (!buildResult.ok) {
        log.error(buildResult.error, "error at docker service");
        return Err(buildResult.error);
      }
      log.info("image built successfully");
    }

    // Create and start container (this happens regardless of whether image existed or was built)
    log.info("creating container");
    const container = await docker.createContainer({
      Image: imageName,
      name: projectId,
      Cmd: ["tail", "-f", "/dev/null"],
      ExposedPorts: {
        "5173/tcp": {},
        "3000/tcp": {},
        "8080/tcp": {},
      },
      HostConfig: {
        Memory: 500 * 1024 * 1024, //500 MB of ram
        MemorySwap: 500 * 1024 * 1024,
        CpuPeriod: 100000, // 100ms period (default)
        CpuQuota: 50000, // 50ms quota = 50% of one CPU
      },
      Labels: {
        // Enable Traefik for this container
        "traefik.enable": "true",
        "traefik.docker.network": "web",

        // Main route: projectId.mydomain.com -> port 3000
        [`traefik.http.routers.${projectId}.rule`]: `Host(\`${projectId}.localhost\`)`,
        [`traefik.http.routers.${projectId}.entrypoints`]: "web",
        [`traefik.http.services.${projectId}.loadbalancer.server.port`]: "5173",
      },
    });
    await container.start();

    const shellResult = await startShellSession(projectId);
    if (!shellResult.ok) {
      log.error(shellResult.error, String(shellResult.error));
      return Err(shellResult.error);
    }
    const workspaceInfo: WorkspaceInfo = {
      containerId: container.id,
      projectId,
      shellSession: shellResult.value,
      imageName,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "running",
      // cwd: "/workspace",
    };
    return Ok(workspaceInfo);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError"));
  }
};

export const createBaseWorkspace = async (
  projectId: string,
  imageName: string
): Promise<Result<WorkspaceInfo, DockerError>> => {
  try {
    const createResult = await makeContaier(imageName, projectId);
    if (!createResult.ok) {
      log.error(createResult.error, "error at docker service");
      return Err(createResult.error);
    }

    const shellResult = await startShellSession(projectId);
    if (!shellResult.ok) {
      log.error(shellResult.error, String(shellResult.error));
      return Err(shellResult.error);
    }

    const workspaceInfo: WorkspaceInfo = {
      containerId: createResult.value.containerId,
      projectId,
      shellSession: shellResult.value,
      imageName: createResult.value.imageName,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: createResult.value.status,
    };
    return Ok(workspaceInfo);
  } catch (error) {
    console.error("getOrCreateWorkspaceError:", error);
    return Err(DockerError.getOrCreateError(String(error)));
  }
};

export const executeCommand = async (
  workspaceId: string,
  command: string[]
): Promise<Result<{ stdout: string; stderr: string }, DockerError>> => {
  try {
    const container = docker.getContainer(workspaceId);

    const execStream = await (
      await container.exec({
        Cmd: command,
        AttachStdin: true,
        AttachStderr: true,
        AttachStdout: true,
      })
    ).start({ hijack: true });
    const { stdout, stderr } = await handleStream(execStream, {
      isTTY: false,
      collect: true,
    });
    log.info(stdout, stderr);
    return Ok({ stdout: stdout || "", stderr: stderr || "" });
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError")); // fix this later
  }
};

export const startShellSession = async (
  workspaceId: string
): Promise<Result<ShellSession, DockerError>> => {
  try {
    const container = docker.getContainer(workspaceId);
    const exec = await container.exec({
      Cmd: ["/bin/bash"],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: "/workspace",
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    const shellSession: ShellSession = {
      stream,
    };

    return Ok(shellSession);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const getWorkspace = async (
  projectId: string
): Promise<Result<WorkspaceInfo, DockerError>> => {
  try {
    const container = docker.getContainer(projectId);
    const status = await container.inspect();

    const shellResult = await startShellSession(projectId);
    if (!shellResult.ok) {
      log.error(shellResult.error, String(shellResult.error));
      return Err(shellResult.error);
    }

    const workspaceInfo: WorkspaceInfo = {
      containerId: container.id,
      projectId,
      shellSession: shellResult.value,
      imageName: status.Image,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: status.State.Status,
    };
    return Ok(workspaceInfo);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const getCompressedArchive = async (
  projectId: string
): Promise<Result<Readable, DockerError>> => {
  try {
    const container = docker.getContainer(projectId);

    const workspaceArchive = await container.getArchive({
      id: container.id,
      path: "/workspace",
    });
    log.info("workspace archive retrieved successfully");
    const gzipStream = createGzip();

    const compressedStream = workspaceArchive.pipe(gzipStream);
    log.info("workspace archive compressed");
    return Ok(compressedStream);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const extractArchive = async (
  projectId: string,
  stream: Readable
): Promise<Result<void, DockerError>> => {
  try {
    // This method should get a running container, that's why the container has to be running before this is called
    const container = docker.getContainer(projectId);
    await container.putArchive(stream, { path: "/" });
    log.info(`workspace ${projectId} restored`);
    return Ok(undefined);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const exportContainer = async (
  projectId: string
): Promise<Result<{ stream: Readable; image: Docker.Image }, DockerError>> => {
  try {
    log.info(
      { child: "exportContainerStream" },
      `Exporting container ${projectId} as stream`
    );

    const container = docker.getContainer(projectId);

    const commitResult = await container.commit({
      repo: `code-workspace-${projectId}`,
      tag: "latest",
    });

    const newImage = docker.getImage(commitResult.Id);
    const exportStream = await newImage.get();

    // Create gzip compression stream
    const gzipStream = createGzip();

    // Return compressed stream (memory efficient)
    const compressedStream = exportStream.pipe(gzipStream);

    return Ok({ stream: compressedStream, image: newImage });
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const stopAndRemoveContainer = async (
  projectId: string
): Promise<Result<void, DockerError>> => {
  try {
    const container = docker.getContainer(projectId);
    await container.stop({ t: 10 });
    await container.remove({ force: true });
    log.info(
      { child: "stopAndRemoveContainer" },
      `Container ${projectId} stopped and removed`
    );
    return Ok(undefined);
  } catch (error) {
    log.error(error, "error at docker service");
    return Err(DockerError.containerError("unknownError", error));
  }
};

export const loadImageFromStream = async (
  stream: Readable
): Promise<Result<string[], DockerError>> => {
  return new Promise((resolve) =>
    docker.loadImage(stream, (err: any, dockerStream: any) => {
      if (err) {
        log.error({ error: err }, "Failed to load image from stream");
        resolve(
          Err(DockerError.buildFailed("Failed to load image from stream", err))
        );
        return;
      }
      let dockerLogs: string[] = [];

      dockerStream.on("data", (chunk: Buffer) => {
        log.info(chunk, "Recieved data from load image stream");
        const newLines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.trim());
        dockerLogs.push(...newLines);
      });

      dockerStream.on("end", () => {
        log.info("Image loaded sucessfully!");
        resolve(Ok(dockerLogs));
      });

      dockerStream.on("error", (streamErr: any) => {
        log.error(streamErr, "Cannot load docker image");
        resolve(
          Err(DockerError.buildFailed("Could not load docker Image", streamErr))
        );
      });
    })
  );
};

export const setupFileWatcher = async (
  containerId: string
): Promise<Readable> => {
  const container = docker.getContainer(containerId);
  const watcherExec = await container.exec({
    Cmd: [
      "chokidar",
      "/workspace/**/*",
      "--ignore",
      "**/node_modules/**",
      "--ignore",
      "**/\.git/**",
      "--initial",
    ],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await watcherExec.start({ hijack: true, stdin: false });

  return stream;
};

export const listFiles = async (
  containerId: string
): Promise<
  Result<
    { path: string; name: string | undefined; isDirectory: boolean }[],
    DockerError
  >
> => {
  try {
    const files = await executeCommand(containerId, [
      "sh",
      "-c",
      'find /workspace | grep -v -E \'(node_modules|\\.git)\' | while read path; do if [ -d "$path" ]; then echo "$path:DIR"; else echo "$path:FILE"; fi; done',
    ]);
    if (!files.ok) {
      return Err(DockerError.containerError("unknownError", files.error));
    }
    const fileFormated = files.value.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [fullPath, type] = line.trim().split(":");
        const relativePath = fullPath.replace("/workspace/", "") || fullPath;
        return {
          path: relativePath,
          name: relativePath.split("/").pop(),
          isDirectory: type === "DIR",
        };
      });
    return Ok(fileFormated);
  } catch (error) {
    return Err(DockerError.containerError("unknownError", error));
  }
};
