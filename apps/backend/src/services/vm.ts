import { execSync } from "child_process";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Err, Ok, type Result } from "../errors/result.js";
import { VMError } from "../errors/vmError.js";
import { logger } from "../utils/log.js";
import config from "../config/index.js";

const log = logger.child({ service: "vm" });

export type HatchVM = {
  id: string;
  image_id: string;
  state: string;
  vcpu_count: number;
  mem_mib: number;
  guest_ip: string;
  guest_mac: string;
  tap_name: string;
  ssh_port: number;
  socket_path: string;
  user_data: string;
  enable_network: boolean;
  created_at: string;
  updated_at: string;
};

export type SSHKeyPair = {
  privateKeyOpenSSH: string;
  publicKeyOpenSSH: string;
};

export function generateSSHKeyPair(): Result<SSHKeyPair, VMError> {
  const tmpDir = mkdtempSync(join(tmpdir(), "relay-ssh-"));
  const keyPath = join(tmpDir, "id_ed25519");

  try {
    execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`);

    const privateKeyOpenSSH = readFileSync(keyPath, "utf-8");
    const publicKeyOpenSSH = readFileSync(`${keyPath}.pub`, "utf-8").trim();

    return Ok({ privateKeyOpenSSH, publicKeyOpenSSH });
  } catch (error) {
    log.error(error, "Failed to generate SSH key pair");
    return Err(VMError.keyGenFailed(error));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildCloudInit(sshPublicKey: string): string {
  return [
    "#cloud-config",
    "hostname: relay-vm",
    "users:",
    "  - name: relay",
    "    groups: [sudo]",
    "    shell: /bin/bash",
    '    sudo: ["ALL=(ALL) NOPASSWD:ALL"]',
    "    ssh_authorized_keys:",
    `      - ${sshPublicKey}`,
    "package_update: true",
    "packages:",
    "  - ripgrep",
    "  - git",
    "  - curl",
  ].join("\n");
}

export async function createVM(
  sshPublicKey: string
): Promise<Result<HatchVM, VMError>> {
  const cloudInit = buildCloudInit(sshPublicKey);

  try {
    log.info("Creating VM via HatchVM API");

    const response = await fetch(`${config.hatchvm.apiUrl}/vms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_data: cloudInit }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, "HatchVM API error");
      return Err(VMError.apiFailed("vm_create", response.status, body));
    }

    const vm: HatchVM = await response.json();
    log.info({ vmId: vm.id, sshPort: vm.ssh_port }, "VM created");

    return Ok(vm);
  } catch (error) {
    log.error(error, "Failed to create VM");
    return Err(VMError.createFailed("Failed to create VM", error));
  }
}
