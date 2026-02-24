import { generateKeyPairSync } from "crypto";
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
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyOpenSSH: string;
};

/**
 * Converts a PEM-encoded ed25519 public key to OpenSSH format (ssh-ed25519 AAAA...).
 * The SPKI DER encoding for ed25519 has a fixed 12-byte header before the 32-byte raw key.
 */
function pemToOpenSSH(pemPublicKey: string): string {
  const base64 = pemPublicKey
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");

  const der = Buffer.from(base64, "base64");
  const rawKey = der.subarray(12);

  const keyType = Buffer.from("ssh-ed25519");
  const keyTypeLen = Buffer.alloc(4);
  keyTypeLen.writeUInt32BE(keyType.length);

  const rawKeyLen = Buffer.alloc(4);
  rawKeyLen.writeUInt32BE(rawKey.length);

  const sshBlob = Buffer.concat([keyTypeLen, keyType, rawKeyLen, rawKey]);
  return `ssh-ed25519 ${sshBlob.toString("base64")}`;
}

export function generateSSHKeyPair(): Result<SSHKeyPair, VMError> {
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const publicKeyOpenSSH = pemToOpenSSH(publicKey);

    return Ok({ privateKeyPem: privateKey, publicKeyPem: publicKey, publicKeyOpenSSH });
  } catch (error) {
    log.error(error, "Failed to generate SSH key pair");
    return Err(VMError.keyGenFailed(error));
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
