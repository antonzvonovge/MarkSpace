import { invoke } from "@tauri-apps/api/core";

export type MachineIdentity = {
  id: string;
  name: string;
};

export type VaultMachine = {
  id: string;
  name: string;
  lastSeenAt?: string;
};

export async function getMachineIdentity(): Promise<MachineIdentity> {
  return invoke<MachineIdentity>("get_machine_identity");
}

export async function setMachineName(name: string): Promise<MachineIdentity> {
  return invoke<MachineIdentity>("set_machine_name", { name });
}

export async function listVaultMachines(): Promise<VaultMachine[]> {
  return invoke<VaultMachine[]>("list_vault_machines");
}
