import { AsyncLocalStorage } from "async_hooks";
import type { SSHConnectionConfig } from "../services/ssh.js";
import type { ClientChannel } from "ssh2";

export interface SessionContext {
  vmId: string;
  projectPath: string;
  sshConfig: SSHConnectionConfig;
  shellChannel?: ClientChannel;
  projectId?: string;
  runCommand?: string;
  buildCommand?: string;
  projectDescription?: string;
  todo?: Array<{
    description: string;
    status: "pending" | "in_progress" | "completed";
    priority: "low" | "medium" | "high";
  }>;
}

class SessionContextManager {
  private static instance: SessionContextManager;
  private asyncLocalStorage = new AsyncLocalStorage<SessionContext>();

  private constructor() {}

  async run<T>(context: SessionContext, cb: () => T): Promise<T> {
    return this.asyncLocalStorage.run<T>(context, cb);
  }

  getContext(): SessionContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  static getInstance(): SessionContextManager {
    if (!SessionContextManager.instance) {
      SessionContextManager.instance = new SessionContextManager();
    }
    return SessionContextManager.instance;
  }
}

export const sessionContext = SessionContextManager.getInstance();
