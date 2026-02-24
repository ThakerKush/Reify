import { BaseError } from "./baseError.js";

export class VMError extends BaseError {
  operation: string;
  details?: Record<string, unknown>;

  constructor(
    operation: string,
    message: string,
    details?: Record<string, unknown>,
    source = "vm-service"
  ) {
    super("VM_ERROR", message, source);
    this.operation = operation;
    this.details = details;
  }

  public static keyGenFailed(error: unknown): VMError {
    return new VMError("key_generation", "Failed to generate SSH key pair", {
      error,
    });
  }

  public static createFailed(message: string, error?: unknown): VMError {
    return new VMError("vm_create", message, { error });
  }

  public static apiFailed(
    operation: string,
    status: number,
    body: string
  ): VMError {
    return new VMError(operation, `HatchVM API error (${status}): ${body}`, {
      status,
      body,
    });
  }
}
