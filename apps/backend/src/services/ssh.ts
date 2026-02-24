import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { Err, Ok, type Result } from "../errors/result.js";
import { VMError } from "../errors/vmError.js";
import { logger } from "../utils/log.js";

const log = logger.child({ service: "ssh" });

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type ManagedConnection = {
  client: Client;
  config: SSHConnectionConfig;
  connected: boolean;
};

const connections = new Map<string, ManagedConnection>();

const connect = (
  config: SSHConnectionConfig
): Promise<Result<Client, VMError>> => {
  return new Promise((resolve) => {
    const client = new Client();

    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey: config.privateKey,
      readyTimeout: 10_000,
    };

    client.on("ready", () => {
      log.info({ host: config.host, port: config.port }, "SSH connected");
      resolve(Ok(client));
    });

    client.on("error", (err) => {
      log.error(err, "SSH connection error");
      resolve(Err(VMError.createFailed("SSH connection failed", err)));
    });

    client.connect(connectConfig);
  });
};

export const getConnection = async (
  vmId: string,
  config: SSHConnectionConfig
): Promise<Result<ManagedConnection, VMError>> => {
  const existing = connections.get(vmId);
  if (existing?.connected) {
    return Ok(existing);
  }

  const result = await connect(config);
  if (!result.ok) return Err(result.error);

  const managed: ManagedConnection = {
    client: result.value,
    config,
    connected: true,
  };

  result.value.on("close", () => {
    managed.connected = false;
    log.info({ vmId }, "SSH connection closed");
  });

  connections.set(vmId, managed);
  return Ok(managed);
};

export const exec = async (
  vmId: string,
  config: SSHConnectionConfig,
  command: string,
  options?: { cwd?: string }
): Promise<Result<ExecResult, VMError>> => {
  const connResult = await getConnection(vmId, config);
  if (!connResult.ok) return Err(connResult.error);

  const fullCommand = options?.cwd
    ? `cd ${options.cwd} && ${command}`
    : command;

  return new Promise((resolve) => {
    connResult.value.client.exec(fullCommand, (err, stream) => {
      if (err) {
        log.error(err, "SSH exec error");
        resolve(Err(VMError.createFailed("SSH exec failed", err)));
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on("close", (code: number) => {
        resolve(Ok({ stdout, stderr, exitCode: code ?? 0 }));
      });

      stream.on("error", (streamErr: Error) => {
        resolve(Err(VMError.createFailed("SSH stream error", streamErr)));
      });
    });
  });
};

export const shell = async (
  vmId: string,
  config: SSHConnectionConfig,
  options?: { cwd?: string }
): Promise<Result<ClientChannel, VMError>> => {
  const connResult = await getConnection(vmId, config);
  if (!connResult.ok) return Err(connResult.error);

  return new Promise((resolve) => {
    connResult.value.client.shell({ term: "xterm" }, (err, stream) => {
      if (err) {
        log.error(err, "SSH shell error");
        resolve(Err(VMError.createFailed("SSH shell failed", err)));
        return;
      }

      if (options?.cwd) {
        stream.write(`cd ${options.cwd}\n`);
      }

      resolve(Ok(stream));
    });
  });
};

export const disconnect = (vmId: string) => {
  const conn = connections.get(vmId);
  if (conn) {
    conn.client.end();
    conn.connected = false;
    connections.delete(vmId);
  }
};

export const disconnectAll = () => {
  for (const [vmId, conn] of connections) {
    conn.client.end();
    conn.connected = false;
  }
  connections.clear();
};
